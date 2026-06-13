"""
Real-time packet capture with NSL-KDD feature extraction.
Requires Scapy + Npcap (Windows) or libpcap (Linux/Mac).
"""
import threading
import time
import json
import queue
import warnings
warnings.filterwarnings("ignore")
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

try:
    from scapy.all import sniff, IP, TCP, UDP, ICMP, get_if_list, conf
    SCAPY_AVAILABLE = True
except ImportError:
    SCAPY_AVAILABLE = False

# ── NSL-KDD service mapping (port → service name) ────────────────────────────
PORT_SERVICE = {
    20: "ftp_data", 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp",
    53: "domain", 67: "domain_u", 68: "domain_u", 79: "finger",
    80: "http", 110: "pop_3", 111: "sunrpc", 113: "auth", 119: "nntp",
    143: "imap4", 179: "bgp", 194: "IRC", 443: "http_443",
    512: "exec", 513: "login", 514: "shell", 515: "printer",
    520: "efs", 540: "uucp", 543: "klogin", 544: "kshell",
    1521: "sql_net", 3306: "sql_net", 5432: "sql_net",
    8001: "http_8001", 8080: "http_8001", 8443: "http_443",
    6000: "X11", 6667: "IRC",
}

# NSL-KDD TCP flag mapping
def _tcp_flag_code(syn, fin, rst, ack, has_data):
    if syn and fin:      return "SF"
    if rst and syn:      return "RSTR"
    if rst and not syn:  return "RSTO"
    if syn and not ack and not fin and not rst:
        return "S0"
    if syn and ack and not fin and not rst:
        return "S1" if has_data else "S1"
    return "SF"

# ── Connection state ──────────────────────────────────────────────────────────
@dataclass
class Flow:
    src_ip:    str
    dst_ip:    str
    src_port:  int
    dst_port:  int
    protocol:  str          # tcp / udp / icmp
    start_ts:  float = field(default_factory=time.time)
    last_ts:   float = field(default_factory=time.time)
    src_bytes: int = 0
    dst_bytes: int = 0
    src_pkts:  int = 0
    dst_pkts:  int = 0
    wrong_frag: int = 0
    urgent:    int = 0
    has_syn:   bool = False
    has_fin:   bool = False
    has_rst:   bool = False
    has_ack:   bool = False
    has_data:  bool = False
    # Per-packet tracking for CICIDS features
    fwd_pkt_sizes: list = field(default_factory=list)
    bwd_pkt_sizes: list = field(default_factory=list)
    fwd_pkt_times: list = field(default_factory=list)
    bwd_pkt_times: list = field(default_factory=list)
    fin_count:  int = 0
    syn_count:  int = 0
    rst_count:  int = 0
    psh_count:  int = 0
    ack_count:  int = 0
    urg_count:  int = 0
    init_win_fwd: int = 0
    init_win_bwd: int = 0
    fwd_data_pkts: int = 0

    def duration(self) -> float:
        return round(self.last_ts - self.start_ts, 4)

    def service(self) -> str:
        return PORT_SERVICE.get(self.dst_port,
               PORT_SERVICE.get(self.src_port, "other"))

    def flag(self) -> str:
        return _tcp_flag_code(self.has_syn, self.has_fin,
                              self.has_rst, self.has_ack, self.has_data)

    def is_error(self) -> bool:
        f = self.flag()
        return f in ("S0", "S1", "REJ", "RSTR", "RSTO", "SH")

    def is_rej(self) -> bool:
        return self.flag() in ("REJ", "RSTR", "RSTO")


# ── Completed connection record ───────────────────────────────────────────────
@dataclass
class ConnRecord:
    ts:            float
    src_ip:        str
    dst_ip:        str
    src_port:      int
    dst_port:      int
    protocol:      str
    service:       str
    flag:          str
    duration:      float
    src_bytes:     int
    dst_bytes:     int
    features:      list          # 41 NSL-KDD values (raw, pre-encoding)
    prediction:    Optional[str] = None
    confidence:    Optional[float] = None
    attack_type:   Optional[str] = None
    traffic_desc:  Optional[str] = None

    def is_error(self) -> bool:
        return self.flag in ("S0", "S1", "REJ", "RSTR", "RSTO", "SH")

    def is_rej(self) -> bool:
        return self.flag in ("REJ", "RSTR", "RSTO")


