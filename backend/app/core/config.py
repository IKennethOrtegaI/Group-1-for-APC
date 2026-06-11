from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    APP_NAME: str = "AI-Based IDS"
    VERSION: str = "1.0.0"
    DATABASE_URL: str = f"sqlite:///{BASE_DIR}/ids.db"
    MODELS_DIR: Path = BASE_DIR / "models"
    DATA_DIR: Path = BASE_DIR / "data" / "raw"

    class Config:
        env_file = ".env"


settings = Settings()
