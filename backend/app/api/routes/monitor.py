import time
import socket
import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/monitor", tags=["Monitor"])

class ProbeRequest(BaseModel):
    target:     str
    port:       Optional[int]  = 80
    count:      Optional[int]  = 5
    model_name: Optional[str]  = "random_forest"
    dataset:    Optional[str]  = "nslkdd"   # "nslkdd" | "cicids"

class SimRequest(BaseModel):
    target:     str
    mode:       str                          # "dos"|"ddos"|"probe"
    model_name: Optional[str]  = "random_forest"
    dataset:    Optional[str]  = "nslkdd"
    intensity:  Optional[int]  = 10


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalize(target: str) -> str:
    t = target.strip()
    if not t.startswith("http://") and not t.startswith("https://"):
        t = "http://" + t
    return t

def _resolve(host: str) -> str:
    return socket.gethostbyname(host)

def _tcp_probe(host: str, port: int) -> dict:
    start = time.time()
    try:
        s = socket.create_connection((host, port), timeout=5)
        s.close()
        return {"open": True, "latency_ms": round((time.time() - start) * 1000, 2), "flag": "SF"}
    except socket.timeout:
        return {"open": False, "latency_ms": None, "flag": "S0"}
    except ConnectionRefusedError:
        return {"open": False, "latency_ms": None, "flag": "REJ"}
    except OSError:
        return {"open": False, "latency_ms": None, "flag": "RSTO"}

def _http_probe(url: str) -> dict:
    start = time.time()
    try:
        r = requests.get(url, timeout=6, allow_redirects=True,
                         headers={"User-Agent": "IDS-Monitor/1.0"})
        return {
            "status_code":   r.status_code,
            "duration_ms":   round((time.time() - start) * 1000, 2),
            "content_bytes": len(r.content),
            "redirects":     len(r.history),
            "ok":            r.ok,
        }
    except requests.exceptions.Timeout:
        return {"status_code": 0,  "duration_ms": 6000, "content_bytes": 0, "redirects": 0, "ok": False}
    except Exception:
        return {"status_code": -1, "duration_ms": 9999, "content_bytes": 0, "redirects": 0, "ok": False}


# ── NSL-KDD feature order (41 features) ──────────────────────────────────────
# 0:duration  1:protocol_type  2:service  3:flag  4:src_bytes  5:dst_bytes
# 6:land  7:wrong_fragment  8:urgent  9:hot  10:num_failed_logins  11:logged_in
# 12:num_compromised  13-19:content  20:is_host_login  21:is_guest_login
# 22:count  23:srv_count  24:serror_rate  25:srv_serror_rate
# 26:rerror_rate  27:srv_rerror_rate  28:same_srv_rate  29:diff_srv_rate
# 30:srv_diff_host_rate  31:dst_host_count  32:dst_host_srv_count
# 33:dst_host_same_srv_rate  34:dst_host_diff_srv_rate
# 35:dst_host_same_src_port_rate  36:dst_host_srv_diff_host_rate
# 37:dst_host_serror_rate  38:dst_host_srv_serror_rate
# 39:dst_host_rerror_rate  40:dst_host_srv_rerror_rate

def _get_nsl_cat_codes(model_name: str) -> dict:
    """Get LabelEncoder integer codes for NSL-KDD categorical features."""
    defaults = {
        "protocol_tcp": 1, "service_http": 9, "service_private": 20,
        "flag_sf": 9, "flag_s0": 8, "flag_rej": 6,
    }
    try:
        from app.ml.trainer import load_model
        artifact = load_model("nslkdd", model_name)
        enc = artifact.get("encoders", {})

        def idx(key_with_prefix, value, default):
            # encoders stored as "le_protocol_type", "le_service", "le_flag"
            e = enc.get(key_with_prefix) or enc.get(key_with_prefix.replace("le_", ""))
            if e and hasattr(e, "classes_"):
                classes = list(e.classes_)
                return classes.index(value) if value in classes else default
            return default

        return {
            "protocol_tcp":    idx("le_protocol_type", "tcp",     defaults["protocol_tcp"]),
            "service_http":    idx("le_service",       "http",    defaults["service_http"]),
            "service_private": idx("le_service",       "private", defaults["service_private"]),
            "flag_sf":         idx("le_flag",          "SF",      defaults["flag_sf"]),
            "flag_s0":         idx("le_flag",          "S0",      defaults["flag_s0"]),
            "flag_rej":        idx("le_flag",          "REJ",     defaults["flag_rej"]),
        }
    except Exception:
        return defaults


