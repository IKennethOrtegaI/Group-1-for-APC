from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.db.database import get_db, TrainingRun
from app.ml.trainer import train_and_save, load_model, compute_metrics, MODEL_INFO, ALL_MODELS
from app.ml.preprocessor import preprocess
import numpy as np

router = APIRouter(prefix="/models", tags=["Models"])

VALID_DATASETS = {"nslkdd", "cicids"}
VALID_MODELS = {"random_forest", "xgboost", "svm", "mlp"}

training_status: dict = {}


class TrainRequest(BaseModel):
    dataset: str
    model_name: str


class PredictRequest(BaseModel):
    dataset: str
    model_name: str
    features: list[float]


def _do_train(dataset: str, model_name: str, db: Session):
    key = f"{dataset}_{model_name}"
    training_status[key] = "training"
    try:
        metrics = train_and_save(dataset, model_name, db_session=db)
        training_status[key] = {"status": "done", "metrics": metrics}
    except Exception as e:
        training_status[key] = {"status": "error", "detail": str(e)}


@router.post("/train")
def train(req: TrainRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if req.dataset not in VALID_DATASETS:
        raise HTTPException(400, f"Invalid dataset. Choose from {VALID_DATASETS}")
    if req.model_name not in VALID_MODELS:
        raise HTTPException(400, f"Invalid model. Choose from {VALID_MODELS}")

    key = f"{req.dataset}_{req.model_name}"
    training_status[key] = "queued"
    background_tasks.add_task(_do_train, req.dataset, req.model_name, db)
    return {"message": f"Training started for {req.model_name} on {req.dataset}", "key": key}


@router.get("/train/status/{dataset}/{model_name}")
def train_status(dataset: str, model_name: str):
    key = f"{dataset}_{model_name}"
    status = training_status.get(key, "not_started")
    return {"key": key, "status": status}


@router.post("/predict")
def predict(req: PredictRequest, db: Session = Depends(get_db)):
    if req.dataset not in VALID_DATASETS:
        raise HTTPException(400, "Invalid dataset")
    if req.model_name not in VALID_MODELS:
        raise HTTPException(400, "Invalid model")

    try:
        artifact = load_model(req.dataset, req.model_name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    model = artifact["model"]
    encoders = artifact["encoders"]
    expected = len(encoders.get("feature_cols", req.features))

    features = np.array(req.features[:expected]).reshape(1, -1)
    scaler = encoders.get("scaler")
    if scaler:
        features = scaler.transform(features)

    pred = int(model.predict(features)[0])
    proba = model.predict_proba(features)[0]
    confidence = round(float(max(proba)), 4)

    result = "Attack" if pred == 1 else "Normal"

    # Persist to DB
    from app.db.database import Prediction
    import json
    record = Prediction(
        dataset=req.dataset,
        model_name=req.model_name,
        prediction=result,
        confidence=confidence,
        input_features=json.dumps(req.features[:10]),
    )
    db.add(record)
    db.commit()

    return {
        "prediction": result,
        "confidence": confidence,
        "probabilities": {"normal": round(float(proba[0]), 4), "attack": round(float(proba[1]), 4)},
    }


@router.get("/metrics/{dataset}/{model_name}")
def get_metrics(dataset: str, model_name: str, db: Session = Depends(get_db)):
    runs = (
        db.query(TrainingRun)
        .filter(TrainingRun.dataset == dataset, TrainingRun.model_name == model_name)
        .order_by(TrainingRun.created_at.desc())
        .first()
    )
    if not runs:
        raise HTTPException(404, "No training run found. Please train first.")
    return {
        "dataset": runs.dataset,
        "model_name": runs.model_name,
        "accuracy": runs.accuracy,
        "f1_score": runs.f1_score,
        "precision": runs.precision,
        "recall": runs.recall,
        "training_time": runs.training_time,
        "n_samples": runs.n_samples,
        "trained_at": runs.created_at,
    }


@router.get("/compare/{dataset}")
def compare_models(dataset: str, db: Session = Depends(get_db)):
    results = []
    for model_name in ALL_MODELS:
        run = (
            db.query(TrainingRun)
            .filter(TrainingRun.dataset == dataset, TrainingRun.model_name == model_name)
            .order_by(TrainingRun.created_at.desc())
            .first()
        )
        if run:
            results.append({
                "model_name": run.model_name,
                "accuracy": run.accuracy,
                "f1_score": run.f1_score,
                "precision": run.precision,
                "recall": run.recall,
                "training_time": run.training_time,
                "n_samples": run.n_samples,
                "model_info": MODEL_INFO.get(run.model_name, {}),
            })
    return {"dataset": dataset, "comparison": results}
