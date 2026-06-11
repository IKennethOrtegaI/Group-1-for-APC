import { useEffect, useState } from "react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";
import { compareModels, trainModel, getTrainStatus } from "../api/client";
import { Shield, Zap, Award, AlertTriangle, Clock, RefreshCw, Play } from "lucide-react";

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

const METRIC_LABELS = {
  accuracy:  "Accuracy",
  f1_score:  "F1-Score",
  precision: "Precision",
  recall:    "Recall",
};

function pct(v) { return v != null ? `${(v * 100).toFixed(2)}%` : "—"; }

// ── Decision engine ─────────────────────────────────────────────────────────
function buildVerdict(data) {
  if (!data.length) return null;
  const scored = data.map(m => ({
    ...m,
    score: (m.f1_score || 0) * 0.4 + (m.accuracy || 0) * 0.3 +
           (m.precision || 0) * 0.2 + (m.recall || 0) * 0.1,
  }));
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const reasons = {
    random_forest: "Excelente balance entre precisión y velocidad. Robusto ante datos desbalanceados. Estándar de la industria para IDS.",
    xgboost:       "Mayor accuracy gracias al gradient boosting. Regularización integrada reduce falsos positivos. Ideal para datasets grandes.",
    svm:           "Máximo margen de separación en espacio de alta dimensión. Muy resistente al overfitting. Referencia académica en IDS.",
    mlp:           "Captura relaciones no lineales complejas entre features. Mejor a medida que crece el volumen de datos.",
  };
  return { winner, scored, reasons };
}