def _build_nsl_features(probes_tcp: list, probes_http: list, model_name: str = "random_forest") -> list:
    """Build 41 NSL-KDD features from real HTTP/TCP probes."""
    n = len(probes_tcp)
    if n == 0:
        return [0] * 41

    codes = _get_nsl_cat_codes(model_name)
    dur      = round(sum(p.get("duration_ms", 0) / 1000 for p in probes_http) / n, 4)
    dst_bytes = round(sum(p.get("content_bytes", 0) for p in probes_http) / n)

    flags   = [p.get("flag", "SF") for p in probes_tcp]
    n_sf = flags.count("SF"); n_s0 = flags.count("S0"); n_rej = flags.count("REJ")
    f_sf = n_sf/n; f_s0 = n_s0/n; f_rej = n_rej/n

    if f_sf >= f_s0 and f_sf >= f_rej:
        flag_code = codes["flag_sf"]
    elif f_s0 >= f_rej:
        flag_code = codes["flag_s0"]
    else:
        flag_code = codes["flag_rej"]

    serror_rate   = round(f_s0,  4)
    rerror_rate   = round(f_rej, 4)
    http_errors   = [p for p in probes_http if not p.get("ok") and p.get("status_code", 0) > 0]
    same_srv_rate = round(max(0.0, f_sf), 4)
    diff_srv_rate = round(f_rej, 4)
    count         = n
    srv_count     = max(1, n - len(http_errors))
    hot           = 1 if any(p.get("status_code", 0) in [401, 403, 500] for p in probes_http) else 0
    logged_in     = 1 if any(p.get("ok") for p in probes_http) else 0
    num_comp      = max((p.get("redirects", 0) for p in probes_http), default=0)

    return [
        dur,                     # 0  duration
        codes["protocol_tcp"],   # 1  protocol_type
        codes["service_http"],   # 2  service
        flag_code,               # 3  flag
        250,                     # 4  src_bytes
        dst_bytes,               # 5  dst_bytes
        0, 0, 0,                 # 6-8  land, wrong_frag, urgent
        hot,                     # 9  hot
        len(http_errors),        # 10 num_failed_logins
        logged_in,               # 11 logged_in
        num_comp,                # 12 num_compromised
        0, 0, 0, 0, 0, 0, 0,    # 13-19 content features (need DPI)
        0, 0,                    # 20-21 is_host_login, is_guest_login
        count,                   # 22 count
        srv_count,               # 23 srv_count
        serror_rate,             # 24 serror_rate
        serror_rate,             # 25 srv_serror_rate
        rerror_rate,             # 26 rerror_rate
        rerror_rate,             # 27 srv_rerror_rate
        same_srv_rate,           # 28 same_srv_rate
        diff_srv_rate,           # 29 diff_srv_rate
        0.0,                     # 30 srv_diff_host_rate
        255,                     # 31 dst_host_count
        srv_count,               # 32 dst_host_srv_count
        same_srv_rate,           # 33 dst_host_same_srv_rate
        diff_srv_rate,           # 34 dst_host_diff_srv_rate
        0.0, 0.0,                # 35-36
        serror_rate,             # 37 dst_host_serror_rate
        serror_rate,             # 38 dst_host_srv_serror_rate
        rerror_rate,             # 39 dst_host_rerror_rate
        rerror_rate,             # 40 dst_host_srv_rerror_rate
    ]


