import time
import socket
import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/monitor", tags=["Monitor"])


class ProbeRequest(BaseModel):
    target: str          # IP o URL
    port: Optional[int] = 80
    count: Optional[int] = 5   # número de sondeos


def _normalize_target(target: str) -> str:
    t = target.strip()
    if not t.startswith("http://") and not t.startswith("https://"):
        t = "http://" + t
    return t


def _tcp_probe(host: str, port: int) -> dict:
    start = time.time()
    try:
        s = socket.create_connection((host, port), timeout=5)
        s.close()
        latency = round((time.time() - start) * 1000, 2)
        return {"open": True, "latency_ms": latency}
    except (socket.timeout, ConnectionRefusedError, OSError):
        return {"open": False, "latency_ms": None}


def _http_probe(url: str) -> dict:
    start = time.time()
    try:
        r = requests.get(url, timeout=6, allow_redirects=True,
                         headers={"User-Agent": "IDS-Monitor/1.0"})
        duration = round((time.time() - start) * 1000, 2)
        return {
            "status_code":   r.status_code,
            "duration_ms":   duration,
            "content_bytes": len(r.content),
            "redirects":     len(r.history),
            "ok":            r.ok,
        }
    except requests.exceptions.Timeout:
        return {"status_code": 0, "duration_ms": 6000, "content_bytes": 0, "redirects": 0, "ok": False}
    except Exception as e:
        return {"status_code": -1, "duration_ms": 9999, "content_bytes": 0, "redirects": 0, "ok": False}


def _build_nsl_features(probe: dict, tcp: dict) -> list:
    """Mapea métricas reales a 41 features estilo NSL-KDD para el modelo."""
    dur     = min(probe.get("duration_ms", 0) / 1000, 60)
    src_b   = 200                              # tamaño request estimado
    dst_b   = probe.get("content_bytes", 0)
    land    = 0
    wrg_frg = 0
    urg_pkts= 0
    hot     = 1 if probe.get("status_code", 0) in [401,403,404,500] else 0
    failed  = 0 if probe.get("ok", False) else 1
    logged  = 1 if probe.get("ok", False) else 0
    num_comp= probe.get("redirects", 0)
    root_sh = 0
    su_att  = 0
    num_root= 0
    num_file= 0
    num_sh  = 0
    num_acc = 0
    num_out = 0
    is_host = 0
    num_cmd = 0
    srv_cnt = 1
    srv_ser = 0
    same_srv= 1.0
    diff_srv= 0.0
    srv_diff= 0.0
    dst_host_cnt     = 255
    dst_host_srv_cnt = 1
    dst_same_srv     = 1.0
    dst_diff_srv     = 0.0
    dst_same_src     = 0.0
    dst_srv_diff_host= 0.0
    dst_srv_serr     = round(failed * 0.1, 3)
    dst_srv_rerr     = round(failed * 0.05, 3)
    dst_host_serr    = round(failed * 0.1, 3)
    dst_host_rerr    = round(failed * 0.05, 3)
    # protocol=1(tcp), service=0(http), flag=0(SF/normal)
    return [
        dur, 1, 0, src_b, dst_b, land, wrg_frg, urg_pkts, hot, failed,
        logged, num_comp, root_sh, su_att, num_root, num_file, num_sh,
        num_acc, num_out, is_host, num_cmd, srv_cnt, srv_ser, same_srv,
        diff_srv, srv_diff, dst_host_cnt, dst_host_srv_cnt, dst_same_srv,
        dst_diff_srv, dst_same_src, dst_srv_diff_host, dst_srv_serr,
        dst_srv_rerr, dst_host_serr, dst_host_rerr,
        # padding to 41
        0, 0, 0, 0, 0,
    ]


@router.post("/probe")
def probe_target(req: ProbeRequest):
    url = _normalize_target(req.target)

    # Extraer hostname
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host   = parsed.hostname or req.target
        port   = parsed.port or req.port or (443 if url.startswith("https") else 80)
    except Exception:
        raise HTTPException(400, "Target inválido")

    # Resolver IP
    try:
        ip = socket.gethostbyname(host)
    except socket.gaierror:
        raise HTTPException(400, f"No se pudo resolver '{host}'")

    results = []
    for i in range(req.count):
        tcp   = _tcp_probe(host, port)
        http  = _http_probe(url)
        feats = _build_nsl_features(http, tcp)

        # Intentar predicción con modelo entrenado
        prediction = None
        confidence = None
        try:
            from app.ml.trainer import load_model
            import numpy as np
            artifact = load_model("nslkdd", "random_forest")
            model    = artifact["model"]
            encoders = artifact["encoders"]
            X = np.array(feats[:41]).reshape(1, -1)
            scaler = encoders.get("scaler")
            if scaler:
                X = scaler.transform(X)
            pred  = int(model.predict(X)[0])
            proba = model.predict_proba(X)[0]
            prediction = "Attack" if pred == 1 else "Normal"
            confidence = round(float(max(proba)), 4)
        except Exception:
            pass

        results.append({
            "probe":      i + 1,
            "tcp":        tcp,
            "http":       http,
            "features":   feats,
            "prediction": prediction,
            "confidence": confidence,
        })
        if i < req.count - 1:
            time.sleep(0.5)

    # Resumen estadístico
    latencies  = [r["tcp"]["latency_ms"] for r in results if r["tcp"]["latency_ms"]]
    durations  = [r["http"]["duration_ms"] for r in results]
    attacks    = [r for r in results if r["prediction"] == "Attack"]
    avg_lat    = round(sum(latencies) / len(latencies), 2) if latencies else None
    avg_dur    = round(sum(durations) / len(durations), 2) if durations else None
    packet_loss= round((1 - len(latencies) / req.count) * 100, 1)

    return {
        "target":       req.target,
        "resolved_ip":  ip,
        "host":         host,
        "port":         port,
        "probes":       results,
        "summary": {
            "avg_latency_ms":  avg_lat,
            "avg_duration_ms": avg_dur,
            "packet_loss_pct": packet_loss,
            "attacks_detected":len(attacks),
            "total_probes":    req.count,
            "threat_level":    "HIGH" if len(attacks) > req.count // 2
                               else "MEDIUM" if len(attacks) > 0
                               else "LOW",
        },
    }


@router.get("/probe/quick")
def quick_probe(target: str):
    """Sondeo rápido de 1 request para verificar conectividad."""
    url = _normalize_target(target)
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or target
        ip   = socket.gethostbyname(host)
    except Exception:
        raise HTTPException(400, "Target inválido")

    http = _http_probe(url)
    return {"target": target, "ip": ip, "status": http}
