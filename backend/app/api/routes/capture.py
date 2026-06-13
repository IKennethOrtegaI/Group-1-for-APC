import asyncio
import json
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.ml import capture as cap
from app.ml.trainer import load_model
from app.core.config import settings

router = APIRouter(prefix="/capture", tags=["Capture"])


class StartRequest(BaseModel):
    iface:      str
    dataset:    str = "nslkdd"
    model_name: str = "random_forest"


@router.get("/available")
def check_available():
    """Check if Scapy is installed and packet capture is possible."""
    return {
        "scapy_available": cap.SCAPY_AVAILABLE,
        "message": (
            "Scapy disponible. Instala Npcap en Windows si no captura paquetes."
            if cap.SCAPY_AVAILABLE
            else "Scapy no instalado. Ejecuta: pip install scapy"
        ),
    }


@router.get("/interfaces")
def list_interfaces():
    if not cap.SCAPY_AVAILABLE:
        raise HTTPException(503, "Scapy no disponible. Instala scapy y Npcap.")
    ifaces = cap.get_interfaces()
    return {"interfaces": ifaces}  # list of {id, label, description}


@router.post("/start")
def start(req: StartRequest):
    if not cap.SCAPY_AVAILABLE:
        raise HTTPException(503, "Scapy no disponible. Instala scapy y Npcap.")

    try:
        artifact = load_model(req.dataset, req.model_name)
    except FileNotFoundError:
        raise HTTPException(404, f"Modelo {req.model_name}/{req.dataset} no entrenado. Entrena primero.")

    cap.start_capture(req.iface, artifact, dataset=req.dataset)
    return {"status": "started", "iface": req.iface,
            "model": req.model_name, "dataset": req.dataset}


@router.post("/stop")
def stop():
    cap.stop_capture()
    return {"status": "stopped"}


@router.get("/status")
def status():
    session = cap.get_session()
    if not session:
        return {"running": False, "stats": {"total": 0, "attacks": 0, "normal": 0}}
    return {
        "running": session.is_running(),
        "stats":   session.stats,
    }


@router.get("/results")
def results(limit: int = 50):
    """Latest captured + classified connections (polling endpoint)."""
    session = cap.get_session()
    if not session:
        return {"connections": [], "stats": {"total": 0, "attacks": 0, "normal": 0}}

    records = session.get_results()[-limit:]
    conns = []
    for r in reversed(records):
        conns.append({
            "ts":           r.ts,
            "src":          f"{r.src_ip}:{r.src_port}",
            "dst":          f"{r.dst_ip}:{r.dst_port}",
            "protocol":     r.protocol,
            "service":      r.service,
            "flag":         r.flag,
            "duration":     r.duration,
            "src_bytes":    r.src_bytes,
            "dst_bytes":    r.dst_bytes,
            "prediction":   r.prediction,
            "confidence":   r.confidence,
            "attack_type":  r.attack_type,
            "traffic_desc": r.traffic_desc,
        })
    return {"connections": conns, "stats": session.stats}


@router.get("/stream")
async def stream():
    """SSE stream — push new connections as they are classified."""
    async def event_gen():
        session = cap.get_session()
        last_count = 0

        while True:
            await asyncio.sleep(1)
            if not session or not session.is_running():
                yield "data: {\"type\":\"stopped\"}\n\n"
                break

            records = session.get_results()
            if len(records) > last_count:
                new = records[last_count:]
                last_count = len(records)
                for r in new:
                    payload = json.dumps({
                        "type":        "connection",
                        "ts":          r.ts,
                        "src":         f"{r.src_ip}:{r.src_port}",
                        "dst":         f"{r.dst_ip}:{r.dst_port}",
                        "protocol":    r.protocol,
                        "service":     r.service,
                        "flag":        r.flag,
                        "duration":    r.duration,
                        "src_bytes":   r.src_bytes,
                        "dst_bytes":   r.dst_bytes,
                        "prediction":  r.prediction,
                        "confidence":  r.confidence,
                        "attack_type": r.attack_type,
                        "traffic_desc": r.traffic_desc,
                    })
                    yield f"data: {payload}\n\n"
            else:
                # Heartbeat
                yield f"data: {{\"type\":\"heartbeat\",\"stats\":{json.dumps(session.stats)}}}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