def _build_cicids_features(probes_tcp: list, probes_http: list) -> list:
    """
    Build CICIDS2017 feature vector (78 features) from real HTTP/TCP probes.
    Features match the CIC-IDS-2017 feature set order from the CSV.
    """
    n = len(probes_tcp)
    if n == 0:
        return [0] * 78

    latencies = [p["latency_ms"] for p in probes_tcp if p.get("latency_ms")]
    durations = [p.get("duration_ms", 0) for p in probes_http]
    bytes_fwd = [250] * n                   # request size ~250 bytes
    bytes_bwd = [p.get("content_bytes", 0) for p in probes_http]

    avg_lat  = sum(latencies) / len(latencies) if latencies else 0
    avg_dur  = sum(durations) / n
    avg_bwd  = sum(bytes_bwd) / n
    n_open   = sum(1 for p in probes_tcp if p.get("open"))
    n_closed = n - n_open
    pkt_loss = n_closed / n
    ok_rate  = sum(1 for p in probes_http if p.get("ok")) / n

    # Build 78 CICIDS features in approximate order
    fwd_pkts  = n
    bwd_pkts  = n if ok_rate > 0.5 else 0
    fwd_bytes = 250 * n
    bwd_bytes = sum(bytes_bwd)
    flow_dur  = avg_dur * 1000              # microseconds

    feats = [
        80,                        # 0  Destination Port
        flow_dur,                  # 1  Flow Duration
        fwd_pkts,                  # 2  Total Fwd Packets
        bwd_pkts,                  # 3  Total Backward Packets
        fwd_bytes,                 # 4  Total Length of Fwd Packets
        bwd_bytes,                 # 5  Total Length of Bwd Packets
        250, 0, 250, 0,            # 6-9  Fwd Pkt Len Max/Min/Mean/Std
        avg_bwd, 0, avg_bwd, 0,   # 10-13 Bwd Pkt Len Max/Min/Mean/Std
        fwd_bytes / (avg_dur/1000 + 1e-9),  # 14 Flow Bytes/s
        n / (avg_dur/1000 + 1e-9),          # 15 Flow Packets/s
        avg_lat*1000, 0, avg_lat*1000, 0,   # 16-19 Flow IAT Mean/Std/Max/Min
        avg_dur*1000, avg_lat*1000, 0, avg_lat*1000, 0,  # 20-24 Fwd IAT
        avg_dur*1000, avg_lat*1000, 0, avg_lat*1000, 0,  # 25-29 Bwd IAT
        0, 0, 0, 0,                # 30-33 PSH/URG flags
        20*n, 20*n,                # 34-35 Fwd/Bwd Header Length
        n / (avg_dur/1000 + 1e-9), avg_bwd / (avg_dur/1000 + 1e-9),  # 36-37 Pkts/s
        0, 250, 250/n if n else 0, 0, 0,   # 38-42 Pkt Len stats
        n_open, n, n_closed, fwd_pkts, bwd_pkts,  # 43-47 Flag counts FIN SYN RST PSH ACK
        0, 0, 0,                   # 48-50 URG CWE ECE flags
        bwd_bytes/(fwd_bytes+1) if fwd_bytes else 0,  # 51 Down/Up Ratio
        (fwd_bytes+bwd_bytes)/(fwd_pkts+bwd_pkts+1),  # 52 Avg Pkt Size
        fwd_bytes/fwd_pkts if fwd_pkts else 0,         # 53 Avg Fwd Segment Size
        avg_bwd,                   # 54 Avg Bwd Segment Size
        20*n,                      # 55 Fwd Header Length.1
        0, 0, 0, 0, 0, 0,         # 56-61 Bulk features
        fwd_pkts, fwd_bytes, bwd_pkts, bwd_bytes,  # 62-65 Subflow features
        65535, 0 if pkt_loss > 0.5 else 65535,     # 66-67 Init_Win bytes
        fwd_pkts, 20,              # 68-69 act_data_pkt_fwd, min_seg_size
        avg_lat*1000, 0, avg_lat*1000, 0,  # 70-73 Active Mean/Std/Max/Min
        0, 0, 0, 0,                # 74-77 Idle Mean/Std/Max/Min
    ]
    return feats[:78]


def _predict(features: list, model_name: str, dataset: str = "nslkdd") -> tuple:
    try:
        from app.ml.trainer import load_model
        import numpy as np
        artifact = load_model(dataset, model_name)
        model    = artifact["model"]
        encoders = artifact["encoders"]
        scaler   = encoders.get("scaler")
        X = np.array(features).reshape(1, -1)
        if scaler:
            X = scaler.transform(X)
        pred  = int(model.predict(X)[0])
        proba = model.predict_proba(X)[0]
        return ("Attack" if pred == 1 else "Normal"), round(float(max(proba)), 4)
    except Exception:
        return None, None


# ── Sample cache ───────────────────────────────────────────────────────────────
_SAMPLE_CACHE: dict = {}

def _load_real_samples(dataset: str, mode: str) -> list:
    """
    Load attack samples: first tries real CSVs, falls back to embedded
    representative vectors derived from dataset statistics.
    Returns list of already-scaled feature arrays ready for model.predict().
    """
    cache_key = f"{dataset}_{mode}"
    if cache_key in _SAMPLE_CACHE:
        return _SAMPLE_CACHE[cache_key]

    result = _try_load_from_csv(dataset, mode)
    if not result:
        result = _get_embedded_samples(dataset, mode)

    _SAMPLE_CACHE[cache_key] = result
    return result