# ── Sliding windows for traffic features ─────────────────────────────────────
class TrafficWindow:
    """Maintains a rolling 2-second window + per-host 100-conn history."""

    def __init__(self):
        self._recent: deque = deque()   # (ts, ConnRecord)
        self._host_hist: dict = defaultdict(deque)  # dst_ip → deque(ConnRecord)
        self._lock = threading.Lock()

    def add(self, rec: ConnRecord):
        now = time.time()
        with self._lock:
            self._recent.append((now, rec))
            # prune older than 2s
            while self._recent and now - self._recent[0][0] > 2.0:
                self._recent.popleft()
            # host history (last 100)
            dq = self._host_hist[rec.dst_ip]
            dq.append(rec)
            if len(dq) > 100:
                dq.popleft()

    def traffic_features(self, rec: ConnRecord) -> dict:
        """Compute NSL-KDD traffic + host-based features for a new record."""
        with self._lock:
            recent = list(self._recent)
            host_hist = list(self._host_hist[rec.dst_ip])

        # ── 2-second window ──
        same_dst   = [r for _, r in recent if r.dst_ip == rec.dst_ip]
        count      = len(same_dst) or 1
        srv_same   = [r for r in same_dst if r.service == rec.service]
        srv_count  = len(srv_same) or 1

        def rate(lst, pred): return sum(1 for r in lst if pred(r)) / len(lst) if lst else 0.0

        serror_rate     = rate(same_dst, lambda r: r.is_error())
        srv_serror_rate = rate(srv_same, lambda r: r.is_error())
        rerror_rate     = rate(same_dst, lambda r: r.is_rej())
        srv_rerror_rate = rate(srv_same, lambda r: r.is_rej())
        same_srv_rate   = len(srv_same) / count
        diff_srv_rate   = 1.0 - same_srv_rate

        # srv_diff_host_rate: among same-service connections, % to different hosts
        srv_diff_host = {r.dst_ip for r in srv_same}
        srv_diff_host_rate = len(srv_diff_host) / srv_count

        # ── host-based (last 100) ──
        hcount     = len(host_hist) or 1
        hsrv       = [r for r in host_hist if r.service == rec.service]
        hsrv_count = len(hsrv) or 1

        dst_host_count          = hcount
        dst_host_srv_count      = hsrv_count
        dst_host_same_srv_rate  = hsrv_count / hcount
        dst_host_diff_srv_rate  = 1.0 - dst_host_same_srv_rate
        # same src port rate
        hsame_port = [r for r in host_hist if r.src_port == rec.src_port]
        dst_host_same_src_port_rate  = len(hsame_port) / hcount
        # different hosts for same service
        hsrv_hosts = {r.src_ip for r in hsrv}
        dst_host_srv_diff_host_rate  = len(hsrv_hosts) / hsrv_count
        dst_host_serror_rate         = rate(host_hist, lambda r: r.is_error())
        dst_host_srv_serror_rate     = rate(hsrv, lambda r: r.is_error())
        dst_host_rerror_rate         = rate(host_hist, lambda r: r.is_rej())
        dst_host_srv_rerror_rate     = rate(hsrv, lambda r: r.is_rej())

        return dict(
            count=count, srv_count=srv_count,
            serror_rate=round(serror_rate, 4),
            srv_serror_rate=round(srv_serror_rate, 4),
            rerror_rate=round(rerror_rate, 4),
            srv_rerror_rate=round(srv_rerror_rate, 4),
            same_srv_rate=round(same_srv_rate, 4),
            diff_srv_rate=round(diff_srv_rate, 4),
            srv_diff_host_rate=round(srv_diff_host_rate, 4),
            dst_host_count=dst_host_count,
            dst_host_srv_count=dst_host_srv_count,
            dst_host_same_srv_rate=round(dst_host_same_srv_rate, 4),
            dst_host_diff_srv_rate=round(dst_host_diff_srv_rate, 4),
            dst_host_same_src_port_rate=round(dst_host_same_src_port_rate, 4),
            dst_host_srv_diff_host_rate=round(dst_host_srv_diff_host_rate, 4),
            dst_host_serror_rate=round(dst_host_serror_rate, 4),
            dst_host_srv_serror_rate=round(dst_host_srv_serror_rate, 4),
            dst_host_rerror_rate=round(dst_host_rerror_rate, 4),
            dst_host_srv_rerror_rate=round(dst_host_srv_rerror_rate, 4),
        )


# ── Feature vector builder ────────────────────────────────────────────────────
NSL_KDD_COLS = [
    "duration", "protocol_type", "service", "flag", "src_bytes", "dst_bytes",
    "land", "wrong_fragment", "urgent", "hot", "num_failed_logins", "logged_in",
    "num_compromised", "root_shell", "su_attempted", "num_root",
    "num_file_creations", "num_shells", "num_access_files", "num_outbound_cmds",
    "is_host_login", "is_guest_login", "count", "srv_count",
    "serror_rate", "srv_serror_rate", "rerror_rate", "srv_rerror_rate",
    "same_srv_rate", "diff_srv_rate", "srv_diff_host_rate",
    "dst_host_count", "dst_host_srv_count",
    "dst_host_same_srv_rate", "dst_host_diff_srv_rate",
    "dst_host_same_src_port_rate", "dst_host_srv_diff_host_rate",
    "dst_host_serror_rate", "dst_host_srv_serror_rate",
    "dst_host_rerror_rate", "dst_host_srv_rerror_rate",
]

def build_feature_dict(flow: Flow, traffic: dict) -> dict:
    land = 1 if flow.src_ip == flow.dst_ip else 0
    proto = flow.protocol  # "tcp" / "udp" / "icmp"
    return {
        "duration":           flow.duration(),
        "protocol_type":      proto,
        "service":            flow.service(),
        "flag":               flow.flag() if proto == "tcp" else "SF",
        "src_bytes":          flow.src_bytes,
        "dst_bytes":          flow.dst_bytes,
        "land":               land,
        "wrong_fragment":     flow.wrong_frag,
        "urgent":             flow.urgent,
        # Content features — require app-layer DPI, set to 0
        "hot": 0, "num_failed_logins": 0, "logged_in": 0,
        "num_compromised": 0, "root_shell": 0, "su_attempted": 0,
        "num_root": 0, "num_file_creations": 0, "num_shells": 0,
        "num_access_files": 0, "num_outbound_cmds": 0,
        "is_host_login": 0, "is_guest_login": 0,
        **traffic,
    }


