from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
from app.core.config import settings

engine = create_engine(settings.DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    dataset = Column(String, nullable=False)
    model_name = Column(String, nullable=False)
    prediction = Column(String, nullable=False)
    confidence = Column(Float, nullable=False)
    attack_type = Column(String, nullable=True)
    input_features = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class TrainingRun(Base):
    __tablename__ = "training_runs"

    id = Column(Integer, primary_key=True, index=True)
    dataset = Column(String, nullable=False)
    model_name = Column(String, nullable=False)
    accuracy = Column(Float)
    f1_score = Column(Float)
    precision = Column(Float)
    recall = Column(Float)
    training_time = Column(Float)
    n_samples = Column(Integer)
    # Extended metrics
    false_positive_rate = Column(Float, nullable=True)
    roc_auc = Column(Float, nullable=True)
    confusion_matrix_json = Column(Text, nullable=True)
    per_class_json = Column(Text, nullable=True)
    feature_importance_json = Column(Text, nullable=True)
    roc_curve_json = Column(Text, nullable=True)
    dataset_stats_json = Column(Text, nullable=True)
    mlp_loss_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CaptureLog(Base):
    """Persists every classified flow from real-time capture for time-range analytics."""
    __tablename__ = "capture_logs"

    id          = Column(Integer, primary_key=True, index=True)
    ts          = Column(Float, nullable=False, index=True)   # Unix timestamp
    src_ip      = Column(String, nullable=True)
    dst_ip      = Column(String, nullable=True)
    src_port    = Column(Integer, nullable=True)
    dst_port    = Column(Integer, nullable=True)
    protocol    = Column(String, nullable=True)
    service     = Column(String, nullable=True)
    flag        = Column(String, nullable=True)
    duration    = Column(Float, nullable=True)
    src_bytes   = Column(Integer, nullable=True)
    dst_bytes   = Column(Integer, nullable=True)
    prediction  = Column(String, nullable=True)
    confidence  = Column(Float, nullable=True)
    attack_type = Column(String, nullable=True)
    traffic_desc= Column(String, nullable=True)
    dataset     = Column(String, nullable=True)
    model_name  = Column(String, nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow, index=True)


def migrate_db():
    """Add new columns to existing tables without dropping data (idempotent)."""
    # Create capture_logs if not exists (new table)
    with engine.connect() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS capture_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                src_ip TEXT, dst_ip TEXT,
                src_port INTEGER, dst_port INTEGER,
                protocol TEXT, service TEXT, flag TEXT,
                duration REAL, src_bytes INTEGER, dst_bytes INTEGER,
                prediction TEXT, confidence REAL,
                attack_type TEXT, traffic_desc TEXT,
                dataset TEXT, model_name TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_capture_logs_ts ON capture_logs(ts)"))
        conn.commit()

    new_cols = [
        ("false_positive_rate", "REAL"),
        ("roc_auc", "REAL"),
        ("confusion_matrix_json", "TEXT"),
        ("per_class_json", "TEXT"),
        ("feature_importance_json", "TEXT"),
        ("roc_curve_json", "TEXT"),
        ("dataset_stats_json", "TEXT"),
        ("mlp_loss_json", "TEXT"),
    ]
    with engine.connect() as conn:
        for col_name, col_type in new_cols:
            try:
                conn.execute(
                    text(f"ALTER TABLE training_runs ADD COLUMN {col_name} {col_type}")
                )
                conn.commit()
            except Exception:
                pass  # Column already exists


def init_db():
    Base.metadata.create_all(bind=engine)
    migrate_db()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