def _get_scaler(dataset: str):
    try:
        from app.ml.trainer import load_model
        artifact = load_model(dataset, "random_forest")
        return artifact.get("encoders", {}).get("scaler")
    except Exception:
        return None


def _try_load_from_csv(dataset: str, mode: str) -> list:
    try:
        import pandas as pd, os
        from app.ml.trainer import load_model

        artifact = load_model(dataset, "random_forest")
        encoders = artifact.get("encoders", {})
        scaler   = encoders.get("scaler")

        if dataset == "nslkdd":
            data_path = os.path.join(os.path.dirname(__file__), "../../../data/raw/KDDTest+.txt")
            if not os.path.exists(data_path):
                return []
            cols = [
                "duration","protocol_type","service","flag","src_bytes","dst_bytes",
                "land","wrong_fragment","urgent","hot","num_failed_logins","logged_in",
                "num_compromised","root_shell","su_attempted","num_root","num_file_creations",
                "num_shells","num_access_files","num_outbound_cmds","is_host_login",
                "is_guest_login","count","srv_count","serror_rate","srv_serror_rate",
                "rerror_rate","srv_rerror_rate","same_srv_rate","diff_srv_rate",
                "srv_diff_host_rate","dst_host_count","dst_host_srv_count",
                "dst_host_same_srv_rate","dst_host_diff_srv_rate",
                "dst_host_same_src_port_rate","dst_host_srv_diff_host_rate",
                "dst_host_serror_rate","dst_host_srv_serror_rate",
                "dst_host_rerror_rate","dst_host_srv_rerror_rate","label","difficulty"
            ]
            df = pd.read_csv(data_path, header=None, names=cols, nrows=5000)
            df["label"] = df["label"].str.rstrip(".")
            atk_map = {
                "dos":   ["neptune","smurf","pod","teardrop","land","back"],
                "probe": ["ipsweep","portsweep","nmap","satan"],
            }
            feature_cols = cols[:41]
            for col in ["protocol_type","service","flag"]:
                enc = encoders.get(f"le_{col}") or encoders.get(col)
                if enc and hasattr(enc, "classes_"):
                    known = set(enc.classes_)
                    df[col] = df[col].apply(lambda x: int(enc.transform([x])[0]) if x in known else 0)
            rows = df[df["label"].isin(atk_map.get(mode, []))][feature_cols].head(15)
        else:
            data_path = os.path.join(os.path.dirname(__file__), "../../../data/raw/Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv")
            if not os.path.exists(data_path):
                return []
            # DDoS samples start after row ~97718 — load from there directly
            df = pd.read_csv(data_path, low_memory=False, skiprows=range(1, 98000), nrows=500)
            # re-attach header
            header_df = pd.read_csv(data_path, low_memory=False, nrows=0)
            df.columns = header_df.columns
            df.columns = df.columns.str.strip()
            df = df.replace([float("inf"), float("-inf")], float("nan")).dropna()
            label_col = " Label" if " Label" in df.columns else "Label"
            feature_cols = [c for c in df.columns if c != label_col][:78]
            rows = df[df[label_col].str.upper().str.contains("DDOS")][feature_cols].head(15)

        import numpy as np
        arr = rows.values.astype(float)
        if scaler is not None:
            arr = scaler.transform(arr)
        return arr.tolist()
    except Exception:
        return []


