import time
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.svm import SVC
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
        n_estimators=100, max_depth=20, n_jobs=-1, random_state=42
    ),
    "xgboost": XGBClassifier(
        n_estimators=200, learning_rate=0.1, max_depth=6,
        use_label_encoder=False, eval_metric="logloss",
        n_jobs=-1, random_state=42
    ),
    "svm": SVC(
        kernel="rbf", C=10, gamma="scale",
        probability=True, random_state=42, cache_size=500
    ),
    "mlp": MLPClassifier(
        hidden_layer_sizes=(128, 64, 32),
        activation="relu", solver="adam",
        max_iter=200, random_state=42,
        early_stopping=True, validation_fraction=0.1,
        learning_rate_init=0.001,
    ),
}

MODEL_INFO = {
    "random_forest": {
        "full_name": "Random Forest",
        "type": "Ensemble / Árboles de Decisión",
        "params": "100 estimadores, max_depth=20",
        "strengths": ["Alta precisión", "Robusto a outliers", "Importancia de features"],
        "weaknesses": ["Lento en predicción con muchos árboles", "Alto uso de memoria"],
    },
    "xgboost": {
        "full_name": "XGBoost",
        "type": "Gradient Boosting",
        "params": "200 estimadores, lr=0.1, depth=6",
        "strengths": ["Máxima precisión", "Regularización integrada", "Rápido"],
        "weaknesses": ["Muchos hiperparámetros", "Difícil de interpretar"],
    },
    "svm": {
        "full_name": "Support Vector Machine",
        "type": "Kernel RBF / Máquinas de Soporte Vectorial",
        "params": "C=10, gamma=scale, kernel=rbf",
        "strengths": ["Excelente en alta dimensión", "Resistente a overfitting", "Sólido en papers IDS"],
        "weaknesses": ["Muy lento en datasets grandes", "No escala bien"],
    },
    "mlp": {
        "full_name": "Red Neuronal (MLP)",
        "type": "Multi-Layer Perceptron / Deep Learning",
        "params": "Capas: 128→64→32, ReLU, Adam",
        "strengths": ["Aprende patrones no lineales", "Flexible", "Escalable"],
        "weaknesses": ["Requiere normalización estricta", "Caja negra", "Más lento de entrenar"],
    },
}


def compute_metrics(y_true, y_pred):
    cm = confusion_matrix(y_true, y_pred).tolist()
    tn = cm[0][0] if len(cm) > 1 else 0
    fp = cm[0][1] if len(cm) > 1 else 0
    fn = cm[1][0] if len(cm) > 1 else 0
    tp = cm[1][1] if len(cm) > 1 else 0
    fpr = round(fp / (fp + tn), 4) if (fp + tn) > 0 else 0
    return {
        "accuracy":         round(accuracy_score(y_true, y_pred), 4),
        "f1_score":         round(f1_score(y_true, y_pred, average="weighted", zero_division=0), 4),
        "precision":        round(precision_score(y_true, y_pred, average="weighted", zero_division=0), 4),
        "recall":           round(recall_score(y_true, y_pred, average="weighted", zero_division=0), 4),
        "confusion_matrix": cm,
        "false_positive_rate": fpr,
        "true_positives":   tp,
        "false_positives":  fp,
        "true_negatives":   tn,
        "false_negatives":  fn,
    }


def _load_data(dataset):
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
    return X_train, y_train, X_test, y_test, encoders


def train_and_save(dataset: str, model_name: str, db_session=None):
    models_dir = settings.MODELS_DIR
    models_dir.mkdir(exist_ok=True)

    X_train, y_train, X_test, y_test, encoders = _load_data(dataset)

    try:
        sm = SMOTE(random_state=42)
        X_train, y_train = sm.fit_resample(X_train, y_train)
    except Exception:
        pass

    # For SVM, subsample if too large (speed)
    if model_name == "svm" and len(X_train) > 30000:
        idx = np.random.choice(len(X_train), 30000, replace=False)
        X_train, y_train = X_train[idx], y_train[idx]

    model_template = MODELS[model_name]
    model = model_template.__class__(**model_template.get_params())

    start = time.time()
    model.fit(X_train, y_train)
    training_time = round(time.time() - start, 2)

    y_pred = model.predict(X_test)
    metrics = compute_metrics(y_test, y_pred)
    metrics.update({
        "training_time": training_time,
        "n_samples":     int(len(X_train)),
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