def _stat(lst):
    """Mean, std, max, min of a list. Returns (mean, std, max, min)."""
    if not lst:
        return 0.0, 0.0, 0.0, 0.0
    arr = np.array(lst, dtype=float)
    return float(arr.mean()), float(arr.std()), float(arr.max()), float(arr.min())


def _iats(times):
    """Inter-arrival times from a sorted list of timestamps (seconds → microseconds)."""
    if len(times) < 2:
        return []
    return [(times[i] - times[i-1]) * 1e6 for i in range(1, len(times))]


def build_cicids_feature_dict(flow: Flow) -> dict:
    """
    Compute CICFlowMeter-compatible features from a completed flow.
    Returns a dict keyed by the CICIDS2017 column names (after dropping
    zero-variance and high-correlation features used in training).
    """
    dur_us  = max((flow.last_ts - flow.start_ts) * 1e6, 1.0)
    dur_s   = dur_us / 1e6
    total_pkts  = flow.src_pkts + flow.dst_pkts
    total_bytes = flow.src_bytes + flow.dst_bytes

    fwd_len_mean, fwd_len_std, fwd_len_max, fwd_len_min = _stat(flow.fwd_pkt_sizes)
    bwd_len_mean, bwd_len_std, bwd_len_max, bwd_len_min = _stat(flow.bwd_pkt_sizes)

    all_sizes = flow.fwd_pkt_sizes + flow.bwd_pkt_sizes
    pkt_mean, pkt_std, pkt_max, pkt_min = _stat(all_sizes)
    pkt_var = float(np.var(all_sizes)) if all_sizes else 0.0

    all_times = sorted(flow.fwd_pkt_times + flow.bwd_pkt_times)
    flow_iats  = _iats(all_times)
    fwd_iats   = _iats(sorted(flow.fwd_pkt_times))
    bwd_iats   = _iats(sorted(flow.bwd_pkt_times))

    fi_mean, fi_std, fi_max, fi_min = _stat(flow_iats)
    fwd_iat_mean, fwd_iat_std, _fwd_iat_max, fwd_iat_min = _stat(fwd_iats)
    bwd_iat_mean, bwd_iat_std, bwd_iat_max, bwd_iat_min = _stat(bwd_iats)
    bwd_iat_total = sum(bwd_iats)

    flow_bytes_s = total_bytes / dur_s
    flow_pkts_s  = total_pkts / dur_s
    fwd_pkts_s   = flow.src_pkts / dur_s
    bwd_pkts_s   = flow.dst_pkts / dur_s

    fwd_hdr = 20 * flow.src_pkts   # TCP header ~20 bytes
    bwd_hdr = 20 * flow.dst_pkts
    avg_bwd_seg = flow.dst_bytes / flow.dst_pkts if flow.dst_pkts else 0.0
    down_up = flow.dst_bytes / flow.src_bytes if flow.src_bytes else 0.0

    return {
        "Destination Port":              float(flow.dst_port),
        "Flow Duration":                 dur_us,
        "Total Fwd Packets":             float(flow.src_pkts),
        "Total Backward Packets":        float(flow.dst_pkts),
        "Total Length of Fwd Packets":   float(flow.src_bytes),
        "Total Length of Bwd Packets":   float(flow.dst_bytes),
        "Fwd Packet Length Max":         fwd_len_max,
        "Fwd Packet Length Min":         fwd_len_min,
        "Fwd Packet Length Mean":        fwd_len_mean,
        "Bwd Packet Length Max":         bwd_len_max,
        "Bwd Packet Length Min":         bwd_len_min,
        "Bwd Packet Length Mean":        bwd_len_mean,
        "Flow Bytes/s":                  flow_bytes_s,
        "Flow Packets/s":                flow_pkts_s,
        "Flow IAT Mean":                 fi_mean,
        "Flow IAT Std":                  fi_std,
        "Flow IAT Max":                  fi_max,
        "Flow IAT Min":                  fi_min,
        "Fwd IAT Mean":                  fwd_iat_mean,
        "Fwd IAT Std":                   fwd_iat_std,
        "Fwd IAT Min":                   fwd_iat_min,
        "Bwd IAT Total":                 bwd_iat_total,
        "Bwd IAT Mean":                  bwd_iat_mean,
        "Bwd IAT Std":                   bwd_iat_std,
        "Bwd IAT Max":                   bwd_iat_max,
        "Bwd IAT Min":                   bwd_iat_min,
        "Fwd Header Length":             float(fwd_hdr),
        "Bwd Header Length":             float(bwd_hdr),
        "Fwd Packets/s":                 fwd_pkts_s,
        "Bwd Packets/s":                 bwd_pkts_s,
        "Min Packet Length":             pkt_min,
        "Max Packet Length":             pkt_max,
        "Packet Length Mean":            pkt_mean,
        "Packet Length Std":             pkt_std,
        "Packet Length Variance":        pkt_var,
        "FIN Flag Count":                float(flow.fin_count),
        "SYN Flag Count":                float(flow.syn_count),
        "RST Flag Count":                float(flow.rst_count),
        "PSH Flag Count":                float(flow.psh_count),
        "ACK Flag Count":                float(flow.ack_count),
        "URG Flag Count":                float(flow.urg_count),
        "Down/Up Ratio":                 down_up,
        "Avg Bwd Segment Size":          avg_bwd_seg,
        "Fwd Header Length.1":           float(fwd_hdr),
        "Subflow Fwd Packets":           float(flow.src_pkts),
        "Subflow Fwd Bytes":             float(flow.src_bytes),
        "Subflow Bwd Packets":           float(flow.dst_pkts),
        "Subflow Bwd Bytes":             float(flow.dst_bytes),
        "Init_Win_bytes_forward":        float(flow.init_win_fwd),
        "Init_Win_bytes_backward":       float(flow.init_win_bwd),
        "act_data_pkt_fwd":              float(flow.fwd_data_pkts),
        "min_seg_size_forward":          fwd_len_min,
        "Active Mean":  0.0, "Active Std":  0.0, "Active Max":  0.0, "Active Min":  0.0,
        "Idle Mean":    0.0, "Idle Std":    0.0, "Idle Max":    0.0, "Idle Min":    0.0,
    }


