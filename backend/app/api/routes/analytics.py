"""
Analytics endpoint — time-range aggregates from CaptureLog.
Supports: 5m, 1h, 12h, 1d, 7d, 30d
"""
from datetime import datetime, timedelta
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.database import get_db, CaptureLog

router = APIRouter(prefix="/analytics", tags=["Analytics"])

RANGES = {
    "5m":  timedelta(minutes=5),
    "1h":  timedelta(hours=1),
    "12h": timedelta(hours=12),
    "1d":  timedelta(days=1),
    "7d":  timedelta(days=7),
    "30d": timedelta(days=30),
}

BUCKET_SECONDS = {
    "5m":  15,       # 15-second buckets → 20 points
    "1h":  120,      # 2-min buckets     → 30 points
    "12h": 900,      # 15-min buckets    → 48 points
    "1d":  3600,     # 1-hour buckets    → 24 points
    "7d":  21600,    # 6-hour buckets    → 28 points
    "30d": 86400,    # 1-day buckets     → 30 points
}


@router.get("/{range_key}")
def get_analytics(range_key: str, db: Session = Depends(get_db)):
    if range_key not in RANGES:
        return {"error": f"Invalid range. Use: {list(RANGES.keys())}"}

    delta   = RANGES[range_key]
    bucket  = BUCKET_SECONDS[range_key]
    since_ts = (datetime.utcnow() - delta).timestamp()

    rows = (
        db.query(CaptureLog)
        .filter(CaptureLog.ts >= since_ts)
        .order_by(CaptureLog.ts.asc())
        .all()
    )

    if not rows:
        return _empty_response(range_key)

    total   = len(rows)
    attacks = sum(1 for r in rows if r.prediction == "Attack")
    normal  = total - attacks
    attack_rate = round(attacks / total, 4) if total else 0.0

    avg_conf_atk = _avg([r.confidence for r in rows if r.prediction == "Attack" and r.confidence])
    avg_conf_ok  = _avg([r.confidence for r in rows if r.prediction != "Attack" and r.confidence])

    total_bytes = sum((r.src_bytes or 0) + (r.dst_bytes or 0) for r in rows)

    # ── Attack type breakdown ─────────────────────────────────────────────────
    atk_types = Counter(r.attack_type for r in rows if r.prediction == "Attack" and r.attack_type)

    # ── Protocol breakdown ────────────────────────────────────────────────────
    proto_count = Counter(r.protocol for r in rows if r.protocol)

    # ── Service breakdown ─────────────────────────────────────────────────────
    svc_attacks = Counter(r.service for r in rows if r.prediction == "Attack" and r.service)

    # ── Top source IPs (attackers) ────────────────────────────────────────────
    top_src = Counter(r.src_ip for r in rows if r.prediction == "Attack" and r.src_ip).most_common(8)

    # ── Top destination IPs ───────────────────────────────────────────────────
    top_dst = Counter(r.dst_ip for r in rows if r.prediction == "Attack" and r.dst_ip).most_common(8)

    # ── Timeline buckets ──────────────────────────────────────────────────────
    timeline = _build_timeline(rows, since_ts, bucket)

    # ── Dataset / model breakdown ─────────────────────────────────────────────
    datasets = Counter(r.dataset for r in rows if r.dataset)

    return {
        "range":       range_key,
        "since":       datetime.utcfromtimestamp(since_ts).isoformat(),
        "total":       total,
        "attacks":     attacks,
        "normal":      normal,
        "attack_rate": attack_rate,
        "avg_conf_attack": avg_conf_atk,
        "avg_conf_normal": avg_conf_ok,
        "total_bytes": total_bytes,
        "attack_types": [{"type": k, "count": v} for k, v in atk_types.most_common()],
        "protocols":    [{"proto": k, "count": v} for k, v in proto_count.most_common()],
        "top_services": [{"service": k, "count": v} for k, v in svc_attacks.most_common(8)],
        "top_src_ips":  [{"ip": k, "count": v} for k, v in top_src],
        "top_dst_ips":  [{"ip": k, "count": v} for k, v in top_dst],
        "timeline":     timeline,
        "datasets":     dict(datasets),
    }


def _build_timeline(rows, since_ts: float, bucket_s: int):
    """Group rows into time buckets, return list of {ts, total, attacks, normal}."""
    buckets: dict[int, dict] = defaultdict(lambda: {"total": 0, "attacks": 0, "normal": 0})
    for r in rows:
        b = int((r.ts - since_ts) // bucket_s)
        buckets[b]["total"]   += 1
        if r.prediction == "Attack":
            buckets[b]["attacks"] += 1
        else:
            buckets[b]["normal"]  += 1

    if not buckets:
        return []

    max_b = max(buckets.keys())
    result = []
    for i in range(max_b + 1):
        d = buckets.get(i, {"total": 0, "attacks": 0, "normal": 0})
        result.append({
            "ts":      since_ts + i * bucket_s,
            "label":   _fmt_ts(since_ts + i * bucket_s),
            "total":   d["total"],
            "attacks": d["attacks"],
            "normal":  d["normal"],
        })
    return result


def _fmt_ts(ts: float) -> str:
    return datetime.utcfromtimestamp(ts).strftime("%H:%M")


def _avg(vals):
    return round(sum(vals) / len(vals), 4) if vals else None


def _empty_response(range_key: str):
    return {
        "range": range_key, "total": 0, "attacks": 0, "normal": 0,
        "attack_rate": 0, "avg_conf_attack": None, "avg_conf_normal": None,
        "total_bytes": 0, "attack_types": [], "protocols": [],
        "top_services": [], "top_src_ips": [], "top_dst_ips": [],
        "timeline": [], "datasets": {},
    }
