import copy
import json
import time

import numpy as np
from collections import Counter
from pathlib import Path

import joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve as sk_roc_curve,
)
from sklearn.neural_network import MLPClassifier
from sklearn.svm import LinearSVC
from xgboost import XGBClassifier
from imblearn.over_sampling import SMOTE

from app.ml.preprocessor import load_nsl_kdd, load_cicids, preprocess
from app.core.config import settings

ALL_MODELS = ["random_forest", "xgboost", "svm", "mlp"]

MODELS = {
    "random_forest": RandomForestClassifier(
        n_estimators=60, max_depth=18, n_jobs=-1, random_state=42
    ),
    "xgboost": XGBClassifier(
        n_estimators=100, learning_rate=0.15, max_depth=6,
        use_label_encoder=False, eval_metric="logloss",
        n_jobs=-1, random_state=42, tree_method="hist",
    ),
    "svm": CalibratedClassifierCV(
        LinearSVC(C=1.0, max_iter=2000, random_state=42), cv=3
    ),
    "mlp": MLPClassifier(
        hidden_layer_sizes=(128, 64, 32),
        activation="relu", solver="adam",
        max_iter=150, random_state=42,
        early_stopping=True, validation_fraction=0.1,
        learning_rate_init=0.001, n_iter_no_change=10,
    ),
}

MODEL_INFO = {
    "random_forest": {
        "full_name": "Random Forest",
        "type": "Ensemble / Árboles de Decisión",
        "params": "60 estimadores, max_depth=18",
        "strengths": ["Alta precisión", "Robusto a outliers", "Importancia de features"],
        "weaknesses": ["Lento en predicción con muchos árboles", "Alto uso de memoria"],
    },
    "xgboost": {
        "full_name": "XGBoost",
        "type": "Gradient Boosting",
        "params": "100 estimadores, lr=0.15, depth=6, hist",
        "strengths": ["Máxima precisión", "Regularización integrada", "Rápido"],
        "weaknesses": ["Muchos hiperparámetros", "Difícil de interpretar"],
    },
    "svm": {
        "full_name": "Support Vector Machine",
        "type": "LinearSVC calibrado",
        "params": "C=1.0, max_iter=2000",
        "strengths": ["Muy rápido", "Resistente a overfitting", "Sólido en papers IDS"],
        "weaknesses": ["Menos preciso que kernel RBF en datos no lineales"],
    },
    "mlp": {
        "full_name": "Red Neuronal (MLP)",
        "type": "Multi-Layer Perceptron",
        "params": "Capas: 128→64→32, ReLU, Adam, early_stopping",
        "strengths": ["Aprende patrones no lineales", "Flexible", "Escalable"],
        "weaknesses": ["Requiere normalización estricta", "Caja negra"],
    },
}

# Cache de datos preprocesados (evita releer CSV + SMOTE por cada modelo)
_DATA_CACHE: dict = {}


def _get_preprocessed(dataset: str):
    if dataset in _DATA_CACHE:
        return _DATA_CACHE[dataset]

    data_dir = settings.DATA_DIR
    if dataset == "nslkdd":
        df = load_nsl_kdd(data_dir)
        train_df = df[df["split"] == "train"]
        test_df  = df[df["split"] == "test"]
        X_train_raw, y_train_raw, _, encoders = preprocess(train_df, dataset, fit=True)
        X_test, y_test, attack_types_test, _  = preprocess(test_df,  dataset, fit=False, encoders=encoders)
    else:
        df = load_cicids(data_dir)
        split_idx = int(len(df) * 0.8)
        X_train_raw, y_train_raw, _, encoders = preprocess(df.iloc[:split_idx], dataset, fit=True)
        X_test, y_test, attack_types_test, _  = preprocess(df.iloc[split_idx:], dataset, fit=False, encoders=encoders)

    before_dist = Counter(y_train_raw.tolist())

    try:
        sm = SMOTE(random_state=42)
        X_train, y_train = sm.fit_resample(X_train_raw, y_train_raw)
    except Exception:
        X_train, y_train = X_train_raw, y_train_raw

    after_dist  = Counter(y_train.tolist())
    test_dist   = Counter(y_test.tolist())
    feature_names = encoders.get("feature_cols", [f"f{i}" for i in range(X_train.shape[1])])

    dataset_stats = {
        "n_features": int(X_train.shape[1]),
        "feature_names": list(feature_names),
        "train_before_smote": {
            "normal": int(before_dist.get(0, 0)),
            "attack": int(before_dist.get(1, 0)),
        },
        "train_after_smote": {
            "normal": int(after_dist.get(0, 0)),
            "attack": int(after_dist.get(1, 0)),
        },
        "test": {
            "normal": int(test_dist.get(0, 0)),
            "attack": int(test_dist.get(1, 0)),
        },
    }

    _DATA_CACHE[dataset] = (X_train, y_train, X_test, y_test, encoders, attack_types_test, dataset_stats)
    return _DATA_CACHE[dataset]


