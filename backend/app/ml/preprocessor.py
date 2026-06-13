import warnings
import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.preprocessing import LabelEncoder, RobustScaler
from sklearn.model_selection import train_test_split
from sklearn.feature_selection import VarianceThreshold

NSL_KDD_COLUMNS = [
    "duration", "protocol_type", "service", "flag", "src_bytes", "dst_bytes",
    "land", "wrong_fragment", "urgent", "hot", "num_failed_logins", "logged_in",
    "num_compromised", "root_shell", "su_attempted", "num_root", "num_file_creations",
    "num_shells", "num_access_files", "num_outbound_cmds", "is_host_login",
    "is_guest_login", "count", "srv_count", "serror_rate", "srv_serror_rate",
    "rerror_rate", "srv_rerror_rate", "same_srv_rate", "diff_srv_rate",
    "srv_diff_host_rate", "dst_host_count", "dst_host_srv_count",
    "dst_host_same_srv_rate", "dst_host_diff_srv_rate", "dst_host_same_src_port_rate",
    "dst_host_srv_diff_host_rate", "dst_host_serror_rate", "dst_host_srv_serror_rate",
    "dst_host_rerror_rate", "dst_host_srv_rerror_rate", "label", "difficulty"
]

ATTACK_MAP = {
    "normal": "Normal",
    "neptune": "DoS", "back": "DoS", "land": "DoS", "pod": "DoS",
    "smurf": "DoS", "teardrop": "DoS", "mailbomb": "DoS", "apache2": "DoS",
    "processtable": "DoS", "udpstorm": "DoS",
    "ipsweep": "Probe", "nmap": "Probe", "portsweep": "Probe", "satan": "Probe",
    "mscan": "Probe", "saint": "Probe",
    "ftp_write": "R2L", "guess_passwd": "R2L", "imap": "R2L", "multihop": "R2L",
    "phf": "R2L", "spy": "R2L", "warezclient": "R2L", "warezmaster": "R2L",
    "sendmail": "R2L", "named": "R2L", "snmpgetattack": "R2L", "snmpguess": "R2L",
    "xlock": "R2L", "xsnoop": "R2L", "httptunnel": "R2L",
    "buffer_overflow": "U2R", "loadmodule": "U2R", "perl": "U2R", "rootkit": "U2R",
    "ps": "U2R", "sqlattack": "U2R", "xterm": "U2R",
}

# Correlación > 0.99 en CICIDS2017 — se elimina el segundo de cada par
CICIDS_HIGH_CORR_DROP = [
    "Fwd Packet Length Std",   # ↔ Fwd Packet Length Max
    "Bwd Packet Length Std",   # ↔ Bwd Packet Length Max
    "Fwd IAT Total",           # ↔ Flow Duration
    "Fwd IAT Max",             # ↔ Flow IAT Max
    "Fwd PSH Flags",           # ↔ SYN Flag Count (corr=1.0)
    "ECE Flag Count",          # ↔ RST Flag Count (corr=1.0)
    "Average Packet Size",     # ↔ Packet Length Mean
    "Avg Fwd Segment Size",    # ↔ Fwd Packet Length Mean
]


def load_nsl_kdd(data_dir: Path):
    train_path = data_dir / "KDDTrain+.txt"
    test_path  = data_dir / "KDDTest+.txt"

    if not train_path.exists():
        raise FileNotFoundError(f"NSL-KDD dataset not found at {train_path}")

    df_train = pd.read_csv(train_path, header=None, names=NSL_KDD_COLUMNS)
    df_test  = pd.read_csv(test_path,  header=None, names=NSL_KDD_COLUMNS)

    df_train["split"] = "train"
    df_test["split"]  = "test"
    df = pd.concat([df_train, df_test], ignore_index=True)

    df["label"]           = df["label"].str.rstrip(".")
    df["attack_category"] = df["label"].map(lambda x: ATTACK_MAP.get(x, "Other"))
    df["binary_label"]    = (df["label"] != "normal").astype(int)

    return df