def encode_and_predict(feat_dict: dict, model_artifact: dict) -> tuple[str, float]:
    """Apply saved encoders + scaler, then predict."""
    import warnings
    encoders      = model_artifact["encoders"]
    model         = model_artifact["model"]
    feature_cols  = encoders.get("feature_cols", NSL_KDD_COLS)
    scaler        = encoders.get("scaler")

    row = []
    for col in feature_cols:
        val = feat_dict.get(col, 0)
        # Categorical encoding
        if col == "protocol_type":
            le = encoders.get("le_protocol_type")
            val = le.transform([str(val)])[0] if le and str(val) in le.classes_ else 0
        elif col == "service":
            le = encoders.get("le_service")
            val = le.transform([str(val)])[0] if le and str(val) in le.classes_ else 0
        elif col == "flag":
            le = encoders.get("le_flag")
            val = le.transform([str(val)])[0] if le and str(val) in le.classes_ else 0
        row.append(float(val))

    X = np.array(row).reshape(1, -1)
    if scaler:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            X = scaler.transform(X)

    pred  = int(model.predict(X)[0])
    try:
        proba = float(model.predict_proba(X)[0][pred])
    except Exception:
        proba = 1.0

    label = "Attack" if pred == 1 else "Normal"
    return label, round(proba, 4)


# ── Known-safe IP prefixes (CDN, DNS, major cloud) ───────────────────────────
# For NSL-KDD: these are modern services that 1999 model can't know as "normal".
# If model returns Attack with low-medium confidence for these, override to Normal.
_SAFE_PREFIXES = (
    "1.1.1.", "8.8.8.", "8.8.4.",          # Cloudflare DNS, Google DNS
    "142.250.", "172.217.", "216.58.", "64.233.", "74.125.",
    "34.64.", "34.96.", "35.190.", "34.128.", "34.160.",  # Google / GCP
    "104.16.", "104.17.", "104.18.", "104.19.", "104.20.", "104.21.",
    "172.64.", "172.65.", "172.66.", "172.67.", "162.159.",  # Cloudflare
    "23.44.", "23.32.", "23.195.", "151.101.", "199.232.",   # Akamai / Fastly
    "52.96.", "52.112.", "52.108.", "13.107.", "40.96.",     # Microsoft
    "52.94.", "54.239.", "13.35.", "18.160.", "52.84.",      # Amazon CloudFront
    "157.240.", "31.13.",                                    # Meta
    "239.255.255.", "224.0.0.",                              # Multicast (always normal)
    # NOTE: LAN (192.168., 10., etc.) intentionally NOT here — local IPs can be attackers
)

def _is_known_safe(dst_ip: str, dst_port: int, protocol: str) -> bool:
    """Returns True if traffic to this destination is clearly a normal CDN/cloud service."""
    if any(dst_ip.startswith(p) for p in _SAFE_PREFIXES):
        return True
    # NTP
    if dst_port == 123 and protocol == "udp":
        return True
    return False


