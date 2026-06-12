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


def migrate_db():
    """Add new columns to existing tables without dropping data (idempotent)."""
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