def load_cicids(data_dir: Path):
    path = data_dir / "Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv"
    if not path.exists():
        candidates = list(data_dir.glob("Friday*.csv"))
        if not candidates:
            raise FileNotFoundError(f"CICIDS2017 Friday dataset not found in {data_dir}")
        path = candidates[0]

    df = pd.read_csv(path, low_memory=False)
    df.columns = df.columns.str.strip()

    label_col = " Label" if " Label" in df.columns else "Label"
    df = df.rename(columns={label_col: "label"})
    df["label"] = df["label"].str.strip()

    # ── Reemplazar inf por NaN antes de dropna (preserva más filas de ataque)
    # Los inf aparecen en Flow Packets/s y Flow Bytes/s — se reemplazan con el
    # máximo finito de la columna para no perder esas filas de ataque.
    numeric_cols = df.select_dtypes(include=np.number).columns
    for col in numeric_cols:
        mask = np.isinf(df[col])
        if mask.any():
            finite_max = df.loc[~mask, col].max()
            df.loc[mask, col] = finite_max

    df = df.dropna()

    # ── Eliminar features con varianza = 0 (constantes en todo el dataset)
    zero_var_cols = [
        "Bwd PSH Flags", "Fwd URG Flags", "Bwd URG Flags", "CWE Flag Count",
        "Fwd Avg Bytes/Bulk", "Fwd Avg Packets/Bulk", "Fwd Avg Bulk Rate",
        "Bwd Avg Bytes/Bulk", "Bwd Avg Packets/Bulk", "Bwd Avg Bulk Rate",
    ]
    df = df.drop(columns=[c for c in zero_var_cols if c in df.columns])

    # ── Eliminar features altamente correlacionadas (> 0.99)
    df = df.drop(columns=[c for c in CICIDS_HIGH_CORR_DROP if c in df.columns])

    df["binary_label"]    = (df["label"] != "BENIGN").astype(int)
    df["attack_category"] = df["label"].apply(
        lambda x: "Normal" if x == "BENIGN" else x.strip()
    )

    # ── Shuffle para romper el orden BENIGN-primero / DDoS-después
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)

    return df


def preprocess(df: pd.DataFrame, dataset: str, fit: bool = True, encoders: dict = None):
    if dataset == "nslkdd":
        cat_cols  = ["protocol_type", "service", "flag"]
        drop_cols = ["label", "difficulty", "split", "attack_category", "binary_label"]
    else:
        drop_cols = ["label", "attack_category", "binary_label"]
        cat_cols  = []

    # ── Eliminar feature constante de NSL-KDD
    if dataset == "nslkdd" and "num_outbound_cmds" in df.columns:
        drop_cols = drop_cols + ["num_outbound_cmds"]

    feature_cols  = [c for c in df.columns if c not in drop_cols]
    X             = df[feature_cols].copy()
    y             = df["binary_label"].values
    attack_types  = df["attack_category"].values

    if encoders is None:
        encoders = {}

    # ── Encode categoricals
    for col in cat_cols:
        if col not in X.columns:
            continue
        if fit:
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col].astype(str))
            encoders[f"le_{col}"] = le
        else:
            le = encoders.get(f"le_{col}")
            if le:
                def safe_encode(v, le=le):
                    v = str(v)
                    if v in le.classes_:
                        return int(le.transform([v])[0])
                    warnings.warn(f"LabelEncoder: valor desconocido '{v}' — asignando clase más frecuente (0)")
                    return 0
                X[col] = X[col].astype(str).map(safe_encode)

    # ── Solo columnas numéricas
    X = X.select_dtypes(include=[np.number])

    # ── Guardar feature_cols antes de escalar (para consistencia en inferencia)
    if fit:
        encoders["feature_cols"] = list(X.columns)
    else:
        # Alinear columnas con las del entrenamiento
        expected_cols = encoders.get("feature_cols", list(X.columns))
        for col in expected_cols:
            if col not in X.columns:
                X[col] = 0.0
        X = X[expected_cols]

    # ── RobustScaler (resistente a outliers extremos de CICIDS)
    if fit:
        scaler = RobustScaler()
        X_scaled = scaler.fit_transform(X)
        encoders["scaler"] = scaler
    else:
        scaler   = encoders.get("scaler")
        X_scaled = scaler.transform(X) if scaler else X.values

    return X_scaled, y, attack_types, encoders


def get_train_test_split(dataset: str, df: pd.DataFrame):
    """
    Retorna índices estratificados train/test (80/20).
    Para NSL-KDD usa el split oficial del dataset.
    Para CICIDS usa train_test_split con stratify.
    """
    if dataset == "nslkdd":
        train_idx = df.index[df["split"] == "train"]
        test_idx  = df.index[df["split"] == "test"]
        return df.loc[train_idx], df.loc[test_idx]
    else:
        y = df["binary_label"].values
        train_df, test_df = train_test_split(
            df, test_size=0.2, stratify=y, random_state=42
        )
        return train_df, test_df
