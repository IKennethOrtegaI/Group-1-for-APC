from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.db.database import init_db
from app.api.routes import models, alerts

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


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/")
def root():
    return {"name": settings.APP_NAME, "version": settings.VERSION, "status": "running"}


@app.get("/health")
def health():
    return {"status": "ok"}