def compute_metrics(
    y_true, y_pred,
    y_proba=None,
    attack_types=None,
    model=None,
    model_name=None,
    feature_names=None,
    loss_curve=None,
):
    cm = confusion_matrix(y_true, y_pred).tolist()
    tn = cm[0][0] if len(cm) > 1 else 0
    fp = cm[0][1] if len(cm) > 1 else 0
    fn = cm[1][0] if len(cm) > 1 else 0
    tp = cm[1][1] if len(cm) > 1 else 0
    fpr_val = round(fp / (fp + tn), 4) if (fp + tn) > 0 else 0.0

    result = {
        "accuracy":            round(float(accuracy_score(y_true, y_pred)), 4),
        "f1_score":            round(float(f1_score(y_true, y_pred, average="weighted", zero_division=0)), 4),
        "precision":           round(float(precision_score(y_true, y_pred, average="weighted", zero_division=0)), 4),
        "recall":              round(float(recall_score(y_true, y_pred, average="weighted", zero_division=0)), 4),
        "confusion_matrix":    cm,
        "false_positive_rate": fpr_val,
        "true_positives":      int(tp),
        "false_positives":     int(fp),
        "true_negatives":      int(tn),
        "false_negatives":     int(fn),
    }

    # ── ROC Curve & AUC ──────────────────────────────────────────────────────
    if y_proba is not None:
        try:
            auc = roc_auc_score(y_true, y_proba[:, 1])
            fpr_arr, tpr_arr, _ = sk_roc_curve(y_true, y_proba[:, 1])
            # Interpolate to 100 standard FPR points so all models share the same x-axis
            standard_fpr = np.linspace(0, 1, 100)
            tpr_interp = np.interp(standard_fpr, fpr_arr, tpr_arr)
            result["roc_auc"]   = round(float(auc), 4)
            result["roc_curve"] = {
                "fpr": [round(float(v), 4) for v in standard_fpr],
                "tpr": [round(float(v), 4) for v in tpr_interp],
            }
        except Exception:
            pass

    # ── Per-class metrics by attack type ─────────────────────────────────────
    if attack_types is not None:
        per_class = {}
        for atype in sorted(np.unique(attack_types)):
            mask   = attack_types == atype
            yt, yp = y_true[mask], y_pred[mask]
            n_samples  = int(mask.sum())
            n_attacks  = int((yt == 1).sum())
            n_detected = int(((yt == 1) & (yp == 1)).sum())
            per_class[str(atype)] = {
                "n_samples":      n_samples,
                "n_attacks":      n_attacks,
                "n_detected":     n_detected,
                "detection_rate": round(n_detected / n_attacks, 4) if n_attacks > 0 else None,
                "accuracy":       round(float(accuracy_score(yt, yp)), 4),
                "f1":             round(float(f1_score(yt, yp, average="weighted", zero_division=0)), 4),
                "precision":      round(float(precision_score(yt, yp, average="weighted", zero_division=0)), 4),
                "recall":         round(float(recall_score(yt, yp, average="weighted", zero_division=0)), 4),
            }
        result["per_class_metrics"] = per_class

    # ── Feature importance ───────────────────────────────────────────────────
    if model is not None and feature_names and len(feature_names) > 0:
        try:
            if model_name in ("random_forest", "xgboost"):
                importances = model.feature_importances_
                pairs = sorted(zip(feature_names, importances.tolist()), key=lambda x: x[1], reverse=True)[:20]
                result["feature_importance"] = [
                    {"feature": f, "importance": round(float(v), 6)} for f, v in pairs
                ]
            elif model_name == "svm":
                coef = model.calibrated_classifiers_[0].estimator.coef_[0]
                pairs = sorted(zip(feature_names, np.abs(coef).tolist()), key=lambda x: x[1], reverse=True)[:20]
                result["feature_importance"] = [
                    {"feature": f, "importance": round(float(v), 6)} for f, v in pairs
                ]
        except Exception:
            result["feature_importance"] = []

    # ── MLP loss curve ───────────────────────────────────────────────────────
    if loss_curve is not None:
        result["mlp_loss_curve"] = [round(float(v), 6) for v in loss_curve]

    return result


