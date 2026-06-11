import { useState, useEffect } from "react";
import { trainModel, getTrainStatus } from "../api/client";
import { Play, Loader2, CheckCircle2, AlertCircle, Cpu } from "lucide-react";

const MODELS = [
  { value: "random_forest", label: "Random Forest",  sub: "100 árboles · max_depth=20",          color: "#58a6ff" },
  { value: "xgboost",       label: "XGBoost",         sub: "200 estimadores · lr=0.1 · depth=6",  color: "#3fb950" },
  { value: "svm",           label: "SVM",             sub: "Kernel RBF · C=10 · gamma=scale",     color: "#a371f7" },
  { value: "mlp",           label: "Red Neuronal MLP",sub: "128→64→32 · Adam · Early Stopping",   color: "#d29922" },
];

export default function TrainPanel({ dataset = "nslkdd", onTrained }) {
  const [model,   setModel]   = useState("random_forest");
  const [status,  setStatus]  = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [polling, setPolling] = useState(false);

  // Al montar o cambiar modelo/dataset: consultar estado actual en el backend
  useEffect(() => {
    let cancelled = false;
    const checkCurrent = async () => {
      try {
        const res = await getTrainStatus(dataset, model);
        if (cancelled) return;
        const s = res.data.status;
        if (s?.status === "done") {
          setStatus("done"); setMetrics(s.metrics); setPolling(false);
        } else if (s?.status === "error") {
          setStatus("error"); setPolling(false);
        } else if (s?.status === "training" || s?.status === "queued") {
          // entrenamiento en curso aunque hayamos cambiado de pestaña — reanudar polling
          setStatus("training"); setPolling(true);
        } else {
          setStatus(null); setMetrics(null); setPolling(false);
        }
      } catch {
        setStatus(null); setPolling(false);
      }
    };
    checkCurrent();
    return () => { cancelled = true; };
  }, [dataset, model]);

  const handleTrain = async () => {
    setStatus("queued");
    setMetrics(null);
    try {
      await trainModel(dataset, model);
      setPolling(true);
    } catch { setStatus("error"); }
  };

  useEffect(() => {
    if (!polling) return;
    const iv = setInterval(async () => {
      try {
        const res = await getTrainStatus(dataset, model);
        const s = res.data.status;
        if (s?.status === "done") {
          setStatus("done"); setMetrics(s.metrics); setPolling(false); onTrained?.();
        } else if (s?.status === "error") {
          setStatus("error"); setPolling(false);
        } else {
          setStatus("training");
        }
      } catch { setPolling(false); }
    }, 2000);
    return () => clearInterval(iv);
  }, [polling, dataset, model]);

  const selected = MODELS.find(m => m.value === model);

  return (
    <div className="flex flex-col gap-4">
      {/* Model picker */}
      <div className="rounded-xl p-5" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
        <p className="text-[10px] uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ color: "#545d68" }}>
          <Cpu size={11}/> Seleccionar Algoritmo
        </p>
        <div className="grid grid-cols-2 gap-2">
          {MODELS.map(m => (
            <button key={m.value} onClick={() => setModel(m.value)}
              className="text-left px-4 py-3 rounded-xl transition-all"
              style={{
                background: model === m.value ? `rgba(${m.color === "#58a6ff" ? "88,166,255" : m.color === "#3fb950" ? "63,185,80" : m.color === "#a371f7" ? "163,113,247" : "210,153,34"},0.08)` : "#0a1019",
                border: `1px solid ${model === m.value ? m.color + "55" : "#1c2333"}`,
              }}>
              <p className="text-[12px] font-bold" style={{ color: model === m.value ? m.color : "#8b949e" }}>{m.label}</p>
              <p className="text-[9px] mt-0.5" style={{ color: "#545d68" }}>{m.sub}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Train button */}
      <button onClick={handleTrain} disabled={polling}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[13px] transition-all"
        style={{
          background: polling ? "rgba(88,166,255,0.05)" : "rgba(88,166,255,0.1)",
          border: `1px solid ${polling ? "#1c2333" : "rgba(88,166,255,0.4)"}`,
          color: polling ? "#545d68" : "#58a6ff",
          cursor: polling ? "not-allowed" : "pointer",
        }}>
        {polling
          ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }}/> Entrenando {selected?.label}…</>
          : <><Play size={14} fill="currentColor"/> Entrenar {selected?.label} en {dataset === "nslkdd" ? "NSL-KDD" : "CICIDS2017"}</>
        }
      </button>

      {/* Result */}
      {status === "done" && metrics && (
        <div className="rounded-xl p-5" style={{ background: "rgba(63,185,80,0.05)", border: "1px solid rgba(63,185,80,0.2)" }}>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 size={14} style={{ color: "#3fb950" }}/>
            <span className="text-[12px] font-semibold" style={{ color: "#3fb950" }}>
              Entrenamiento completado — {selected?.label}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[["Accuracy", metrics.accuracy], ["F1-Score", metrics.f1_score], ["Precision", metrics.precision], ["Recall", metrics.recall]].map(([k, v]) => (
              <div key={k} className="rounded-lg p-3 text-center" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
                <p className="text-[8px] uppercase tracking-wider" style={{ color: "#545d68" }}>{k}</p>
                <p className="text-[16px] font-bold font-mono mt-1" style={{ color: "#3fb950" }}>
                  {(v * 100).toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
          <p className="text-[10px] mt-3" style={{ color: "#545d68" }}>
            {metrics.n_samples?.toLocaleString()} muestras · {metrics.training_time}s de entrenamiento
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-xl p-4 flex items-center gap-2"
          style={{ background: "rgba(248,81,73,0.05)", border: "1px solid rgba(248,81,73,0.2)" }}>
          <AlertCircle size={14} style={{ color: "#f85149" }}/>
          <span className="text-[12px]" style={{ color: "#f85149" }}>
            Error. Verifica que los datasets estén en /data/raw/
          </span>
        </div>
      )}

      {/* Tip for slow models */}
      {(model === "svm" || model === "mlp") && !polling && status !== "done" && (
        <div className="rounded-xl p-3" style={{ background: "rgba(210,153,34,0.05)", border: "1px solid rgba(210,153,34,0.15)" }}>
          <p className="text-[10px]" style={{ color: "#d29922" }}>
            ⚠ {model === "svm" ? "SVM puede tardar 3-10 min en NSL-KDD (optimización cuadrática). Se limitará a 30K muestras automáticamente." : "MLP puede tardar 2-5 min. Usa early stopping si la pérdida converge."}
          </p>
        </div>
      )}
    </div>
  );
}
