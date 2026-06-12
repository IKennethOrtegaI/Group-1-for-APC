import { useEffect, useState } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { compareModels, trainModel, getTrainStatus, exportResults } from "../api/client";
import {
  Shield, Zap, Award, AlertTriangle, Clock, RefreshCw,
  Play, Download, TrendingUp, Database, Activity,
} from "lucide-react";

const MODEL_COLORS = {
  random_forest: "#58a6ff",
  xgboost:       "#3fb950",
  svm:           "#a371f7",
  mlp:           "#d29922",
};
const MODEL_SHORT = {
  random_forest: "Random Forest",
  xgboost:       "XGBoost",
  svm:           "SVM",
  mlp:           "MLP",
};

function pct(v) { return v != null ? `${(v * 100).toFixed(2)}%` : "—"; }
function pctRaw(v) { return v != null ? `${(v * 100).toFixed(2)}%` : "—"; }

// ── Verdict engine ────────────────────────────────────────────────────────────
function buildVerdict(data) {
  if (!data.length) return null;
  const scored = data.map(m => ({
    ...m,
    score: (m.f1_score || 0) * 0.4 + (m.accuracy || 0) * 0.3 +
           (m.precision || 0) * 0.2 + (m.recall || 0) * 0.1,
  }));
  scored.sort((a, b) => b.score - a.score);
  const reasons = {
    random_forest: "Excelente balance entre precisión y velocidad. Robusto ante datos desbalanceados. Estándar de la industria para IDS.",
    xgboost:       "Mayor accuracy gracias al gradient boosting. Regularización integrada reduce falsos positivos. Ideal para datasets grandes.",
    svm:           "Máximo margen de separación en espacio de alta dimensión. Muy resistente al overfitting. Referencia académica en IDS.",
    mlp:           "Captura relaciones no lineales complejas entre features. Mejor a medida que crece el volumen de datos.",
  };
  return { winner: scored[0], scored, reasons };
}

