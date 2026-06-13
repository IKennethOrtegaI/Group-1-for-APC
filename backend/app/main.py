import os
import warnings
import threading
import requests as _requests
warnings.filterwarnings("ignore")  # suppress sklearn/joblib verbose warnings
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.db.database import init_db
from app.api.routes import models, alerts, monitor, capture, analytics

# URLs públicas de los datasets (NSL-KDD desde repositorio oficial en GitHub)
DATASETS = {
    "KDDTrain+.txt": "https://raw.githubusercontent.com/defcom17/NSL_KDD/master/KDDTrain+.txt",
    "KDDTest+.txt":  "https://raw.githubusercontent.com/defcom17/NSL_KDD/master/KDDTest+.txt",
}

def _download_datasets():
    data_dir = "/app/data/raw"
    os.makedirs(data_dir, exist_ok=True)
    for fname, url in DATASETS.items():
        dest = os.path.join(data_dir, fname)
        if os.path.exists(dest):
            continue
        print(f"[startup] Descargando {fname}…")
        try:
            r = _requests.get(url, timeout=120, stream=True)
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    f.write(chunk)
            size_mb = os.path.getsize(dest) / 1_048_576
            print(f"[startup] {fname} listo ({size_mb:.1f} MB)")
        except Exception as e:
            print(f"[startup] ERROR descargando {fname}: {e}")

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="AI-Based Intrusion Detection System for Enterprise Networks",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models.router)
app.include_router(alerts.router)
app.include_router(monitor.router)
app.include_router(capture.router)
app.include_router(analytics.router)


@app.on_event("startup")
def on_startup():
    init_db()
    # Descarga datasets en background para no bloquear el arranque
    threading.Thread(target=_download_datasets, daemon=True).start()


@app.get("/")
def root():
    return {"name": settings.APP_NAME, "version": settings.VERSION, "status": "running"}


@app.get("/health")
def health():
    return {"status": "ok"}