# ── Known IP ranges for traffic description ───────────────────────────────────
_IP_RANGES = [
    # Google / YouTube
    ("142.250.", "YouTube/Google"),   ("172.217.", "Google"),
    ("216.58.",  "Google"),           ("64.233.",  "Google"),
    ("74.125.",  "Google/YouTube"),   ("34.64.",   "Google Cloud"),
    ("34.96.",   "Google Cloud"),     ("35.190.",  "Google Cloud"),
    # Cloudflare
    ("1.1.1.",   "Cloudflare DNS"),   ("104.16.",  "Cloudflare CDN"),
    ("104.17.",  "Cloudflare CDN"),   ("104.18.",  "Cloudflare CDN"),
    ("104.19.",  "Cloudflare CDN"),   ("104.20.",  "Cloudflare CDN"),
    ("104.21.",  "Cloudflare CDN"),   ("172.64.",  "Cloudflare"),
    ("172.65.",  "Cloudflare"),       ("172.66.",  "Cloudflare"),
    # Akamai / CDN
    ("23.44.",   "Akamai CDN"),       ("23.32.",   "Akamai CDN"),
    ("23.195.",  "Akamai CDN"),       ("151.101.", "Fastly CDN"),
    ("199.232.", "Fastly CDN"),
    # Microsoft / Azure
    ("52.96.",   "Microsoft/Teams"),  ("52.112.",  "Microsoft Teams"),
    ("52.108.",  "Microsoft/O365"),   ("52.168.",  "Microsoft Azure"),
    ("13.107.",  "Microsoft"),        ("40.96.",   "Microsoft"),
    # Amazon / AWS
    ("52.94.",   "Amazon AWS"),       ("54.239.",  "Amazon AWS"),
    ("13.35.",   "Amazon CloudFront"),("18.160.",  "Amazon CloudFront"),
    ("52.84.",   "Amazon CloudFront"),
    # Facebook / Meta
    ("157.240.", "Meta/Facebook"),    ("31.13.",   "Meta/Facebook"),
    # Twitter / X
    ("104.244.", "Twitter/X"),
]

_PORT_DESC = {
    80: "HTTP", 443: "HTTPS", 53: "DNS", 22: "SSH", 21: "FTP",
    25: "SMTP", 587: "SMTP", 465: "SMTP-SSL", 110: "POP3", 143: "IMAP",
    993: "IMAP-SSL", 995: "POP3-SSL", 3306: "MySQL", 5432: "PostgreSQL",
    3389: "RDP", 5900: "VNC", 23: "Telnet", 179: "BGP", 67: "DHCP",
    68: "DHCP", 123: "NTP", 161: "SNMP", 8080: "HTTP-Alt", 8443: "HTTPS-Alt",
    6667: "IRC", 6881: "BitTorrent", 1194: "OpenVPN", 1723: "PPTP",
    500: "IPsec/VPN", 4500: "IPsec NAT",
}


def describe_traffic(src_ip: str, dst_ip: str, dst_port: int, protocol: str, src_bytes: int, dst_bytes: int) -> str:
    """Human-readable description of a connection."""
    # Identify destination service/org
    org = None
    for prefix, name in _IP_RANGES:
        if dst_ip.startswith(prefix):
            org = name
            break

    port_name = _PORT_DESC.get(dst_port, f":{dst_port}")
    total_bytes = src_bytes + dst_bytes

    if total_bytes >= 1_048_576:
        size_str = f"{total_bytes/1_048_576:.1f} MB"
    elif total_bytes >= 1024:
        size_str = f"{total_bytes/1024:.0f} KB"
    else:
        size_str = f"{total_bytes} B"

    if org:
        return f"{protocol.upper()} {port_name} → {org} ({size_str})"
    return f"{protocol.upper()} {port_name} a {dst_ip} ({size_str})"


def infer_attack_type(flow: "Flow", dataset: str) -> str:
    """
    Infer attack subcategory from flow features using heuristics.
    Returns a short label like 'DoS', 'Scan', 'Brute Force', etc.
    """
    duration   = flow.duration()
    src_bytes  = flow.src_bytes
    dst_bytes  = flow.dst_bytes
    src_pkts   = flow.src_pkts
    dst_pkts   = flow.dst_pkts
    dst_port   = flow.dst_port
    proto      = flow.protocol
    has_data   = flow.has_data
    syn_count  = flow.syn_count
    rst_count  = flow.rst_count
    fin_count  = flow.fin_count

    total_pkts = src_pkts + dst_pkts
    pkt_rate   = total_pkts / max(duration, 0.01)
    byte_rate  = (src_bytes + dst_bytes) / max(duration, 0.01)

    # DoS / DDoS: high rate, short duration, little response
    if pkt_rate > 500 or byte_rate > 500_000:
        if dst_bytes < src_bytes * 0.1:
            return "DoS/DDoS"
        return "Flood"

    # SYN flood: many SYNs, no data, no FIN
    if syn_count > 3 and not has_data and fin_count == 0:
        return "SYN Flood"

    # Port scan: short, no data, RST or no reply
    if duration < 0.5 and not has_data and (rst_count > 0 or dst_bytes == 0):
        if proto == "tcp":
            return "Port Scan"
        if proto == "udp":
            return "UDP Scan"
        if proto == "icmp":
            return "ICMP Scan"

    # Brute force: repeated short connections to auth ports
    if dst_port in (22, 23, 21, 3389, 5900) and duration < 5 and src_pkts < 30:
        return "Brute Force"

    # SQL injection / web attacks
    if dst_port in (80, 443, 8080, 8443) and src_bytes > dst_bytes * 2 and src_bytes > 1000:
        return "Web Attack"

    # DNS amplification / exfiltration
    if proto == "udp" and dst_port == 53 and src_bytes > 500:
        return "DNS Abuse"

    # Data exfiltration: large outbound, suspicious port
    if src_bytes > 100_000 and dst_port not in (80, 443, 8080):
        return "Exfiltración"

    # CICIDS specific — DDoS patterns (high traffic, balanced pkts)
    if dataset == "cicids":
        if pkt_rate > 200 and dst_bytes > 0:
            return "DDoS"

    return "Anomalía"