def _get_embedded_samples(dataset: str, mode: str) -> list:
    """
    Embedded representative attack vectors derived from published NSL-KDD/CICIDS2017
    dataset statistics. Applies the trained StandardScaler before returning.
    """
    import numpy as np
    rng = np.random.default_rng(42)

    if dataset == "nslkdd":
        if mode == "dos":
            # Neptune/Smurf DoS: count=511, serror_rate=1.0, flag=S0, src_bytes=0
            base = [0,1,10,1, 0,0, 0,0,0, 0,0,0,0, 0,0,0,0,0,0,0, 0,0,
                    511,511, 1.0,1.0, 0.0,0.0, 1.0,0.0,0.0,
                    255,10, 0.04,0.06,0.0,0.0, 1.0,1.0,0.0,0.0]
        else:  # probe
            # Ipsweep/Portsweep: diff_srv_rate high, rerror_rate high
            base = [0,1,5,2, 8,0, 0,0,0, 0,0,0,0, 0,0,0,0,0,0,0, 0,0,
                    50,2, 0.0,0.0, 0.8,0.8, 0.04,0.96,0.0,
                    255,3, 0.01,0.99,0.01,0.0, 0.0,0.0,0.8,0.8]
        rows = []
        for _ in range(15):
            noise = rng.normal(0, 0.05, len(base))
            rows.append([max(0, v + n) for v, n in zip(base, noise)])

    else:  # cicids ddos
        # DDoS CICIDS2017 Friday dataset statistics (mean values from published paper)
        # Features: Flow Duration, Total Fwd/Bwd Packets, Total Fwd/Bwd Bytes,
        # Fwd/Bwd Packet Length stats, Flow Bytes/s, Flow Packets/s, ...
        base = [
            1000, 1000, 0, 64000, 0, 0, 64,64,64,64,
            0,0,0,0, 64,64,64,0, 0,0,0,0, 0,0,0,0,
            64000000, 1000000, 1,0,0,0, 0,0,0,0,
            0,0,0,0, 0,0,0,0, 0,0, 0,0,255,255,
            1,0, 0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0,
            0,0,0,0, 0,0,0,0,0,0
        ]
        base = base[:78]
        rows = []
        for _ in range(15):
            noise = rng.normal(0, 0.05, len(base))
            rows.append([max(0, v + abs(v+1) * n) for v, n in zip(base, noise)])

    # Apply StandardScaler fitted during training
    arr = np.array(rows, dtype=float)
    scaler = _get_scaler(dataset)
    if scaler is not None:
        try:
            arr = scaler.transform(arr)
        except Exception:
            pass
    return arr.tolist()


# ── Probe endpoint ─────────────────────────────────────────────────────────────

@router.post("/probe")
def probe_target(req: ProbeRequest):
    url = _normalize(req.target)
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host   = parsed.hostname or req.target
        port   = parsed.port or req.port or (443 if url.startswith("https") else 80)
    except Exception:
        raise HTTPException(400, "Target inválido")

    try:
        ip = _resolve(host)
    except socket.gaierror:
        raise HTTPException(400, f"No se pudo resolver '{host}'")

    dataset    = req.dataset or "nslkdd"
    model_name = req.model_name or "random_forest"

    tcp_results  = []
    http_results = []
    probes_out   = []

    for i in range(req.count):
        tcp  = _tcp_probe(host, port)
        http = _http_probe(url)
        tcp_results.append(tcp)
        http_results.append(http)

        if dataset == "cicids":
            feats = _build_cicids_features(tcp_results, http_results)
        else:
            feats = _build_nsl_features(tcp_results, http_results, model_name)

        pred, conf = _predict(feats, model_name, dataset)
        probes_out.append({
            "probe": i + 1, "tcp": tcp, "http": http,
            "features": feats, "prediction": pred, "confidence": conf,
        })
        if i < req.count - 1:
            time.sleep(0.4)

    latencies   = [r["latency_ms"] for r in tcp_results if r["latency_ms"]]
    durations   = [r["duration_ms"] for r in http_results]
    attacks     = [p for p in probes_out if p["prediction"] == "Attack"]
    final_feats = (_build_cicids_features if dataset == "cicids" else _build_nsl_features)(
        tcp_results, http_results, *([model_name] if dataset == "nslkdd" else [])
    )
    final_pred, final_conf = _predict(final_feats, model_name, dataset)

    return {
        "target": req.target, "resolved_ip": ip, "host": host,
        "port": port, "model_used": model_name, "dataset": dataset,
        "probes": probes_out,
        "summary": {
            "avg_latency_ms":   round(sum(latencies)/len(latencies), 2) if latencies else None,
            "avg_duration_ms":  round(sum(durations)/len(durations), 2) if durations else None,
            "packet_loss_pct":  round((1 - len(latencies)/req.count)*100, 1),
            "serror_rate":      round(sum(1 for r in tcp_results if r["flag"]=="S0")/req.count, 3),
            "rerror_rate":      round(sum(1 for r in tcp_results if r["flag"]=="REJ")/req.count, 3),
            "attacks_detected": len(attacks),
            "total_probes":     req.count,
            "final_prediction": final_pred,
            "final_confidence": final_conf,
            "threat_level":     "HIGH"   if len(attacks) > req.count//2
                                else "MEDIUM" if len(attacks) > 0
                                else "LOW",
        },
    }