// ── Real Confusion Matrix ─────────────────────────────────────────────────────
function RealCM({ data, color }) {
  const tn = data.true_negatives  ?? (data.confusion_matrix?.[0]?.[0] ?? 0);
  const fp = data.false_positives ?? (data.confusion_matrix?.[0]?.[1] ?? 0);
  const fn = data.false_negatives ?? (data.confusion_matrix?.[1]?.[0] ?? 0);
  const tp = data.true_positives  ?? (data.confusion_matrix?.[1]?.[1] ?? 0);
  const total = tn + fp + fn + tp;

  const cells = [
    { label: "TN", value: tn, pct: total ? ((tn / total) * 100).toFixed(1) : "—", bg: "rgba(63,185,80,0.1)",  border: "#3fb95044", color: "#3fb950", desc: "Normal → Normal" },
    { label: "FP", value: fp, pct: total ? ((fp / total) * 100).toFixed(1) : "—", bg: "rgba(210,153,34,0.1)", border: "#d2992244", color: "#d29922", desc: "Normal → Ataque" },
    { label: "FN", value: fn, pct: total ? ((fn / total) * 100).toFixed(1) : "—", bg: "rgba(248,81,73,0.1)",  border: "#f8514944", color: "#f85149", desc: "Ataque → Normal" },
    { label: "TP", value: tp, pct: total ? ((tp / total) * 100).toFixed(1) : "—", bg: "rgba(88,166,255,0.1)", border: "#58a6ff44", color: "#58a6ff", desc: "Ataque → Ataque" },
  ];

  return (
    <div>
      <div className="flex justify-between mb-2">
        <p className="text-[9px] uppercase tracking-widest" style={{ color: "#545d68" }}>Predicted →</p>
        <p className="text-[9px] uppercase tracking-widest" style={{ color: "#545d68" }}>Normal | Ataque</p>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {cells.map(c => (
          <div key={c.label} className="rounded-xl p-3 text-center"
            style={{ background: c.bg, border: `1px solid ${c.border}` }}>
            <p className="text-[8px] mb-0.5" style={{ color: "#545d68" }}>{c.desc}</p>
            <p className="text-[15px] font-bold font-mono" style={{ color: c.color }}>{c.label}</p>
            <p className="text-[13px] font-mono font-semibold" style={{ color: c.color }}>
              {c.value.toLocaleString()}
            </p>
            <p className="text-[9px] mt-0.5" style={{ color: "#545d68" }}>{c.pct}%</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2 text-[9px]" style={{ color: "#545d68" }}>
        <span>Total: <strong style={{ color: "#cdd9e5" }}>{total.toLocaleString()}</strong></span>
        <span>·</span>
        <span>FPR: <strong style={{ color: "#d29922" }}>{total ? ((fp / (fp + tn)) * 100).toFixed(2) : "—"}%</strong></span>
      </div>
    </div>
  );
}

// ── Train All Button ──────────────────────────────────────────────────────────
function TrainAllButton({ dataset, onDone }) {
  const [status, setStatus] = useState({});
  const models = ["random_forest", "xgboost", "svm", "mlp"];

  useEffect(() => {
    let cancelled = false;
    const recover = async () => {
      const updates = {};
      await Promise.all(models.map(async (m) => {
        try {
          const r = await getTrainStatus(dataset, m);
          const st = r.data?.status;
          const s = typeof st === "object" ? st?.status : st;
          if (s === "done")                           updates[m] = "done";
          else if (s === "error")                     updates[m] = "error";
          else if (s === "training" || s === "queued") updates[m] = "training";
        } catch {}
      }));
      if (!cancelled && Object.keys(updates).length > 0) setStatus(updates);
    };
    recover();
    return () => { cancelled = true; };
  }, [dataset]);

  const trainAll = async () => {
    for (const m of models) {
      setStatus(s => ({ ...s, [m]: "training" }));
      try {
        await trainModel(dataset, m);
        await new Promise((resolve) => {
          const iv = setInterval(async () => {
            try {
              const r = await getTrainStatus(dataset, m);
              const st = r.data?.status;
              const s = typeof st === "object" ? st?.status : st;
              if (s === "done")  { clearInterval(iv); setStatus(s2 => ({ ...s2, [m]: "done"  })); resolve(); }
              if (s === "error") { clearInterval(iv); setStatus(s2 => ({ ...s2, [m]: "error" })); resolve(); }
            } catch { clearInterval(iv); resolve(); }
          }, 3000);
        });
      } catch {
        setStatus(s => ({ ...s, [m]: "error" }));
      }
    }
    onDone();
  };

  const anyTraining = models.some(m => status[m] === "training");

  return (
    <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
      <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "#545d68" }}>
        Entrenar todos los modelos en <span style={{ color: "#58a6ff" }}>{dataset === "nslkdd" ? "NSL-KDD" : "CICIDS2017"}</span>
      </p>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {models.map(m => {
          const st = status[m] || "idle";
          return (
            <div key={m} className="rounded-lg p-2 text-center"
              style={{ background: "#0a1019", border: `1px solid ${st === "done" ? "#3fb95033" : st === "training" ? "#58a6ff33" : st === "error" ? "#f8514933" : "#1c2333"}` }}>
              <p className="text-[9px] font-bold" style={{ color: MODEL_COLORS[m] }}>{MODEL_SHORT[m]}</p>
              <p className="text-[8px] mt-0.5" style={{ color: st === "done" ? "#3fb950" : st === "training" ? "#58a6ff" : st === "error" ? "#f85149" : "#545d68" }}>
                {st === "idle" ? "Pendiente" : st === "training" ? "Entrenando…" : st === "done" ? "✓ Listo" : "✗ Error"}
              </p>
            </div>
          );
        })}
      </div>
      <button onClick={trainAll} disabled={anyTraining}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-[11px] font-semibold transition"
        style={{ background: anyTraining ? "rgba(88,166,255,0.05)" : "rgba(88,166,255,0.1)",
                 border: `1px solid ${anyTraining ? "#1c2333" : "#58a6ff44"}`,
                 color: anyTraining ? "#545d68" : "#58a6ff",
                 cursor: anyTraining ? "not-allowed" : "pointer" }}>
        {anyTraining
          ? <><RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }}/> Entrenando secuencialmente…</>
          : <><Play size={12}/> Entrenar Todos (RF → XGB → SVM → MLP)</>}
      </button>
      {anyTraining && (
        <p className="text-[8px] text-center mt-1" style={{ color: "#545d68" }}>
          SVM y MLP pueden tardar varios minutos…
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ModelComparison({ dataset }) {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("overview");
  const [fiModel, setFiModel] = useState("random_forest");

  const load = () => {
    setLoading(true);
    compareModels(dataset)
      .then(r => setData(r.data.comparison || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [dataset]);

  const verdict = buildVerdict(data);

  // ── Derived chart data ────────────────────────────────────────────────────
  const barData = ["accuracy", "f1_score", "precision", "recall"].map(metric => ({
    metric: { accuracy: "Accuracy", f1_score: "F1-Score", precision: "Precision", recall: "Recall" }[metric],
    ...Object.fromEntries(data.map(m => [MODEL_SHORT[m.model_name], +(m[metric] * 100).toFixed(2)])),
  }));

  const radarData = barData;

  const timeData = data.map(m => ({
    model: MODEL_SHORT[m.model_name],
    seconds: m.training_time,
    color: MODEL_COLORS[m.model_name],
  }));

  // ROC: todos los modelos comparten el mismo eje FPR (100 puntos interpolados)
  const rocData = (() => {
    const modelsWithROC = data.filter(m => m.roc_curve?.fpr?.length);
    if (!modelsWithROC.length) return [];
    return modelsWithROC[0].roc_curve.fpr.map((fpr, i) => ({
      fpr: parseFloat(fpr.toFixed(3)),
      ...Object.fromEntries(modelsWithROC.map(m => [MODEL_SHORT[m.model_name], m.roc_curve.tpr[i]])),
    }));
  })();

  // Dataset stats (tomar del primer modelo que tenga)
  const datasetStats = data.find(m => m.dataset_stats)?.dataset_stats;

  const datasetDistData = datasetStats ? [
    {
      name: "Train (antes SMOTE)",
      Normal: datasetStats.train_before_smote?.normal ?? 0,
      Attack: datasetStats.train_before_smote?.attack ?? 0,
    },
    {
      name: "Train (después SMOTE)",
      Normal: datasetStats.train_after_smote?.normal ?? 0,
      Attack: datasetStats.train_after_smote?.attack ?? 0,
    },
    {
      name: "Test",
      Normal: datasetStats.test?.normal ?? 0,
      Attack: datasetStats.test?.attack ?? 0,
    },
  ] : [];

  // Per-class: unificar categorías de todos los modelos
  const allAttackTypes = [...new Set(
    data.flatMap(m => Object.keys(m.per_class_metrics || {}))
  )].sort();

  // Feature importance para el modelo seleccionado
  const fiData = data.find(m => m.model_name === fiModel)?.feature_importance ?? [];

  // MLP loss curve
  const mlpData = data.find(m => m.model_name === "mlp");
  const lossData = (mlpData?.mlp_loss_curve ?? []).map((v, i) => ({ epoch: i + 1, loss: v }));

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    try {
      const res = await exportResults(dataset);
      const url = URL.createObjectURL(new Blob([res.data], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `ids_results_${dataset}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Error al exportar: asegúrate de haber entrenado los modelos.");
    }
  };

  const TABS = [
    { id: "overview",  label: "Resumen",       icon: <Shield size={10}/> },
    { id: "bar",       label: "Métricas",       icon: <Activity size={10}/> },
    { id: "radar",     label: "Radar",          icon: <TrendingUp size={10}/> },
    { id: "matrix",    label: "Confusión",      icon: null },
    { id: "roc",       label: "ROC / AUC",      icon: null },
    { id: "attacks",   label: "Por Ataque",     icon: null },
    { id: "features",  label: "Features",       icon: null },
    { id: "dataset",   label: "Dataset",        icon: <Database size={10}/> },
    { id: "time",      label: "Velocidad",      icon: <Clock size={10}/> },
    { id: "verdict",   label: "Decisión",       icon: <Award size={10}/> },
    { id: "train",     label: "Entrenar",       icon: <Play size={10}/> },
  ];

  const noData = !loading && data.length === 0 && tab !== "train";

  return (
    <div className="flex flex-col gap-4">

      {/* Tab nav + export button */}
      <div className="flex gap-1 flex-wrap items-center">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-semibold transition"
            style={{ background: tab === t.id ? "rgba(88,166,255,0.12)" : "transparent",
                     border: `1px solid ${tab === t.id ? "#58a6ff" : "#1c2333"}`,
                     color: tab === t.id ? "#58a6ff" : "#545d68" }}>
            {t.icon}{t.label}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          <button onClick={handleExport} title="Exportar CSV"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition"
            style={{ background: "rgba(63,185,80,0.07)", border: "1px solid #3fb95033", color: "#3fb950" }}>
            <Download size={10}/> CSV
          </button>
          <button onClick={load}
            className="px-2 py-1 rounded-lg text-[10px] transition"
            style={{ background: "transparent", border: "1px solid #1c2333", color: "#545d68" }}>
            <RefreshCw size={10}/>
          </button>
        </div>
      </div>

      {loading && (
        <div className="text-center py-6" style={{ color: "#545d68" }}>
          <RefreshCw size={16} className="mx-auto mb-2" style={{ animation: "spin 1s linear infinite" }}/>
          <p className="text-[11px]">Cargando métricas…</p>
        </div>
      )}

      {noData && (
        <div className="rounded-xl p-6 text-center" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
          <AlertTriangle size={20} className="mx-auto mb-2" style={{ color: "#d29922" }}/>
          <p className="text-[12px] font-semibold" style={{ color: "#d29922" }}>Sin modelos entrenados</p>
          <p className="text-[10px] mt-1" style={{ color: "#545d68" }}>Ve a la pestaña "Entrenar" para entrenar los modelos.</p>
          <button onClick={() => setTab("train")}
            className="mt-3 px-4 py-1.5 rounded-lg text-[11px] font-semibold"
            style={{ background: "rgba(88,166,255,0.1)", border: "1px solid #58a6ff44", color: "#58a6ff" }}>
            Ir a Entrenar
          </button>
        </div>
      )}

      {/* ── OVERVIEW ── */}
      {!loading && tab === "overview" && data.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            {data.map(m => (
              <div key={m.model_name} className="rounded-xl p-4"
                style={{ background: "#050d14", border: `1px solid ${MODEL_COLORS[m.model_name]}22` }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: MODEL_COLORS[m.model_name] }}/>
                  <p className="text-[12px] font-bold" style={{ color: MODEL_COLORS[m.model_name] }}>
                    {MODEL_SHORT[m.model_name]}
                  </p>
                  {verdict?.winner?.model_name === m.model_name && (
                    <span className="ml-auto px-1.5 py-0.5 rounded text-[8px] font-bold"
                      style={{ background: "rgba(63,185,80,0.12)", color: "#3fb950", border: "1px solid #3fb95033" }}>
                      MEJOR
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5 mb-2">
                  {[["Accuracy", m.accuracy], ["F1-Score", m.f1_score], ["Precision", m.precision],
                    ["Recall", m.recall], ["AUC", m.roc_auc], ["FPR", m.false_positive_rate]].map(([k, v]) => (
                    <div key={k} className="rounded-lg p-2"
                      style={{ background: "#0a1019", border: "1px solid #1c2333" }}>
                      <p className="text-[8px] uppercase tracking-wider" style={{ color: "#545d68" }}>{k}</p>
                      <p className="text-[13px] font-bold font-mono"
                        style={{ color: k === "FPR" ? "#d29922" : k === "AUC" ? "#a371f7" : MODEL_COLORS[m.model_name] }}>
                        {k === "FPR" ? pctRaw(v) : k === "AUC" ? (v != null ? v.toFixed(4) : "—") : pct(v)}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="text-[8px]" style={{ color: "#545d68" }}>
                  <Clock size={8} className="inline mr-1"/>
                  {m.training_time}s · {m.n_samples?.toLocaleString()} muestras
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── BAR CHART ── */}
      {!loading && tab === "bar" && data.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
          <p className="text-[10px] uppercase tracking-widest mb-4" style={{ color: "#545d68" }}>
            Comparativa de Métricas (%)
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
              <XAxis dataKey="metric" tick={{ fill: "#545d68", fontSize: 10 }}/>
              <YAxis domain={[85, 100]} tick={{ fill: "#545d68", fontSize: 10 }} tickFormatter={v => `${v}%`}/>
              <Tooltip
                contentStyle={{ background: "#0a1019", border: "1px solid #1c2333", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "#cdd9e5" }}
                formatter={(v, name) => [`${v}%`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 10, color: "#8b949e" }}/>
              {data.map(m => (
                <Bar key={m.model_name} dataKey={MODEL_SHORT[m.model_name]}
                  fill={MODEL_COLORS[m.model_name]} radius={[4, 4, 0, 0]} opacity={0.85}/>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── RADAR ── */}
      {!loading && tab === "radar" && data.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
          <p className="text-[10px] uppercase tracking-widest mb-4" style={{ color: "#545d68" }}>
            Análisis Multidimensional de Rendimiento
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData} margin={{ top: 8, right: 30, bottom: 8, left: 30 }}>
              <PolarGrid stroke="#1c2333"/>
              <PolarAngleAxis dataKey="metric" tick={{ fill: "#8b949e", fontSize: 10 }}/>
              {data.map(m => (
                <Radar key={m.model_name} name={MODEL_SHORT[m.model_name]}
                  dataKey={MODEL_SHORT[m.model_name]}
                  stroke={MODEL_COLORS[m.model_name]} fill={MODEL_COLORS[m.model_name]}
                  fillOpacity={0.1} strokeWidth={2}/>
              ))}
              <Legend wrapperStyle={{ fontSize: 10, color: "#8b949e" }}/>
              <Tooltip
                contentStyle={{ background: "#0a1019", border: "1px solid #1c2333", borderRadius: 8, fontSize: 11 }}
                formatter={(v, name) => [`${v}%`, name]}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── CONFUSION MATRIX (REAL) ── */}
      {!loading && tab === "matrix" && data.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] uppercase tracking-widest" style={{ color: "#545d68" }}>
            Matrices de Confusión — valores reales del conjunto de prueba
          </p>
          <div className="grid grid-cols-2 gap-3">
            {data.map(m => (
              <div key={m.model_name} className="rounded-xl p-4"
                style={{ background: "#050d14", border: `1px solid ${MODEL_COLORS[m.model_name]}22` }}>
                <p className="text-[11px] font-bold mb-3" style={{ color: MODEL_COLORS[m.model_name] }}>
                  {MODEL_SHORT[m.model_name]}
                  {m.roc_auc && (
                    <span className="ml-2 text-[9px] font-normal" style={{ color: "#a371f7" }}>
                      AUC: {m.roc_auc.toFixed(4)}
                    </span>
                  )}
                </p>
                <RealCM data={m} color={MODEL_COLORS[m.model_name]}/>
              </div>
            ))}
          </div>
          <div className="rounded-xl p-3" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
            <p className="text-[10px]" style={{ color: "#545d68" }}>
              <span style={{ color: "#3fb950" }}>■ TN</span> = Normal clasificado como Normal &nbsp;·&nbsp;
              <span style={{ color: "#d29922" }}>■ FP</span> = Normal clasificado como Ataque (Falsa Alarma) &nbsp;·&nbsp;
              <span style={{ color: "#f85149" }}>■ FN</span> = Ataque no detectado (Peligroso) &nbsp;·&nbsp;
              <span style={{ color: "#58a6ff" }}>■ TP</span> = Ataque detectado correctamente
            </p>
          </div>
        </div>
      )}

      {/* ── ROC CURVE ── */}
      {!loading && tab === "roc" && data.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
            <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#545d68" }}>
              Curvas ROC — Receiver Operating Characteristic
            </p>
            <p className="text-[9px] mb-4" style={{ color: "#545d68" }}>
              Cuanto más cercana al borde superior izquierdo, mejor el clasificador. Línea diagonal = clasificador aleatorio (AUC=0.5).
            </p>
            {rocData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={rocData} margin={{ top: 4, right: 16, bottom: 16, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
                  <XAxis dataKey="fpr" type="number" domain={[0, 1]}
                    tick={{ fill: "#545d68", fontSize: 9 }}
                    label={{ value: "False Positive Rate (FPR)", fill: "#545d68", fontSize: 10, position: "insideBottom", offset: -8 }}/>
                  <YAxis domain={[0, 1]} tick={{ fill: "#545d68", fontSize: 9 }}
                    label={{ value: "True Positive Rate (TPR)", fill: "#545d68", fontSize: 10, angle: -90, position: "insideLeft" }}/>
                  <Tooltip
                    contentStyle={{ background: "#0a1019", border: "1px solid #1c2333", borderRadius: 8, fontSize: 10 }}
                    formatter={(v, name) => [v?.toFixed(4), name]}
                    labelFormatter={v => `FPR: ${parseFloat(v).toFixed(3)}`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10, color: "#8b949e" }}/>
                  {/* Diagonal de referencia */}
                  <ReferenceLine
                    segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
                    stroke="#545d68" strokeDasharray="4 4" strokeWidth={1}/>
                  {data.filter(m => m.roc_curve).map(m => (
                    <Line key={m.model_name}
                      dataKey={MODEL_SHORT[m.model_name]}
                      stroke={MODEL_COLORS[m.model_name]}
                      strokeWidth={2} dot={false}
                      name={`${MODEL_SHORT[m.model_name]} (AUC=${m.roc_auc?.toFixed(4) ?? "—"})`}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-[11px] text-center py-8" style={{ color: "#545d68" }}>
                Entrena los modelos para ver las curvas ROC.
              </p>
            )}
          </div>
          {/* AUC summary */}
          <div className="grid grid-cols-4 gap-2">
            {data.map(m => (
              <div key={m.model_name} className="rounded-xl p-3 text-center"
                style={{ background: "#050d14", border: `1px solid ${MODEL_COLORS[m.model_name]}22` }}>
                <p className="text-[9px] font-bold mb-1" style={{ color: MODEL_COLORS[m.model_name] }}>
                  {MODEL_SHORT[m.model_name]}
                </p>
                <p className="text-[18px] font-bold font-mono" style={{ color: "#a371f7" }}>
                  {m.roc_auc?.toFixed(4) ?? "—"}
                </p>
                <p className="text-[8px]" style={{ color: "#545d68" }}>AUC-ROC</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── POR TIPO DE ATAQUE ── */}
      {!loading && tab === "attacks" && data.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] uppercase tracking-widest" style={{ color: "#545d68" }}>
            Tasa de Detección por Tipo de Ataque
          </p>

          {/* Detection rate bar chart */}
          {allAttackTypes.length > 0 && (() => {
            const chartData = allAttackTypes.map(atype => ({
              type: atype,
              ...Object.fromEntries(
                data.filter(m => m.per_class_metrics?.[atype]?.detection_rate != null)
                    .map(m => [MODEL_SHORT[m.model_name],
                               +(m.per_class_metrics[atype].detection_rate * 100).toFixed(2)])
              ),
            }));
            return (
              <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
                <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "#545d68" }}>
                  Detection Rate por categoría (%)
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
                    <XAxis dataKey="type" tick={{ fill: "#545d68", fontSize: 10 }}/>
                    <YAxis domain={[0, 100]} tick={{ fill: "#545d68", fontSize: 10 }} tickFormatter={v => `${v}%`}/>
                    <Tooltip
                      contentStyle={{ background: "#0a1019", border: "1px solid #1c2333", borderRadius: 8, fontSize: 11 }}
                      formatter={(v, name) => [`${v}%`, name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#8b949e" }}/>
                    {data.map(m => (
                      <Bar key={m.model_name} dataKey={MODEL_SHORT[m.model_name]}
                        fill={MODEL_COLORS[m.model_name]} radius={[4, 4, 0, 0]} opacity={0.85}/>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}

          {/* Per-model tables */}
          {data.map(m => m.per_class_metrics && (
            <div key={m.model_name} className="rounded-xl p-4"
              style={{ background: "#050d14", border: `1px solid ${MODEL_COLORS[m.model_name]}22` }}>
              <p className="text-[11px] font-bold mb-3" style={{ color: MODEL_COLORS[m.model_name] }}>
                {MODEL_SHORT[m.model_name]}
              </p>
              <table className="w-full text-[10px]">
                <thead>
                  <tr style={{ borderBottom: "1px solid #1c2333" }}>
                    {["Tipo de Ataque", "Muestras", "Ataques", "Detectados", "Det. Rate", "Accuracy", "F1", "Precision", "Recall"].map(h => (
                      <th key={h} className="pb-1.5 text-left font-semibold pr-3" style={{ color: "#545d68" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(m.per_class_metrics).map(([atype, stats]) => {
                    const detRate = stats.detection_rate;
                    const detColor = detRate == null ? "#545d68" : detRate >= 0.9 ? "#3fb950" : detRate >= 0.7 ? "#d29922" : "#f85149";
                    return (
                      <tr key={atype} style={{ borderBottom: "1px solid #0d1117" }}>
                        <td className="py-1.5 pr-3 font-semibold" style={{ color: "#cdd9e5" }}>{atype}</td>
                        <td className="py-1.5 pr-3 font-mono" style={{ color: "#8b949e" }}>{stats.n_samples.toLocaleString()}</td>
                        <td className="py-1.5 pr-3 font-mono" style={{ color: "#8b949e" }}>{stats.n_attacks.toLocaleString()}</td>
                        <td className="py-1.5 pr-3 font-mono" style={{ color: "#3fb950" }}>{stats.n_detected.toLocaleString()}</td>
                        <td className="py-1.5 pr-3 font-bold font-mono" style={{ color: detColor }}>
                          {detRate != null ? `${(detRate * 100).toFixed(1)}%` : "N/A"}
                        </td>
                        <td className="py-1.5 pr-3 font-mono" style={{ color: "#8b949e" }}>{(stats.accuracy * 100).toFixed(2)}%</td>
                        <td className="py-1.5 pr-3 font-mono" style={{ color: "#8b949e" }}>{(stats.f1 * 100).toFixed(2)}%</td>
                        <td className="py-1.5 pr-3 font-mono" style={{ color: "#8b949e" }}>{(stats.precision * 100).toFixed(2)}%</td>
                        <td className="py-1.5 pr-3 font-mono" style={{ color: "#8b949e" }}>{(stats.recall * 100).toFixed(2)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── FEATURE IMPORTANCE ── */}
      {!loading && tab === "features" && data.length > 0 && (
        <div className="flex flex-col gap-3">
          {/* Model selector */}
          <div className="flex gap-2">
            {data.map(m => (
              <button key={m.model_name} onClick={() => setFiModel(m.model_name)}
                className="px-3 py-1 rounded-lg text-[10px] font-semibold transition"
                style={{ background: fiModel === m.model_name ? `rgba(${MODEL_COLORS[m.model_name] === "#58a6ff" ? "88,166,255" : MODEL_COLORS[m.model_name] === "#3fb950" ? "63,185,80" : MODEL_COLORS[m.model_name] === "#a371f7" ? "163,113,247" : "210,153,34"},0.12)` : "transparent",
                         border: `1px solid ${fiModel === m.model_name ? MODEL_COLORS[m.model_name] : "#1c2333"}`,
                         color: fiModel === m.model_name ? MODEL_COLORS[m.model_name] : "#545d68" }}>
                {MODEL_SHORT[m.model_name]}
              </button>
            ))}
          </div>

          {fiData.length > 0 ? (
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#545d68" }}>
                Top 20 Features más importantes — {MODEL_SHORT[fiModel]}
              </p>
              <p className="text-[9px] mb-4" style={{ color: "#545d68" }}>
                {fiModel === "svm" ? "Magnitud de coeficientes del clasificador lineal." : "Reducción media de impureza de Gini por feature."}
              </p>
              <ResponsiveContainer width="100%" height={420}>
                <BarChart data={[...fiData].reverse()} layout="vertical"
                  margin={{ left: 140, right: 20, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
                  <XAxis type="number" tick={{ fill: "#545d68", fontSize: 9 }}/>
                  <YAxis dataKey="feature" type="category" tick={{ fill: "#8b949e", fontSize: 9 }} width={135}/>
                  <Tooltip
                    contentStyle={{ background: "#0a1019", border: "1px solid #1c2333", borderRadius: 8, fontSize: 10 }}
                    formatter={(v) => [v.toFixed(6), "Importancia"]}
                  />
                  <Bar dataKey="importance" radius={[0, 4, 4, 0]}>
                    {fiData.map((_, i) => (
                      <Cell key={i} fill={MODEL_COLORS[fiModel]} opacity={0.6 + (i / fiData.length) * 0.4}/>
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl p-6 text-center" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[11px]" style={{ color: "#545d68" }}>
                {fiModel === "mlp"
                  ? "MLP no tiene importancia de features directa (caja negra). Usa SHAP para interpretabilidad."
                  : "Entrena el modelo para ver la importancia de features."}
              </p>
            </div>
          )}

          {/* MLP loss curve */}
          {lossData.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#545d68" }}>
                Curva de Pérdida — MLP (entrenamiento)
              </p>
              <p className="text-[9px] mb-4" style={{ color: "#545d68" }}>
                Convergencia del optimizador Adam. Early stopping activo.
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={lossData} margin={{ top: 4, right: 16, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
                  <XAxis dataKey="epoch" tick={{ fill: "#545d68", fontSize: 9 }}
                    label={{ value: "Época", fill: "#545d68", fontSize: 10, position: "insideBottom", offset: -4 }}/>
                  <YAxis tick={{ fill: "#545d68", fontSize: 9 }}
                    label={{ value: "Loss", fill: "#545d68", fontSize: 10, angle: -90, position: "insideLeft" }}/>
                  <Tooltip
                    contentStyle={{ background: "#0a1019", border: "1px solid #1c2333", borderRadius: 8, fontSize: 10 }}
                    formatter={(v) => [v.toFixed(6), "Loss"]}
                    labelFormatter={v => `Época ${v}`}
                  />
                  <Line dataKey="loss" stroke={MODEL_COLORS.mlp} strokeWidth={2} dot={false} name="Training Loss"/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ── DATASET DISTRIBUTION ── */}
      {!loading && tab === "dataset" && (
        <div className="flex flex-col gap-3">
          {datasetStats ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["Features", datasetStats.n_features, "#58a6ff"],
                  ["Train antes SMOTE", datasetStats.train_before_smote?.normal + datasetStats.train_before_smote?.attack, "#8b949e"],
                  ["Train después SMOTE", datasetStats.train_after_smote?.normal + datasetStats.train_after_smote?.attack, "#3fb950"],
                  ["Test samples", datasetStats.test?.normal + datasetStats.test?.attack, "#a371f7"],
                  ["Normal (test)", datasetStats.test?.normal, "#3fb950"],
                  ["Attack (test)", datasetStats.test?.attack, "#f85149"],
                ].map(([label, value, color]) => (
                  <div key={label} className="rounded-xl p-3 text-center"
                    style={{ background: "#050d14", border: "1px solid #1c2333" }}>
                    <p className="text-[8px] uppercase tracking-wider mb-1" style={{ color: "#545d68" }}>{label}</p>
                    <p className="text-[16px] font-bold font-mono" style={{ color }}>
                      {value?.toLocaleString() ?? "—"}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
                <p className="text-[10px] uppercase tracking-widest mb-4" style={{ color: "#545d68" }}>
                  Distribución de Clases — Efecto del SMOTE
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={datasetDistData} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
                    <XAxis dataKey="name" tick={{ fill: "#545d68", fontSize: 9 }}/>
                    <YAxis tick={{ fill: "#545d68", fontSize: 9 }} tickFormatter={v => v.toLocaleString()}/>
                    <Tooltip
                      contentStyle={{ background: "#0a1019", border: "1px solid #1c2333", borderRadius: 8, fontSize: 11 }}
                      formatter={(v) => [v.toLocaleString(), ""]}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, color: "#8b949e" }}/>
                    <Bar dataKey="Normal" fill="#3fb950" radius={[4, 4, 0, 0]} opacity={0.85}/>
                    <Bar dataKey="Attack" fill="#f85149" radius={[4, 4, 0, 0]} opacity={0.85}/>
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-[9px] mt-2" style={{ color: "#545d68" }}>
                  SMOTE (Synthetic Minority Oversampling Technique) balancea las clases generando muestras sintéticas de la clase minoritaria.
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-xl p-6 text-center" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[11px]" style={{ color: "#545d68" }}>Entrena al menos un modelo para ver las estadísticas del dataset.</p>
            </div>
          )}
        </div>
      )}

      {/* ── TRAINING TIME ── */}
      {!loading && tab === "time" && data.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
          <p className="text-[10px] uppercase tracking-widest mb-4" style={{ color: "#545d68" }}>
            Tiempo de Entrenamiento (segundos)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={timeData} layout="vertical" margin={{ left: 60, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1c2333"/>
              <XAxis type="number" tick={{ fill: "#545d68", fontSize: 10 }} tickFormatter={v => `${v}s`}/>
              <YAxis dataKey="model" type="category" tick={{ fill: "#8b949e", fontSize: 10 }} width={80}/>
              <Tooltip
                contentStyle={{ background: "#0a1019", border: "1px solid #1c2333", borderRadius: 8, fontSize: 11 }}
                formatter={(v) => [`${v}s`, "Tiempo"]}
              />
              <Bar dataKey="seconds" radius={[0, 4, 4, 0]}>
                {timeData.map((entry, i) => (
                  <Cell key={i} fill={entry.color}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {timeData.map(m => (
              <div key={m.model} className="rounded-lg p-2 flex items-center gap-2"
                style={{ background: "#0a1019", border: "1px solid #1c2333" }}>
                <div className="w-2 h-2 rounded-full" style={{ background: m.color }}/>
                <span className="text-[10px]" style={{ color: "#8b949e" }}>{m.model}</span>
                <span className="ml-auto text-[11px] font-mono font-bold" style={{ color: m.color }}>{m.seconds}s</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── VERDICT ── */}
      {!loading && tab === "verdict" && verdict && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl p-5"
            style={{ background: "linear-gradient(135deg, #050d14 0%, #0a1a0a 100%)",
                     border: `2px solid ${MODEL_COLORS[verdict.winner.model_name]}44` }}>
            <div className="flex items-center gap-3 mb-3">
              <Award size={18} style={{ color: MODEL_COLORS[verdict.winner.model_name] }}/>
              <div>
                <p className="text-[9px] uppercase tracking-widest" style={{ color: "#545d68" }}>Modelo Recomendado para IDS</p>
                <p className="text-[16px] font-bold" style={{ color: MODEL_COLORS[verdict.winner.model_name] }}>
                  {MODEL_SHORT[verdict.winner.model_name]}
                </p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-[9px] uppercase tracking-widest" style={{ color: "#545d68" }}>Score Compuesto</p>
                <p className="text-[18px] font-bold font-mono" style={{ color: MODEL_COLORS[verdict.winner.model_name] }}>
                  {(verdict.winner.score * 100).toFixed(2)}%
                </p>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: "#8b949e" }}>
              {verdict.reasons[verdict.winner.model_name]}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[["Accuracy", verdict.winner.accuracy], ["F1-Score", verdict.winner.f1_score],
                ["Precision", verdict.winner.precision], ["Recall", verdict.winner.recall],
                ["AUC", verdict.winner.roc_auc], ["FPR", verdict.winner.false_positive_rate]].map(([k, v]) => (
                <div key={k} className="rounded-lg p-2 text-center"
                  style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #1c2333" }}>
                  <p className="text-[8px]" style={{ color: "#545d68" }}>{k}</p>
                  <p className="text-[13px] font-bold" style={{ color: MODEL_COLORS[verdict.winner.model_name] }}>
                    {k === "AUC" ? (v != null ? v.toFixed(4) : "—") : k === "FPR" ? pctRaw(v) : pct(v)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
            <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "#545d68" }}>
              Ranking Global — Score Ponderado (F1×0.4 + Acc×0.3 + Prec×0.2 + Rec×0.1)
            </p>
            {verdict.scored.map((m, i) => (
              <div key={m.model_name} className="flex items-center gap-3 py-2"
                style={{ borderBottom: i < verdict.scored.length - 1 ? "1px solid #1c2333" : "none" }}>
                <span className="text-[18px] font-bold w-6 text-center"
                  style={{ color: i === 0 ? "#d29922" : i === 1 ? "#8b949e" : "#545d68" }}>
                  {i + 1}
                </span>
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: MODEL_COLORS[m.model_name] }}/>
                <span className="text-[11px] font-semibold flex-1" style={{ color: "#cdd9e5" }}>
                  {MODEL_SHORT[m.model_name]}
                </span>
                <div className="flex-1 rounded-full overflow-hidden h-2" style={{ background: "#1c2333" }}>
                  <div className="h-full rounded-full"
                    style={{ width: `${m.score * 100}%`, background: MODEL_COLORS[m.model_name], opacity: 0.85 }}/>
                </div>
                <span className="text-[11px] font-mono font-bold w-14 text-right"
                  style={{ color: MODEL_COLORS[m.model_name] }}>
                  {(m.score * 100).toFixed(2)}%
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] font-bold mb-2 flex items-center gap-1" style={{ color: "#3fb950" }}>
                <Shield size={11}/> Fortalezas por Modelo
              </p>
              {data.map(m => (
                <div key={m.model_name} className="mb-2">
                  <p className="text-[9px] font-semibold" style={{ color: MODEL_COLORS[m.model_name] }}>
                    {MODEL_SHORT[m.model_name]}
                  </p>
                  {(m.model_info?.strengths || []).map(s => (
                    <p key={s} className="text-[9px]" style={{ color: "#8b949e" }}>· {s}</p>
                  ))}
                </div>
              ))}
            </div>
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] font-bold mb-2 flex items-center gap-1" style={{ color: "#f85149" }}>
                <AlertTriangle size={11}/> Limitaciones
              </p>
              {data.map(m => (
                <div key={m.model_name} className="mb-2">
                  <p className="text-[9px] font-semibold" style={{ color: MODEL_COLORS[m.model_name] }}>
                    {MODEL_SHORT[m.model_name]}
                  </p>
                  {(m.model_info?.weaknesses || []).map(w => (
                    <p key={w} className="text-[9px]" style={{ color: "#8b949e" }}>· {w}</p>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl p-4" style={{ background: "#0a0505", border: "1px solid #f8514922" }}>
            <p className="text-[10px] font-bold mb-2 flex items-center gap-1" style={{ color: "#f85149" }}>
              <Zap size={11}/> Recomendación Específica para IDS Empresarial
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: "#8b949e" }}>
              Para un sistema IDS en red empresarial, la prioridad es <strong style={{ color: "#cdd9e5" }}>minimizar falsos negativos</strong> (ataques no detectados)
              y <strong style={{ color: "#cdd9e5" }}>maximizar el Recall y el AUC-ROC</strong>. El F1-Score equilibra precisión y recall.
              {verdict.winner.model_name === "xgboost" && " XGBoost logra el mejor balance entre detectar todos los ataques y generar pocas falsas alarmas."}
              {verdict.winner.model_name === "random_forest" && " Random Forest es altamente interpretable y robusto, clave para auditorías de seguridad."}
              {verdict.winner.model_name === "svm" && " SVM es el modelo con mayor base académica en IDS. Su separación de margen máximo reduce los falsos positivos."}
              {verdict.winner.model_name === "mlp" && " La red neuronal MLP captura patrones de ataque no lineales y complejos, ideal para amenazas avanzadas."}
            </p>
          </div>
        </div>
      )}

      {/* ── TRAIN TAB ── */}
      {tab === "train" && (
        <TrainAllButton dataset={dataset} onDone={load}/>
      )}
    </div>
  );
}
