"""
Real-time packet capture with NSL-KDD feature extraction.
Requires Scapy + Npcap (Windows) or libpcap (Linux/Mac).
"""
import threading
import time
import json
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


def encode_and_predict(feat_dict: dict, model_artifact: dict) -> tuple[str, float]:
    """Apply saved encoders + scaler, then predict."""
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
        X = scaler.transform(X)

    pred  = int(model.predict(X)[0])
    try:
        proba = float(model.predict_proba(X)[0][pred])
    except Exception:
        proba = 1.0

    label = "Attack" if pred == 1 else "Normal"
    return label, round(proba, 4)


# ── Capture session ───────────────────────────────────────────────────────────
class CaptureSession:
    FLOW_TIMEOUT = 30.0   # seconds before idle flow is flushed

    def __init__(self):
        self._flows:    dict  = {}           # key → Flow
        self._results:  deque = deque(maxlen=200)
        self._window  = TrafficWindow()
        self._lock    = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._iface   = None
        self._model_artifact = None
        self.stats    = {"total": 0, "attacks": 0, "normal": 0}

    def start(self, iface: str, model_artifact: dict):
        if self._running:
            return
        self._iface           = iface
        self._model_artifact  = model_artifact
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
            else:
                flow.dst_bytes += payload
                flow.dst_pkts  += 1

            if syn:       flow.has_syn  = True
            if fin:       flow.has_fin  = True
            if rst:       flow.has_rst  = True
            if ack:       flow.has_ack  = True
            if payload > 0: flow.has_data = True
            if urg:       flow.urgent   += 1
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
            features=[feat_dict.get(c, 0) for c in NSL_KDD_COLS],
        )

        # Compute traffic features using window (after basic record)
        traffic = self._window.traffic_features(rec)
        feat_dict.update(traffic)
        rec.features = [feat_dict.get(c, 0) for c in NSL_KDD_COLS]

        # Classify
        if self._model_artifact:
            try:
                label, conf = encode_and_predict(feat_dict, self._model_artifact)
                rec.prediction  = label
                rec.confidence  = conf
            except Exception as e:
                rec.prediction = "Unknown"
                rec.confidence = 0.0

        self._window.add(rec)
        self._results.append(rec)
        self.stats["total"] += 1
        if rec.prediction == "Attack":
            self.stats["attacks"] += 1
        else:
            self.stats["normal"] += 1

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


def start_capture(iface: str, model_artifact: dict) -> CaptureSession:
    global _session
    with _session_lock:
        if _session and _session.is_running():
            _session.stop()
        _session = CaptureSession()
        _session.start(iface, model_artifact)
        return _session


def stop_capture():
    global _session
    with _session_lock:
        if _session:
            _session.stop()