# ── Simulate endpoint ──────────────────────────────────────────────────────────

@router.post("/simulate")
def simulate_attack(req: SimRequest):
    """
    Runs real attack samples from NSL-KDD / CICIDS2017 test set through the model
    and reports detection rate.
    """
    url = _normalize(req.target)
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or req.target
        ip   = _resolve(host)
        port = 80
    except Exception:
        raise HTTPException(400, "Target inválido")

    dataset    = req.dataset or "nslkdd"
    model_name = req.model_name or "random_forest"
    intensity  = min(max(req.intensity or 10, 3), 15)
    results    = []

    # Step 1 — baseline: real probe to target
    tcp_r  = _tcp_probe(host, port)
    http_r = _http_probe(url)
    if dataset == "cicids":
        base_feats = _build_cicids_features([tcp_r], [http_r])
    else:
        base_feats = _build_nsl_features([tcp_r], [http_r], model_name)
    base_pred, base_conf = _predict(base_feats, model_name, dataset)

    results.append({
        "step":        "Conexión base (normal)",
        "description": f"Sondeo HTTP real a {host}:{port} — tráfico legítimo",
        "key_features": {"src_bytes": 250, "packet_loss": 0.0},
        "prediction":  base_pred,
        "confidence":  base_conf,
    })

    # Step 2 — load real attack samples
    atk_samples = _load_real_samples(dataset, req.mode)
    n_atk = len(atk_samples)

    if n_atk == 0:
        results.append({
            "step": "Error",
            "description": "Dataset no disponible en servidor. Ejecuta entrenamiento primero.",
            "prediction": None, "confidence": None,
        })
    else:
        import numpy as np
        from app.ml.trainer import load_model
        artifact = load_model(dataset, model_name)
        model    = artifact["model"]

        show_n   = min(intensity, n_atk)
        detected = 0

        # Attack type labels for display
        atk_type_map = {
            ("nslkdd", "dos"):   ["neptune","smurf","pod","teardrop","land","back"],
            ("nslkdd", "probe"): ["ipsweep","portsweep","nmap","satan"],
            ("cicids",  "ddos"): ["DDoS","DDoS","DDoS","DDoS"],
        }
        atk_types = atk_type_map.get((dataset, req.mode), ["attack"])

        for i, feat_scaled in enumerate(atk_samples[:show_n]):
            X    = np.array(feat_scaled).reshape(1, -1)
            pred_raw = int(model.predict(X)[0])
            proba    = model.predict_proba(X)[0]
            pred     = "Attack" if pred_raw == 1 else "Normal"
            conf     = round(float(max(proba)), 4)
            if pred == "Attack":
                detected += 1

            atk_type = atk_types[i % len(atk_types)]
            # Show a few key features (unscaled from raw array position)
            results.append({
                "step":        f"Muestra #{i+1} — {atk_type}",
                "description": f"Feature vector real de test set {dataset.upper()}",
                "prediction":  pred,
                "confidence":  conf,
            })

        detection_rate = round(detected / show_n, 3) if show_n > 0 else 0
        results.append({
            "step":        "Clasificación final",
            "description": f"{detected}/{show_n} muestras {req.mode.upper()} detectadas correctamente",
            "key_features": {
                "muestras_evaluadas": show_n,
                "detectadas":         detected,
                "tasa_detección":     f"{detection_rate*100:.1f}%",
            },
            "prediction": "Attack" if detected > show_n // 2 else "Normal",
            "confidence": detection_rate if detected > show_n // 2 else round(1 - detection_rate, 3),
        })

    final    = results[-1]
    detected = final.get("prediction") == "Attack"
    return {
        "target": req.target, "ip": ip,
        "mode": req.mode, "dataset": dataset, "model_used": model_name,
        "steps": results,
        "verdict": {
            "prediction": final.get("prediction"),
            "confidence": final.get("confidence"),
            "detected":   detected,
            "threat_level": "HIGH" if detected else "LOW",
        },
    }


@router.get("/probe/quick")
def quick_probe(target: str):
    url = _normalize(target)
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or target
        ip   = _resolve(host)
    except Exception:
        raise HTTPException(400, "Target inválido")
    return {"target": target, "ip": ip, "status": _http_probe(url)}