# ── Capture session ───────────────────────────────────────────────────────────
class CaptureSession:
    FLOW_TIMEOUT = 8.0    # seconds before idle flow is flushed (shorter = faster detection)

    def __init__(self):
        self._flows:    dict  = {}           # key → Flow
        self._results:  deque = deque(maxlen=200)
        self._window  = TrafficWindow()
        self._lock    = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._iface   = None
        self._model_artifact = None
        self._dataset = "nslkdd"
        self.stats    = {"total": 0, "attacks": 0, "normal": 0}
        # Single DB writer queue — avoids spawning 1 thread per packet during floods
        self._db_queue: queue.Queue = queue.Queue(maxsize=500)
        self._db_thread = threading.Thread(target=self._db_worker, daemon=True)
        self._db_thread.start()

    def start(self, iface: str, model_artifact: dict, dataset: str = "nslkdd"):
        if self._running:
            return
        self._iface           = iface
        self._model_artifact  = model_artifact
        self._dataset         = dataset
        self._running         = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        # Background thread to flush timed-out flows
        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._flush_thread.start()

    def stop(self):
        self._running = False

    def is_running(self) -> bool:
        return self._running

    def get_results(self) -> list:
        with self._lock:
            return list(self._results)

    # ── Packet handler ────────────────────────────────────────────────────────
    def _packet_handler(self, pkt):
        if not self._running:
            return
        if not pkt.haslayer(IP):
            return

        ip  = pkt[IP]
        now = time.time()

        if pkt.haslayer(TCP):
            proto    = "tcp"
            l4       = pkt[TCP]
            sport, dport = l4.sport, l4.dport
            payload  = len(bytes(l4.payload))
            flags    = l4.flags
            syn = bool(flags & 0x02)
            ack = bool(flags & 0x10)
            fin = bool(flags & 0x01)
            rst = bool(flags & 0x04)
            urg = bool(flags & 0x20)
            wrong_frag = int(ip.frag != 0)
        elif pkt.haslayer(UDP):
            proto    = "udp"
            l4       = pkt[UDP]
            sport, dport = l4.sport, l4.dport
            payload  = len(bytes(l4.payload))
            syn = fin = rst = ack = urg = False
            wrong_frag = 0
        elif pkt.haslayer(ICMP):
            proto  = "icmp"
            sport  = dport = 0
            payload = len(bytes(pkt[ICMP].payload))
            syn = fin = rst = ack = urg = False
            wrong_frag = 0
        else:
            return

        # Bidirectional key: always (smaller_ip, larger_ip, ...)
        fwd_key = (ip.src, ip.dst, sport, dport, proto)
        rev_key = (ip.dst, ip.src, dport, sport, proto)

        with self._lock:
            if fwd_key in self._flows:
                key, direction = fwd_key, "fwd"
            elif rev_key in self._flows:
                key, direction = rev_key, "rev"
            else:
                key, direction = fwd_key, "fwd"
                self._flows[key] = Flow(
                    src_ip=ip.src, dst_ip=ip.dst,
                    src_port=sport, dst_port=dport,
                    protocol=proto, start_ts=now, last_ts=now,
                )

            flow = self._flows[key]
            flow.last_ts = now

            if direction == "fwd":
                flow.src_bytes += payload
                flow.src_pkts  += 1
                flow.fwd_pkt_sizes.append(payload)
                flow.fwd_pkt_times.append(now)
                if payload > 0:
                    flow.fwd_data_pkts += 1
            else:
                flow.dst_bytes += payload
                flow.dst_pkts  += 1
                flow.bwd_pkt_sizes.append(payload)
                flow.bwd_pkt_times.append(now)

            if syn:
                flow.has_syn  = True
                flow.syn_count += 1
                if pkt.haslayer(TCP):
                    win = pkt[TCP].window
                    if direction == "fwd" and flow.init_win_fwd == 0:
                        flow.init_win_fwd = win
                    elif direction == "rev" and flow.init_win_bwd == 0:
                        flow.init_win_bwd = win
            if fin:
                flow.has_fin  = True
                flow.fin_count += 1
            if rst:
                flow.has_rst  = True
                flow.rst_count += 1
            if ack:
                flow.has_ack  = True
                flow.ack_count += 1
            if urg:
                flow.urgent    += 1
                flow.urg_count += 1
            if pkt.haslayer(TCP) and bool(pkt[TCP].flags & 0x08):  # PSH
                flow.psh_count += 1
            if payload > 0:
                flow.has_data = True
            flow.wrong_frag += wrong_frag

            # Close on FIN or RST
            if fin or rst:
                self._finalize_flow(key, flow)

    def _finalize_flow(self, key, flow: Flow):
        """Extract features, classify, record. Must be called under self._lock."""
        if key in self._flows:
            del self._flows[key]
        else:
            return

        if self._dataset == "cicids":
            feat_dict = build_cicids_feature_dict(flow)
        else:
            feat_dict = build_feature_dict(flow, {
                "count": 1, "srv_count": 1,
                "serror_rate": 0.0, "srv_serror_rate": 0.0,
                "rerror_rate": 0.0, "srv_rerror_rate": 0.0,
                "same_srv_rate": 1.0, "diff_srv_rate": 0.0,
                "srv_diff_host_rate": 0.0,
                "dst_host_count": 1, "dst_host_srv_count": 1,
                "dst_host_same_srv_rate": 1.0, "dst_host_diff_srv_rate": 0.0,
                "dst_host_same_src_port_rate": 0.0,
                "dst_host_srv_diff_host_rate": 0.0,
                "dst_host_serror_rate": 0.0, "dst_host_srv_serror_rate": 0.0,
                "dst_host_rerror_rate": 0.0, "dst_host_srv_rerror_rate": 0.0,
            })

        rec = ConnRecord(
            ts=time.time(), src_ip=flow.src_ip, dst_ip=flow.dst_ip,
            src_port=flow.src_port, dst_port=flow.dst_port,
            protocol=flow.protocol, service=flow.service(),
            flag=flow.flag(), duration=flow.duration(),
            src_bytes=flow.src_bytes, dst_bytes=flow.dst_bytes,
            features=list(feat_dict.values()),
        )

        # Para NSL-KDD: enriquecer con ventana de tráfico deslizante
        if self._dataset != "cicids":
            traffic = self._window.traffic_features(rec)
            feat_dict.update(traffic)
            rec.features = [feat_dict.get(c, 0) for c in NSL_KDD_COLS]

        # Classify
        # NSL-KDD threshold higher (1999 data → more false positives on modern traffic)
        # CICIDS2017 threshold lower (2017 data → more reliable on modern traffic)
        CONFIDENCE_THRESHOLD = 0.70 if self._dataset == "nslkdd" else 0.50

        # NSL-KDD only: suppress false positives on known CDN/cloud destinations.
        # Check ONLY dst_ip — src_ip being local does NOT mean traffic is safe
        # (a LAN IP like 192.168.x.x can be an attacker inside the network).
        # CICIDS2017 is trained on modern traffic so no override needed.
        force_normal = (
            self._dataset == "nslkdd" and
            _is_known_safe(flow.dst_ip, flow.dst_port, flow.protocol)
        )

        # ── Heuristic pre-classification (obvious attack patterns) ──────────────
        # Applied BEFORE the ML model. If a flow matches a known attack pattern,
        # we classify it directly without waiting for model confidence.
        heuristic_label = None
        heuristic_conf  = 0.92
        heuristic_type  = None
        dur   = flow.duration()
        total_pkts = flow.src_pkts + flow.dst_pkts
        pkt_rate   = total_pkts / max(dur, 0.001)
        byte_rate  = (flow.src_bytes + flow.dst_bytes) / max(dur, 0.001)

        if not force_normal:
            # Port scan: SYN-only probe (no data, no FIN, RST reply or no reply).
            # Requires src_pkts <= 2 to exclude normal connections that get RST
            # after data exchange (e.g., HTTP to a closed port after TLS).
            if (flow.protocol == "tcp"
                    and dur < 1.0
                    and flow.syn_count >= 1
                    and flow.fin_count == 0
                    and not flow.has_data
                    and flow.src_pkts <= 2
                    and (flow.rst_count > 0 or flow.dst_bytes == 0)):
                heuristic_label = "Attack"
                heuristic_type  = "Port Scan"
                heuristic_conf  = 0.91

            # SYN flood: many SYNs from same source, no data, no FIN
            elif (flow.protocol == "tcp"
                    and flow.syn_count > 10
                    and not flow.has_data
                    and flow.fin_count == 0
                    and flow.src_pkts > 10):
                heuristic_label = "Attack"
                heuristic_type  = "SYN Flood"
                heuristic_conf  = 0.95

            # DoS / DDoS: high rate AND clearly asymmetric (attacker sends, target silent)
            elif (pkt_rate > 500
                    and flow.src_pkts > 50
                    and flow.dst_pkts < flow.src_pkts * 0.05):
                heuristic_label = "Attack"
                heuristic_type  = "DoS/DDoS"
                heuristic_conf  = 0.93

            # UDP flood: many small UDP packets, no response at all
            elif (flow.protocol == "udp"
                    and flow.src_pkts > 50
                    and flow.dst_pkts == 0
                    and pkt_rate > 100):
                heuristic_label = "Attack"
                heuristic_type  = "UDP Flood"
                heuristic_conf  = 0.90

        if self._model_artifact:
            try:
                label, conf = encode_and_predict(feat_dict, self._model_artifact)
                # Override: CDN/cloud traffic → always Normal (NSL-KDD 1999 bias)
                if force_normal and label == "Attack":
                    label = "Normal"
                # Downgrade low-confidence attacks to Normal
                elif label == "Attack" and conf < CONFIDENCE_THRESHOLD:
                    label = "Normal"

                # Heuristic wins over model for obvious patterns
                if heuristic_label == "Attack":
                    label = "Attack"
                    conf  = max(conf, heuristic_conf)

                rec.prediction  = label
                rec.confidence  = conf
                if label == "Attack":
                    rec.attack_type = heuristic_type or infer_attack_type(flow, self._dataset)
                else:
                    rec.attack_type = None
            except Exception:
                rec.prediction = "Unknown"
                rec.confidence = 0.0

        rec.traffic_desc = describe_traffic(
            flow.src_ip, flow.dst_ip, flow.dst_port,
            flow.protocol, flow.src_bytes, flow.dst_bytes,
        )

        self._window.add(rec)
        self._results.append(rec)
        self.stats["total"] += 1
        if rec.prediction == "Attack":
            self.stats["attacks"] += 1
        else:
            self.stats["normal"] += 1

        # Enqueue for DB write — non-blocking, drops if queue full (flood scenario)
        try:
            self._db_queue.put_nowait(rec)
        except queue.Full:
            pass

    def _db_worker(self):
        """Single background thread that drains the DB queue — no per-packet threads."""
        from app.db.database import SessionLocal, CaptureLog
        model_name = None
        while True:
            try:
                rec = self._db_queue.get(timeout=2)
            except queue.Empty:
                continue
            try:
                if model_name is None and self._model_artifact:
                    model_name = (
                        self._model_artifact.get("encoders", {}).get("model_name") or
                        type(self._model_artifact.get("model", "")).__name__
                    )
                db = SessionLocal()
                try:
                    db.add(CaptureLog(
                        ts=rec.ts, src_ip=rec.src_ip, dst_ip=rec.dst_ip,
                        src_port=rec.src_port, dst_port=rec.dst_port,
                        protocol=rec.protocol, service=rec.service,
                        flag=rec.flag, duration=rec.duration,
                        src_bytes=rec.src_bytes, dst_bytes=rec.dst_bytes,
                        prediction=rec.prediction, confidence=rec.confidence,
                        attack_type=rec.attack_type, traffic_desc=rec.traffic_desc,
                        dataset=self._dataset, model_name=model_name,
                    ))
                    db.commit()
                finally:
                    db.close()
            except Exception:
                pass

    def _flush_loop(self):
        """Periodically finalize flows that haven't seen packets in FLOW_TIMEOUT seconds."""
        while self._running:
            time.sleep(5)
            now = time.time()
            with self._lock:
                timed_out = [k for k, f in self._flows.items()
                             if now - f.last_ts > self.FLOW_TIMEOUT]
                for k in timed_out:
                    self._finalize_flow(k, self._flows.get(k))

    def _capture_loop(self):
        try:
            sniff(
                iface=self._iface,
                prn=self._packet_handler,
                store=False,
                stop_filter=lambda _: not self._running,
            )
        except Exception as e:
            print(f"[capture] Error: {e}")
            self._running = False