def train_and_save(dataset: str, model_name: str, db_session=None):
    models_dir = settings.MODELS_DIR
    models_dir.mkdir(exist_ok=True)

    X_train, y_train, X_test, y_test, encoders, attack_types_test, dataset_stats = _get_preprocessed(dataset)
    feature_names = dataset_stats.get("feature_names", [])

    X_tr, y_tr = X_train, y_train
    if model_name == "svm" and len(X_tr) > 50000:
        idx = np.random.choice(len(X_tr), 50000, replace=False)
        X_tr, y_tr = X_tr[idx], y_tr[idx]

    model = copy.deepcopy(MODELS[model_name])

    start = time.time()
    model.fit(X_tr, y_tr)
    training_time = round(time.time() - start, 2)

    y_pred = model.predict(X_test)

    try:
        y_proba = model.predict_proba(X_test)
    except Exception:
        y_proba = None

    loss_curve = None
    if model_name == "mlp" and hasattr(model, "loss_curve_"):
        loss_curve = model.loss_curve_

    metrics = compute_metrics(
        y_test, y_pred,
        y_proba=y_proba,
        attack_types=attack_types_test,
        model=model,
        model_name=model_name,
        feature_names=feature_names,
        loss_curve=loss_curve,
    )
    metrics.update({
        "training_time": training_time,
        "n_samples":     int(len(X_tr)),
        "dataset":       dataset,
        "model_name":    model_name,
        "model_info":    MODEL_INFO.get(model_name, {}),
        "dataset_stats": dataset_stats,
    })

    joblib.dump({"model": model, "encoders": encoders}, models_dir / f"{dataset}_{model_name}.pkl")

    if db_session:
        from app.db.database import TrainingRun
        db_session.add(TrainingRun(
            dataset=dataset,
            model_name=model_name,
            accuracy=metrics["accuracy"],
            f1_score=metrics["f1_score"],
            precision=metrics["precision"],
            recall=metrics["recall"],
            training_time=training_time,
            n_samples=metrics["n_samples"],
            false_positive_rate=metrics["false_positive_rate"],
            roc_auc=metrics.get("roc_auc"),
            confusion_matrix_json=json.dumps(metrics["confusion_matrix"]),
            per_class_json=json.dumps(metrics.get("per_class_metrics", {})),
            feature_importance_json=json.dumps(metrics.get("feature_importance", [])),
            roc_curve_json=json.dumps(metrics.get("roc_curve", {})),
            dataset_stats_json=json.dumps(dataset_stats),
            mlp_loss_json=json.dumps(metrics.get("mlp_loss_curve", [])),
        ))
        db_session.commit()

    return metrics


def load_model(dataset: str, model_name: str):
    path = settings.MODELS_DIR / f"{dataset}_{model_name}.pkl"
    if not path.exists():
        raise FileNotFoundError(f"Modelo no encontrado: {path}. Entrena primero.")
    return joblib.load(path)
