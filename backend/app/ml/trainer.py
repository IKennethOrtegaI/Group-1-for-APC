import time
import joblib
import numpy as np
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import LinearSVC
from sklearn.calibration import CalibratedClassifierCV
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score, confusion_matrix
)
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
    # LinearSVC es 10-20x más rápido que SVC(kernel=rbf) con precisión similar
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
        "type": "Multi-Layer Perceptron / Deep Learning",
        "params": "Capas: 128→64→32, ReLU, Adam, early_stopping",
        "strengths": ["Aprende patrones no lineales", "Flexible", "Escalable"],
        "weaknesses": ["Requiere normalización estricta", "Caja negra"],
    },
}

# ── Cache de datos preprocesados en memoria (evita releer CSV + SMOTE por cada modelo) ──
_DATA_CACHE: dict = {}


def _get_preprocessed(dataset: str):
    """Carga, preprocesa y aplica SMOTE una sola vez; reutiliza en entrenamientos posteriores."""
    if dataset in _DATA_CACHE:
        return _DATA_CACHE[dataset]

    data_dir = settings.DATA_DIR
    if dataset == "nslkdd":
        df = load_nsl_kdd(data_dir)
        train_df = df[df["split"] == "train"]
        test_df  = df[df["split"] == "test"]
        X_train, y_train, _, encoders = preprocess(train_df, dataset, fit=True)
        X_test,  y_test,  _, _        = preprocess(test_df,  dataset, fit=False, encoders=encoders)
    else:
        df = load_cicids(data_dir)
        split_idx = int(len(df) * 0.8)
        X_train, y_train, _, encoders = preprocess(df.iloc[:split_idx], dataset, fit=True)
        X_test,  y_test,  _, _        = preprocess(df.iloc[split_idx:], dataset, fit=False, encoders=encoders)

    try:
        sm = SMOTE(random_state=42)
        X_train, y_train = sm.fit_resample(X_train, y_train)
    except Exception:
        pass

    _DATA_CACHE[dataset] = (X_train, y_train, X_test, y_test, encoders)
    return _DATA_CACHE[dataset]


def compute_metrics(y_true, y_pred):
    cm = confusion_matrix(y_true, y_pred).tolist()
    tn = cm[0][0] if len(cm) > 1 else 0
    fp = cm[0][1] if len(cm) > 1 else 0
    fn = cm[1][0] if len(cm) > 1 else 0
    tp = cm[1][1] if len(cm) > 1 else 0
    fpr = round(fp / (fp + tn), 4) if (fp + tn) > 0 else 0
    return {
        "accuracy":            round(accuracy_score(y_true, y_pred), 4),
        "f1_score":            round(f1_score(y_true, y_pred, average="weighted", zero_division=0), 4),
        "precision":           round(precision_score(y_true, y_pred, average="weighted", zero_division=0), 4),
        "recall":              round(recall_score(y_true, y_pred, average="weighted", zero_division=0), 4),
        "confusion_matrix":    cm,
        "false_positive_rate": fpr,
        "true_positives":      tp,
        "false_positives":     fp,
        "true_negatives":      tn,
        "false_negatives":     fn,
    }


def train_and_save(dataset: str, model_name: str, db_session=None):
    models_dir = settings.MODELS_DIR
    models_dir.mkdir(exist_ok=True)

    X_train, y_train, X_test, y_test, encoders = _get_preprocessed(dataset)

    # SVM: subsample para mayor velocidad (LinearSVC ya es mucho más rápido, 50K es seguro)
    X_tr, y_tr = X_train, y_train
    if model_name == "svm" and len(X_tr) > 50000:
        idx = np.random.choice(len(X_tr), 50000, replace=False)
        X_tr, y_tr = X_tr[idx], y_tr[idx]

    model_template = MODELS[model_name]
    # Clonar modelo para no contaminar el template
    import copy
    model = copy.deepcopy(model_template)

    start = time.time()
    model.fit(X_tr, y_tr)
    training_time = round(time.time() - start, 2)

    y_pred = model.predict(X_test)
    metrics = compute_metrics(y_test, y_pred)
    metrics.update({
        "training_time": training_time,
        "n_samples":     int(len(X_tr)),
        "dataset":       dataset,
        "model_name":    model_name,
        "model_info":    MODEL_INFO.get(model_name, {}),
    })

    joblib.dump({"model": model, "encoders": encoders}, models_dir / f"{dataset}_{model_name}.pkl")

    if db_session:
        from app.db.database import TrainingRun
        db_session.add(TrainingRun(
            dataset=dataset, model_name=model_name,
            accuracy=metrics["accuracy"], f1_score=metrics["f1_score"],
            precision=metrics["precision"], recall=metrics["recall"],
            training_time=training_time, n_samples=metrics["n_samples"],
        ))
        db_session.commit()

    return metrics


def load_model(dataset: str, model_name: str):
    path = settings.MODELS_DIR / f"{dataset}_{model_name}.pkl"
    if not path.exists():
        raise FileNotFoundError(f"Modelo no encontrado: {path}. Entrena primero.")
    return joblib.load(path)