# ── Global session (one at a time) ───────────────────────────────────────────
_session: Optional[CaptureSession] = None
_session_lock = threading.Lock()


def get_session() -> Optional[CaptureSession]:
    return _session


_SKIP_DESC_CONTAINS = (
    "WAN Miniport", "6to4", "Teredo", "IP-HTTPS", "Kernel Debug",
    "RAS Async", "PANGP Virtual", "Citrix Virtual",
)
_SKIP_FILTER_SUFFIXES = (
    "-WFP Native", "-Npcap Packet", "-Deterministic", "-QoS Packet",
    "-WFP 802.3", "-VirtualBox NDIS", "-Virtual WiFi", "-Native WiFi",
)

def get_interfaces() -> list[dict]:
    """Returns only real network interfaces with human-readable names."""
    if not SCAPY_AVAILABLE:
        return []

    # Build IP map: psutil interface name → IPv4 address
    ip_map = {}
    try:
        import psutil
        for name, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == 2:  # AF_INET
                    ip_map[name] = addr.address
    except Exception:
        pass

    try:
        from scapy.arch.windows import get_windows_if_list
        raw = get_windows_if_list()

        result = []
        seen = set()
        for iface in raw:
            dev  = iface.get("name", "")
            desc = (iface.get("description", "") or dev).strip()

            # Skip filter-driver chains and virtual/irrelevant adapters
            if any(s in desc for s in _SKIP_DESC_CONTAINS):
                continue
            if any(dev.endswith(s) for s in _SKIP_FILTER_SUFFIXES) or \
               any(s in dev for s in _SKIP_FILTER_SUFFIXES):
                continue
            if desc in seen:
                continue
            seen.add(desc)

            # Clean vendor prefixes for readability
            clean = desc.replace("Intel(R) ", "").replace("Realtek(R) ", "") \
                        .replace("Realtek ", "").replace("Microsoft ", "")

            label = clean

            result.append({"id": dev, "label": label, "description": clean})

        return result if result else [{"id": i, "label": i, "description": i} for i in get_if_list()]

    except Exception:
        return [{"id": i, "label": i, "description": i} for i in get_if_list()]


def start_capture(iface: str, model_artifact: dict, dataset: str = "nslkdd") -> CaptureSession:
    global _session
    with _session_lock:
        if _session and _session.is_running():
            _session.stop()
        _session = CaptureSession()
        _session.start(iface, model_artifact, dataset=dataset)
        return _session


def stop_capture():
    global _session
    with _session_lock:
        if _session:
            _session.stop()