// ── Confusion Matrix mini-viz ───────────────────────────────────────────────
function MiniCM({ data, model }) {
  // Synthesize a plausible CM from precision/recall/accuracy since
  // the compare endpoint only returns aggregate metrics
  const N = 5000;
  const acc = data.accuracy || 0.95;
  const tp = Math.round(N * 0.5 * data.recall);
  const fn = Math.round(N * 0.5 * (1 - data.recall));
  const fp = data.precision > 0 ? Math.round(tp * (1 - data.precision) / data.precision) : 50;
  const tn = N - tp - fn - fp;
  const cells = [
    { label: "TN", v: tn, color: "#3fb950", desc: "Normal → Normal" },
    { label: "FP", v: fp, color: "#d29922", desc: "Normal → Ataque" },
    { label: "FN", v: fn, color: "#f85149", desc: "Ataque → Normal" },
    { label: "TP", v: tp, color: "#58a6ff", desc: "Ataque → Ataque" },
  ];
  return (
    <div>
      <p className="text-[9px] uppercase tracking-widest mb-2" style={{ color: "#545d68" }}>Matriz de Confusión (estimada)</p>
      <div className="grid grid-cols-2 gap-1">
        {cells.map(c => (
          <div key={c.label} className="rounded-lg p-2 text-center"
            style={{ background: `rgba(${c.color === "#3fb950" ? "63,185,80" : c.color === "#d29922" ? "210,153,34" : c.color === "#f85149" ? "248,81,73" : "88,166,255"},0.08)`,
                     border: `1px solid ${c.color}22` }}>
            <p className="text-[8px]" style={{ color: "#545d68" }}>{c.desc}</p>
            <p className="text-[14px] font-bold" style={{ color: c.color }}>{c.label}</p>
            <p className="text-[11px] font-mono" style={{ color: c.color }}>{c.v.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <p className="text-[8px] mt-1 text-center" style={{ color: "#1c2333" }}>Basada en proporción de métricas (N≈{N})</p>
    </div>
  );
}

// ── Train all button ─────────────────────────────────────────────────────────
function TrainAllButton({ dataset, onDone }) {
  const [status, setStatus] = useState({}); // model → "idle"|"training"|"done"|"error"
  const models = ["random_forest", "xgboost", "svm", "mlp"];

  const trainAll = async () => {
    for (const m of models) {
      setStatus(s => ({ ...s, [m]: "training" }));
      try {
        await trainModel(dataset, m);
        // Poll until done
        await new Promise((resolve) => {
          const iv = setInterval(async () => {
            try {
              const r = await getTrainStatus(dataset, m);
              const st = r.data?.status;
              if (st === "done" || (typeof st === "object" && st?.status === "done")) {
                clearInterval(iv);
                setStatus(s => ({ ...s, [m]: "done" }));
                resolve();
              } else if (st === "error" || (typeof st === "object" && st?.status === "error")) {
                clearInterval(iv);
                setStatus(s => ({ ...s, [m]: "error" }));
                resolve();
              }
            } catch { clearInterval(iv); resolve(); }
          }, 3000);
        });
      } catch {
        setStatus(s => ({ ...s, [m]: "error" }));
      }
    }
    onDone();
  };

  const allDone = models.every(m => status[m] === "done");
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
        {anyTraining ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }}/> : <Play size={12}/>}
        {anyTraining ? "Entrenando secuencialmente…" : "Entrenar Todos (RF → XGB → SVM → MLP)"}
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
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  const load = () => {
    setLoading(true);
    compareModels(dataset)
      .then(r => setData(r.data.comparison || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [dataset]);

  const verdict = buildVerdict(data);

  // Bar chart data
  const barData = ["accuracy", "f1_score", "precision", "recall"].map(metric => ({
    metric: METRIC_LABELS[metric],
    ...Object.fromEntries(data.map(m => [MODEL_SHORT[m.model_name], +(m[metric] * 100).toFixed(2)])),
  }));

  // Radar chart data
  const radarData = ["accuracy", "f1_score", "precision", "recall"].map(metric => ({
    metric: METRIC_LABELS[metric],
    ...Object.fromEntries(data.map(m => [MODEL_SHORT[m.model_name], +(m[metric] * 100).toFixed(2)])),
  }));

  // Training time bar
  const timeData = data.map(m => ({
    model: MODEL_SHORT[m.model_name],
    seconds: m.training_time,
    color: MODEL_COLORS[m.model_name],
  }));

  const TABS = [
    { id: "overview", label: "Resumen" },
    { id: "bar",      label: "Métricas" },
    { id: "radar",    label: "Radar" },
    { id: "time",     label: "Velocidad" },
    { id: "matrix",   label: "Confusión" },
    { id: "verdict",  label: "Decisión" },
    { id: "train",    label: "Entrenar" },
  ];

  return (
    <div className="flex flex-col gap-4">

      {/* Tab nav */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-3 py-1 rounded-lg text-[10px] font-semibold transition"
            style={{ background: tab === t.id ? "rgba(88,166,255,0.12)" : "transparent",
                     border: `1px solid ${tab === t.id ? "#58a6ff" : "#1c2333"}`,
                     color: tab === t.id ? "#58a6ff" : "#545d68" }}>
            {t.label}
          </button>
        ))}
        <button onClick={load}
          className="ml-auto px-2 py-1 rounded-lg text-[10px] transition"
          style={{ background: "transparent", border: "1px solid #1c2333", color: "#545d68" }}>
          <RefreshCw size={10}/>
        </button>
      </div>

      {loading && (
        <div className="text-center py-6" style={{ color: "#545d68" }}>
          <RefreshCw size={16} className="mx-auto mb-2" style={{ animation: "spin 1s linear infinite" }}/>
          <p className="text-[11px]">Cargando métricas…</p>
        </div>
      )}

      {!loading && data.length === 0 && tab !== "train" && (
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
              <div className="grid grid-cols-2 gap-2">
                {[["Accuracy", m.accuracy], ["F1-Score", m.f1_score], ["Precision", m.precision], ["Recall", m.recall]].map(([k, v]) => (
                  <div key={k} className="rounded-lg p-2"
                    style={{ background: "#0a1019", border: "1px solid #1c2333" }}>
                    <p className="text-[8px] uppercase tracking-wider" style={{ color: "#545d68" }}>{k}</p>
                    <p className="text-[14px] font-bold font-mono" style={{ color: MODEL_COLORS[m.model_name] }}>
                      {pct(v)}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-[8px] mt-2" style={{ color: "#545d68" }}>
                <Clock size={8} className="inline mr-1"/>
                {m.training_time}s · {m.n_samples?.toLocaleString()} muestras
              </p>
            </div>
          ))}
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
                <Radar key={m.model_name}
                  name={MODEL_SHORT[m.model_name]}
                  dataKey={MODEL_SHORT[m.model_name]}
                  stroke={MODEL_COLORS[m.model_name]}
                  fill={MODEL_COLORS[m.model_name]}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
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
          <p className="text-[9px] mt-3" style={{ color: "#545d68" }}>
            * SVM es más lento por la optimización cuadrática. MLP depende de la convergencia. XGBoost es típicamente el más rápido con alta accuracy.
          </p>
        </div>
      )}

      {/* ── CONFUSION MATRIX ── */}
      {!loading && tab === "matrix" && data.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {data.map(m => (
            <div key={m.model_name} className="rounded-xl p-4"
              style={{ background: "#050d14", border: `1px solid ${MODEL_COLORS[m.model_name]}22` }}>
              <p className="text-[11px] font-bold mb-3" style={{ color: MODEL_COLORS[m.model_name] }}>
                {MODEL_SHORT[m.model_name]}
              </p>
              <MiniCM data={m} model={m.model_name}/>
            </div>
          ))}
        </div>
      )}

      {/* ── VERDICT ── */}
      {!loading && tab === "verdict" && verdict && (
        <div className="flex flex-col gap-3">

          {/* Winner card */}
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
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[["Accuracy", verdict.winner.accuracy], ["F1-Score", verdict.winner.f1_score],
                ["Precision", verdict.winner.precision], ["Recall", verdict.winner.recall]].map(([k, v]) => (
                <div key={k} className="rounded-lg p-2 text-center"
                  style={{ background: "rgba(0,0,0,0.3)", border: "1px solid #1c2333" }}>
                  <p className="text-[8px]" style={{ color: "#545d68" }}>{k}</p>
                  <p className="text-[13px] font-bold" style={{ color: MODEL_COLORS[verdict.winner.model_name] }}>{pct(v)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Ranking */}
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
                <div className="flex-1 rounded-full overflow-hidden h-2"
                  style={{ background: "#1c2333" }}>
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

          {/* Use-case analysis */}
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

          {/* IDS-specific recommendation */}
          <div className="rounded-xl p-4" style={{ background: "#0a0505", border: "1px solid #f8514922" }}>
            <p className="text-[10px] font-bold mb-2 flex items-center gap-1" style={{ color: "#f85149" }}>
              <Zap size={11}/> Recomendación Específica para IDS Empresarial
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: "#8b949e" }}>
              Para un sistema IDS en red empresarial, la prioridad es <strong style={{ color: "#cdd9e5" }}>minimizar falsos negativos</strong> (ataques no detectados)
              y <strong style={{ color: "#cdd9e5" }}>maximizar el Recall</strong>. El F1-Score es la métrica más equilibrada para este contexto.
              {verdict.winner.model_name === "xgboost" && " XGBoost logra el mejor balance entre detectar todos los ataques y generar pocas falsas alarmas, haciéndolo ideal para entornos productivos."}
              {verdict.winner.model_name === "random_forest" && " Random Forest es altamente interpretable y robusto, clave para auditorías de seguridad donde hay que justificar cada alerta."}
              {verdict.winner.model_name === "svm" && " SVM con kernel RBF es el modelo con mayor base académica en IDS. Su separación de margen máximo reduce los falsos positivos en datasets de alta dimensión."}
              {verdict.winner.model_name === "mlp" && " La red neuronal MLP es capaz de aprender patrones de ataque no lineales y complejos, haciéndola ideal para amenazas avanzadas (APT, zero-day)."}
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
