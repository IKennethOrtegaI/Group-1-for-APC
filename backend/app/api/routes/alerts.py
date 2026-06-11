from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db, Prediction
import pandas as pd
import numpy as np
import io

router = APIRouter(prefix="/alerts", tags=["Alerts"])


@router.get("/")
def get_alerts(limit: int = 50, db: Session = Depends(get_db)):
    records = (
        db.query(Prediction)
        .order_by(Prediction.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "dataset": r.dataset,
            "model_name": r.model_name,
            "prediction": r.prediction,
            "confidence": r.confidence,
            "attack_type": r.attack_type,
            "created_at": r.created_at,
        }
        for r in records
    ]


@router.get("/stats")
def alert_stats(db: Session = Depends(get_db)):
    total = db.query(Prediction).count()
    attacks = db.query(Prediction).filter(Prediction.prediction == "Attack").count()
    normal = total - attacks
    return {
        "total": total,
        "attacks": attacks,
        "normal": normal,
        "attack_rate": round(attacks / total, 4) if total > 0 else 0,
    }


@router.post("/upload-csv")
async def batch_predict(
    file: UploadFile = File(...),
    dataset: str = "nslkdd",
    model_name: str = "random_forest",
    db: Session = Depends(get_db),
):
    from app.ml.trainer import load_model

    if not file.filename.endswith(".csv"):
        raise HTTPException(400, "Only CSV files are accepted")

    try:
        artifact = load_model(dataset, model_name)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    contents = await file.read()
    df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
    df = df.replace([np.inf, -np.inf], np.nan).dropna()

    model = artifact["model"]
    encoders = artifact["encoders"]
    feature_cols = encoders.get("feature_cols", list(df.columns))
    scaler = encoders.get("scaler")

    available = [c for c in feature_cols if c in df.columns]
    if not available:
        raise HTTPException(400, "CSV columns do not match expected features")

    X = df[available].select_dtypes(include=[np.number]).values
    if scaler:
        X = scaler.transform(X)

    preds = model.predict(X)
    probas = model.predict_proba(X)[:, 1]

    attack_count = int(np.sum(preds))
    normal_count = int(len(preds) - attack_count)

    # Persist bulk predictions
    for i, (pred, conf) in enumerate(zip(preds, probas)):
        record = Prediction(
            dataset=dataset,
            model_name=model_name,
            prediction="Attack" if pred == 1 else "Normal",
            confidence=round(float(conf), 4),
        )
        db.add(record)
    db.commit()

    return {
        "total_records": len(preds),
        "attacks_detected": attack_count,
        "normal_traffic": normal_count,
        "attack_rate": round(attack_count / len(preds), 4),
        "sample_predictions": [
            {"index": i, "prediction": "Attack" if p == 1 else "Normal", "confidence": round(float(c), 4)}
            for i, (p, c) in enumerate(zip(preds[:20], probas[:20]))
        ],
    }
