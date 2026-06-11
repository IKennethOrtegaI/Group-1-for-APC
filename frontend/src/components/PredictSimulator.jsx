import { useState } from "react";
import { predict } from "../api/client";
import { Zap, ShieldAlert, ShieldCheck } from "lucide-react";

const NSL_NORMAL = [0,1,0,10,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,1,0,0,255,254,1,0.01,0,0,0,0,0,0];
const NSL_ATTACK = [0,0,0,10,105,146,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,255,1,1,0,0,0,0.01,0.06,0.06,255,1,0,0.6,1,0,1,0,0,0];

const MODELS = [
  { value: "random_forest", label: "Random Forest",   color: "#58a6ff" },
  { value: "xgboost",       label: "XGBoost",          color: "#3fb950" },
  { value: "svm",           label: "SVM",              color: "#a371f7" },
  { value: "mlp",           label: "MLP",              color: "#d29922" },
];

export default function PredictSimulator({ dataset = "nslkdd", onPredicted }) {
  const [model,        setModel]        = useState("random_forest");
  const [featuresText, setFeaturesText] = useState(NSL_NORMAL.join(", "));
  const [result,       setResult]       = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);

  const handlePredict = async () => {
    setLoading(true); setError(null);
    try {
      const features = featuresText.split(",").map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
      const res = await predict(dataset, model, features);
      setResult(res.data);
      onPredicted?.();
    } catch (e) {
      setError(e.response?.data?.detail || "Error. Asegúrate de que el modelo esté entrenado.");
    } finally { setLoading(false); }
  };

  const isAttack = result?.prediction === "Attack";
  const sel = MODELS.find(m => m.value === model);

  return (
    <div className="flex flex-col gap-4">
      {/* Model selector */}
      <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
        <p className="text-[9px] uppercase tracking-widest mb-2" style={{ color: "#545d68" }}>Modelo</p>
        <div className="grid grid-cols-4 gap-2">
          {MODELS.map(m => (
            <button key={m.value} onClick={() => setModel(m.value)}
              className="py-2 rounded-lg text-[10px] font-semibold transition"
              style={{
                background: model === m.value ? `${m.color}14` : "transparent",
                border: `1px solid ${model === m.value ? m.color + "55" : "#1c2333"}`,
                color: model === m.value ? m.color : "#545d68",
              }}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sample buttons */}
      <div className="flex gap-2">
        <button onClick={() => { setFeaturesText(NSL_NORMAL.join(", ")); setResult(null); }}
          className="flex-1 py-2 rounded-lg text-[11px] font-semibold transition"
          style={{ background: "rgba(63,185,80,0.07)", border: "1px solid rgba(63,185,80,0.2)", color: "#3fb950" }}>
          ✓ Muestra Normal
        </button>
        <button onClick={() => { setFeaturesText(NSL_ATTACK.join(", ")); setResult(null); }}
          className="flex-1 py-2 rounded-lg text-[11px] font-semibold transition"
          style={{ background: "rgba(248,81,73,0.07)", border: "1px solid rgba(248,81,73,0.2)", color: "#f85149" }}>
          ✗ Muestra de Ataque
        </button>
      </div>

      {/* Features textarea */}
      <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
        <p className="text-[9px] uppercase tracking-widest mb-2" style={{ color: "#545d68" }}>
          Features de red (separadas por coma)
        </p>
        <textarea value={featuresText} onChange={e => setFeaturesText(e.target.value)} rows={3}
          className="w-full px-3 py-2 rounded-lg text-[11px] font-mono resize-none outline-none"
          style={{ background: "#0a1019", border: "1px solid #1c2333", color: "#8b949e", lineHeight: 1.7 }}/>
      </div>

      {/* Predict button */}
      <button onClick={handlePredict} disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[13px] transition"
        style={{
          background: loading ? `${sel?.color}10` : `${sel?.color}18`,
          border: `1px solid ${loading ? "#1c2333" : sel?.color + "44"}`,
          color: loading ? "#545d68" : sel?.color,
          cursor: loading ? "not-allowed" : "pointer",
        }}>
        <Zap size={14} fill="currentColor"/>
        {loading ? "Analizando…" : `Ejecutar con ${sel?.label}`}
      </button>

      {error && (
        <div className="rounded-xl p-3 text-[11px]"
          style={{ background: "rgba(248,81,73,0.06)", border: "1px solid rgba(248,81,73,0.2)", color: "#f85149" }}>
          {error}
        </div>
      )}

      {result && !error && (
        <div className="rounded-xl p-5"
          style={{ background: isAttack ? "rgba(248,81,73,0.05)" : "rgba(63,185,80,0.05)",
                   border: `1px solid ${isAttack ? "rgba(248,81,73,0.25)" : "rgba(63,185,80,0.25)"}` }}>
          <div className="flex items-center gap-3 mb-4">
            {isAttack
              ? <ShieldAlert size={22} style={{ color: "#f85149" }}/>
              : <ShieldCheck  size={22} style={{ color: "#3fb950" }}/>}
            <div>
              <p className="text-[9px] uppercase tracking-widest" style={{ color: "#545d68" }}>Resultado — {sel?.label}</p>
              <p className="text-[20px] font-bold leading-tight" style={{ color: isAttack ? "#f85149" : "#3fb950" }}>
                {isAttack ? "ATAQUE DETECTADO" : "TRÁFICO LEGÍTIMO"}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[9px]" style={{ color: "#545d68" }}>Confianza</p>
              <p className="text-[22px] font-bold font-mono" style={{ color: isAttack ? "#f85149" : "#3fb950" }}>
                {(result.confidence * 100).toFixed(1)}%
              </p>
            </div>
          </div>
          <div className="h-2 rounded-full overflow-hidden mb-4" style={{ background: "#1c2333" }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${result.confidence * 100}%`, background: isAttack ? "#f85149" : "#3fb950" }}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[["Prob. Normal", result.probabilities.normal, "#3fb950"],
              ["Prob. Ataque", result.probabilities.attack, "#f85149"]].map(([l, v, c]) => (
              <div key={l} className="rounded-lg p-3 text-center" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
                <p className="text-[9px] uppercase tracking-wider" style={{ color: "#545d68" }}>{l}</p>
                <p className="text-[18px] font-bold font-mono" style={{ color: c }}>{(v * 100).toFixed(1)}%</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
