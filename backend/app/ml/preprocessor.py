import pandas as pd
import numpy as np
from sklearn.preprocessing import LabelEncoder, StandardScaler
from pathlib import Path

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


def load_nsl_kdd(data_dir: Path):
    train_path = data_dir / "KDDTrain+.txt"
    test_path = data_dir / "KDDTest+.txt"

    if not train_path.exists():
        raise FileNotFoundError(f"NSL-KDD dataset not found at {train_path}")

    df_train = pd.read_csv(train_path, header=None, names=NSL_KDD_COLUMNS)
    df_test = pd.read_csv(test_path, header=None, names=NSL_KDD_COLUMNS)

    df_train["split"] = "train"
    df_test["split"] = "test"
    df = pd.concat([df_train, df_test], ignore_index=True)

    df["label"] = df["label"].str.rstrip(".")
    df["attack_category"] = df["label"].map(lambda x: ATTACK_MAP.get(x, "Other"))
    df["binary_label"] = (df["label"] != "normal").astype(int)

    return df


def load_cicids(data_dir: Path):
    path = data_dir / "Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv"
    if not path.exists():
        # Try alternative filename
        candidates = list(data_dir.glob("Friday*.csv"))
        if not candidates:
            raise FileNotFoundError(f"CICIDS2017 Friday dataset not found in {data_dir}")
        path = candidates[0]

    df = pd.read_csv(path, low_memory=False)
    df.columns = df.columns.str.strip()

    label_col = " Label" if " Label" in df.columns else "Label"
    df = df.rename(columns={label_col: "label"})
    df["label"] = df["label"].str.strip()

    df["binary_label"] = (df["label"] != "BENIGN").astype(int)
    df["attack_category"] = df["label"].apply(
        lambda x: "Normal" if x == "BENIGN" else ("DDoS" if "DDoS" in x else "Attack")
    )

    # Drop infinite and NaN values
    df = df.replace([np.inf, -np.inf], np.nan).dropna()

    return df


def preprocess(df: pd.DataFrame, dataset: str, fit: bool = True, encoders: dict = None):
    if dataset == "nslkdd":
        cat_cols = ["protocol_type", "service", "flag"]
        drop_cols = ["label", "difficulty", "split", "attack_category", "binary_label"]
    else:
        drop_cols = ["label", "attack_category", "binary_label"]
        cat_cols = []

    feature_cols = [c for c in df.columns if c not in drop_cols]
    X = df[feature_cols].copy()
    y = df["binary_label"].values
    attack_types = df["attack_category"].values

    if encoders is None:
        encoders = {}

    # Encode categoricals
    for col in cat_cols:
        if col in X.columns:
            if fit:
                le = LabelEncoder()
                X[col] = le.fit_transform(X[col].astype(str))
                encoders[f"le_{col}"] = le
            else:
                le = encoders.get(f"le_{col}")
                if le:
                    X[col] = X[col].astype(str).map(
                        lambda v: le.transform([v])[0] if v in le.classes_ else -1
                    )

    X = X.select_dtypes(include=[np.number])

    if fit:
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        encoders["scaler"] = scaler
        encoders["feature_cols"] = list(X.columns)
    else:
        scaler = encoders.get("scaler")
        X_scaled = scaler.transform(X) if scaler else X.values

    return X_scaled, y, attack_types, encoders
