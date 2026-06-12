import { useState, useRef, useEffect } from "react";
import {
  Wifi, Search, Activity, Shield, ShieldAlert,
  Loader2, Globe, Zap, Radio, ChevronDown, ChevronUp, Database,
} from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const THREAT_COLOR = { LOW: "#3fb950", MEDIUM: "#d29922", HIGH: "#f85149" };
const THREAT_LABEL = { LOW: "NORMAL", MEDIUM: "SOSPECHOSO", HIGH: "AMENAZA DETECTADA" };

const MODELS = [
  { value: "random_forest", label: "Random Forest" },
  { value: "xgboost",       label: "XGBoost"       },
  { value: "svm",           label: "SVM"            },
  { value: "mlp",           label: "MLP (Red Neuronal)" },
];

const DATASETS = [
  { value: "nslkdd", label: "NSL-KDD",     color: "#58a6ff", desc: "41 features · DoS/Probe/R2L/U2R" },
  { value: "cicids", label: "CICIDS2017",  color: "#a371f7", desc: "78 features · DDoS/BENIGN" },
];

const SIM_MODES = {
  nslkdd: [
    {
      value: "dos", label: "Simulación DoS", icon: Zap, color: "#f85149",
      desc: "Muestras reales de neptune/smurf/pod del test set NSL-KDD. Típico: count=511, serror_rate=1.0, flag=S0.",
    },
    {
      value: "probe", label: "Simulación Port Scan", icon: Radio, color: "#d29922",
      desc: "Muestras reales de ipsweep/portsweep/nmap del test set NSL-KDD. Típico: diff_srv_rate alto, rerror_rate alto.",
    },
  ],
  cicids: [
    {
      value: "ddos", label: "Simulación DDoS", icon: Zap, color: "#f85149",
      desc: "Muestras reales de DDoS del CICIDS2017 Friday dataset. 128k+ muestras de tráfico de ataque real.",
    },
  ],
};

function StatBadge({ label, value, color = "#58a6ff" }) {
  return (
    <div className="rounded p-2.5 border border-white/5 bg-white/3 min-w-0">
      <div className="text-[9px] text-white/30 font-mono uppercase truncate">{label}</div>
      <div className="text-sm font-bold font-mono mt-0.5 truncate" style={{ color }}>{value}</div>
    </div>
  );
}

function RateBar({ label, value, color }) {
  const pct = Math.min(100, Math.round((value ?? 0) * 100));
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <span className="text-white/40 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-10 text-right" style={{ color }}>{pct}%</span>
    </div>
  );
}

function ProbeRow({ probe }) {
  const [open, setOpen] = useState(false);
  const att = probe.prediction === "Attack";
  const ok  = probe.http?.ok;
  return (
    <>
      <div className="flex items-center gap-3 py-1.5 border-b border-white/5 text-xs font-mono cursor-pointer hover:bg-white/2"
        onClick={() => setOpen(v => !v)}>
        <span className="text-white/30 w-4">#{probe.probe}</span>
        <span className={ok ? "text-green-400" : "text-red-400"}>
          {ok ? "●" : "○"} {probe.http?.status_code ?? "—"}
        </span>
        <span className="text-white/50">{probe.tcp?.flag ?? "—"}</span>
        <span className="text-white/50">{probe.tcp?.latency_ms ? `${probe.tcp.latency_ms}ms` : "timeout"}</span>
        <span className="text-white/40">{probe.http?.duration_ms}ms HTTP</span>
        <span className="text-white/30">{probe.http?.content_bytes ? `${(probe.http.content_bytes/1024).toFixed(1)}KB` : "0B"}</span>
        {probe.prediction && (
          <span style={{ color: att ? "#f85149" : "#3fb950" }} className="ml-auto flex items-center gap-1">
            {att ? "⚠ ATTACK" : "✓ NORMAL"}
            <span className="text-white/25">{(probe.confidence * 100).toFixed(1)}%</span>
          </span>
        )}
        {open ? <ChevronUp size={10} className="text-white/20" /> : <ChevronDown size={10} className="text-white/20" />}
      </div>
      {open && probe.features && (
        <div className="bg-black/30 px-3 py-2 text-[10px] font-mono text-white/40 border-b border-white/5">
          <div className="text-[9px] text-white/20 mb-1">FEATURES EXTRAÍDOS ({probe.features.length})</div>
          <div className="grid grid-cols-4 gap-x-4 gap-y-0.5">
            {probe.features.slice(0, 20).map((v, i) => (
              <span key={i}><span className="text-white/20">f{i}:</span> <span className="text-white/60">{typeof v === "number" ? v.toFixed(3) : v}</span></span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function SimStepRow({ step }) {
  const att      = step.prediction === "Attack";
  const isVerdict = step.step === "Clasificación final";
  const isBase   = step.step?.includes("base");
  return (
    <div className={`p-2.5 rounded border text-xs font-mono mb-1.5 ${
      isVerdict
        ? att ? "border-red-500/40 bg-red-500/5" : "border-green-500/40 bg-green-500/5"
        : isBase ? "border-blue-500/20 bg-blue-500/3"
        : "border-white/5 bg-white/2"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-white/60 font-semibold truncate">{step.step}</span>
        {step.prediction && (
          <span className="shrink-0" style={{ color: att ? "#f85149" : "#3fb950" }}>
            {att ? "⚠ ATTACK" : "✓ NORMAL"} {step.confidence ? `${(step.confidence * 100).toFixed(1)}%` : ""}
          </span>
        )}
      </div>
      {step.description && <div className="text-white/30 mt-0.5 text-[10px]">{step.description}</div>}
      {step.key_features && (
        <div className="flex flex-wrap gap-3 mt-1 text-[10px]">
          {Object.entries(step.key_features).map(([k, v]) => (
            <span key={k}><span className="text-white/25">{k}:</span> <span className="text-yellow-400">{v}</span></span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NetworkMonitor() {
  const [tab,     setTab]    = useState("monitor");
  const [dataset, setDataset]= useState("nslkdd");

  // Monitor state
  const [target,  setTarget] = useState("");
  const [count,   setCount]  = useState(5);
  const [model,   setModel]  = useState("random_forest");
  const [loading, setLoading]= useState(false);
  const [result,  setResult] = useState(null);
  const [error,   setError]  = useState(null);
  const [autoMode,setAutoMode]=useState(false);

  // Sim state
  const [simMode,     setSimMode]     = useState("dos");
  const [simTarget,   setSimTarget]   = useState("");
  const [simModel,    setSimModel]    = useState("random_forest");
  const [simIntensity,setSimIntensity]= useState(8);
  const [simLoading,  setSimLoading]  = useState(false);
  const [simResult,   setSimResult]   = useState(null);
  const [simError,    setSimError]    = useState(null);

  const timerRef = useRef(null);

  // Reset sim mode when dataset changes
  useEffect(() => {
    const modes = SIM_MODES[dataset] || [];
    if (modes.length > 0) setSimMode(modes[0].value);
    setResult(null); setSimResult(null);
  }, [dataset]);

  const ds = DATASETS.find(d => d.value === dataset);

  const runProbe = async () => {
    if (!target.trim()) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/monitor/probe`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), count, model_name: model, dataset }),
      });
      if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.detail || `HTTP ${res.status}`); }
      setResult(await res.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const runSim = async () => {
    if (!simTarget.trim()) return;
    setSimLoading(true); setSimError(null); setSimResult(null);
    try {
      const res = await fetch(`${API_URL}/monitor/simulate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: simTarget.trim(), mode: simMode, model_name: simModel, dataset, intensity: simIntensity }),
      });
      if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.detail || `HTTP ${res.status}`); }
      setSimResult(await res.json());
    } catch (e) { setSimError(e.message); }
    finally { setSimLoading(false); }
  };

  useEffect(() => {
    if (autoMode && target.trim()) {
      timerRef.current = setInterval(runProbe, 30_000);
      return () => clearInterval(timerRef.current);
    }
    clearInterval(timerRef.current);
  }, [autoMode, target, count, model, dataset]);

  const summary = result?.summary;
  const level   = summary?.threat_level ?? "LOW";
  const simModes = SIM_MODES[dataset] || [];

  return (
    <div className="h-full flex flex-col gap-3 text-sm">

      {/* Dataset selector */}
      <div className="shrink-0 flex gap-2 items-center">
        <Database size={12} className="text-white/30" />
        <span className="text-[10px] text-white/30 font-mono uppercase">Dataset:</span>
        {DATASETS.map(d => (
          <button key={d.value} onClick={() => setDataset(d.value)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-semibold transition"
            style={{
              background:  dataset === d.value ? d.color + "15" : "transparent",
              border:      `1px solid ${dataset === d.value ? d.color + "45" : "rgba(255,255,255,0.06)"}`,
              color:       dataset === d.value ? d.color : "#545d68",
            }}>
            {d.label}
            <span className="text-white/20 font-normal">{d.desc}</span>
          </button>
        ))}
      </div>

      {/* Tab bar */}
      <div className="shrink-0 flex gap-1">
        {[
          { id: "monitor",  label: "Monitor de Red",        icon: Search },
          { id: "simulate", label: "Simulación de Ataques", icon: Zap    },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-semibold transition"
            style={{
              background:  tab === id ? (ds?.color || "#58a6ff") + "12" : "transparent",
              border:      `1px solid ${tab === id ? (ds?.color || "#58a6ff") + "35" : "rgba(255,255,255,0.06)"}`,
              color:       tab === id ? (ds?.color || "#58a6ff") : "#545d68",
            }}>
            <Icon size={11} />{label}
          </button>
        ))}
      </div>

      {/* ── TAB: MONITOR ──────────────────────────────────────────────────── */}
      {tab === "monitor" && (
        <>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
              <input value={target} onChange={e => setTarget(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runProbe()}
                placeholder="IP o URL — ej. 8.8.8.8 · google.com · unmsm.edu.pe"
                className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded text-white placeholder-white/20 focus:outline-none text-xs font-mono"
                style={{ "--tw-ring-color": ds?.color }}
              />
            </div>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-2 text-white/70 text-xs">
              {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select value={count} onChange={e => setCount(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded px-2 text-white/70 text-xs">
              {[1,3,5,10].map(n => <option key={n} value={n}>{n} sondeos</option>)}
            </select>
            <button onClick={runProbe} disabled={loading || !target.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold transition disabled:opacity-40"
              style={{ background: (ds?.color||"#58a6ff")+"15", border: `1px solid ${(ds?.color||"#58a6ff")}35`, color: ds?.color||"#58a6ff" }}>
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              {loading ? "Analizando…" : "Escanear"}
            </button>
            <button onClick={() => setAutoMode(v => !v)}
              className={`flex items-center gap-1 px-3 py-2 rounded text-xs border transition ${autoMode ? "bg-green-500/15 border-green-500/35 text-green-400" : "bg-white/5 border-white/10 text-white/35"}`}>
              <Activity size={13} /> Auto
            </button>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/25 rounded p-3 text-red-400 text-xs font-mono shrink-0">✗ {error}</div>
          )}

          {loading && !result && (
            <div className="flex-1 flex items-center justify-center text-white/25 gap-3">
              <Loader2 size={20} className="animate-spin" />
              <span className="font-mono text-xs">Sondeando {target} — clasificando con {dataset.toUpperCase()} / {MODELS.find(m=>m.value===model)?.label}…</span>
            </div>
          )}

          {result && (
            <>
              <div className="grid grid-cols-4 gap-2 shrink-0">
                <StatBadge label="IP resuelta"  value={result.resolved_ip}                                          color={ds?.color} />
                <StatBadge label="Latencia TCP" value={summary?.avg_latency_ms ? `${summary.avg_latency_ms}ms` : "—"} color="#3fb950" />
                <StatBadge label="Tiempo HTTP"  value={summary?.avg_duration_ms ? `${summary.avg_duration_ms}ms` : "—"} color="#a371f7" />
                <StatBadge label="Dataset"      value={result.dataset?.toUpperCase()}                               color={ds?.color} />
              </div>

              <div className="shrink-0 rounded border border-white/5 bg-black/20 p-3 space-y-1.5">
                <div className="text-[9px] text-white/25 font-mono uppercase mb-2">
                  Features {dataset.toUpperCase()} extraídos del tráfico real
                </div>
                <RateBar label="serror_rate"  value={summary?.serror_rate}                              color="#f85149" />
                <RateBar label="rerror_rate"  value={summary?.rerror_rate}                              color="#d29922" />
                <RateBar label="packet_loss"  value={(summary?.packet_loss_pct ?? 0) / 100}             color="#a371f7" />
                <RateBar label="attack_rate"  value={(summary?.attacks_detected??0)/(summary?.total_probes??1)} color="#ff7b72" />
              </div>

              <div className="shrink-0 rounded p-3 border flex items-center gap-4"
                style={{ background: `${THREAT_COLOR[level]}0e`, borderColor: `${THREAT_COLOR[level]}35` }}>
                {level === "LOW"
                  ? <Shield size={28} style={{ color: THREAT_COLOR[level] }} />
                  : <ShieldAlert size={28} style={{ color: THREAT_COLOR[level] }} />}
                <div>
                  <div className="text-[9px] text-white/30 font-mono">NIVEL DE AMENAZA · {result.model_used?.toUpperCase()} · {result.dataset?.toUpperCase()}</div>
                  <div className="text-lg font-bold font-mono" style={{ color: THREAT_COLOR[level] }}>{THREAT_LABEL[level]}</div>
                  <div className="text-[10px] text-white/35 mt-0.5">
                    {summary?.attacks_detected} de {summary?.total_probes} sondeos = Attack
                    {summary?.final_confidence ? ` · confianza ${(summary.final_confidence*100).toFixed(1)}%` : ""}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-[9px] text-white/25 font-mono">OBJETIVO</div>
                  <div className="text-sm font-mono text-white/60">{result.host}</div>
                  <div className="text-[10px] text-white/25">:{result.port}</div>
                </div>
              </div>

              <div className="flex-1 overflow-auto rounded border border-white/5 bg-black/20">
                <div className="flex gap-3 text-[9px] font-mono text-white/20 uppercase px-3 py-1.5 border-b border-white/5 sticky top-0 bg-black/40">
                  <span className="w-4">#</span><span>Status</span><span>Flag</span>
                  <span>TCP</span><span>HTTP</span><span>Bytes</span>
                  <span className="ml-auto">Predicción ML</span><span className="w-4"/>
                </div>
                <div className="px-3">
                  {result.probes.map(p => <ProbeRow key={p.probe} probe={p} />)}
                </div>
              </div>
            </>
          )}

          {!result && !loading && !error && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/20">
              <Wifi size={36} />
              <p className="text-xs font-mono text-center">
                Selecciona dataset ({DATASETS.map(d=>d.label).join(" / ")}), modelo y escanea un objetivo<br/>
                El IDS extrae features reales y clasifica con el modelo entrenado
              </p>
              <div className="text-[10px] font-mono text-white/15 text-center space-y-0.5">
                <div>google.com · cloudflare.com · unmsm.edu.pe</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB: SIMULACIÓN ───────────────────────────────────────────────── */}
      {tab === "simulate" && (
        <>
          <div className="shrink-0 rounded border border-yellow-500/20 bg-yellow-500/5 p-3 text-xs text-yellow-400/70 font-mono">
            ⚡ Usa muestras <strong>reales</strong> del test set {dataset.toUpperCase()} para verificar si el modelo detecta ataques correctamente.
            No envía tráfico malicioso — clasifica feature vectors del dataset.
          </div>

          <div className="shrink-0 grid gap-2" style={{ gridTemplateColumns: `repeat(${simModes.length}, 1fr)` }}>
            {simModes.map(m => {
              const Icon = m.icon;
              const sel  = simMode === m.value;
              return (
                <button key={m.value} onClick={() => setSimMode(m.value)}
                  className="rounded p-3 border text-left transition"
                  style={{
                    borderColor: sel ? m.color + "55" : "rgba(255,255,255,0.07)",
                    background:  sel ? m.color + "0e" : "rgba(255,255,255,0.02)",
                  }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={13} style={{ color: sel ? m.color : "#545d68" }} />
                    <span className="text-xs font-semibold" style={{ color: sel ? m.color : "#8b949e" }}>{m.label}</span>
                  </div>
                  <p className="text-[10px] text-white/30 leading-relaxed">{m.desc}</p>
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 shrink-0 flex-wrap">
            <div className="relative flex-1 min-w-48">
              <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
              <input value={simTarget} onChange={e => setSimTarget(e.target.value)}
                onKeyDown={e => e.key === "Enter" && runSim()}
                placeholder="Target (solo para baseline) — ej. google.com"
                className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded text-white placeholder-white/20 focus:outline-none text-xs font-mono"
              />
            </div>
            <select value={simModel} onChange={e => setSimModel(e.target.value)}
              className="bg-white/5 border border-white/10 rounded px-2 text-white/70 text-xs">
              {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select value={simIntensity} onChange={e => setSimIntensity(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded px-2 text-white/70 text-xs">
              {[3,5,8,10,15].map(n => <option key={n} value={n}>{n} muestras</option>)}
            </select>
            <button onClick={runSim} disabled={simLoading || !simTarget.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold transition disabled:opacity-40"
              style={{ background: "#d2992215", border: "1px solid #d2992235", color: "#d29922" }}>
              {simLoading ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              {simLoading ? "Simulando…" : "Simular ataque"}
            </button>
          </div>

          {simError && (
            <div className="bg-red-500/10 border border-red-500/25 rounded p-3 text-red-400 text-xs font-mono shrink-0">✗ {simError}</div>
          )}

          {simLoading && (
            <div className="flex-1 flex items-center justify-center text-white/25 gap-3">
              <Loader2 size={20} className="animate-spin" />
              <span className="font-mono text-xs">Cargando muestras {dataset.toUpperCase()} y clasificando…</span>
            </div>
          )}

          {simResult && !simLoading && (
            <>
              <div className={`shrink-0 rounded p-4 border flex items-center gap-4 ${
                simResult.verdict.detected ? "border-red-500/40 bg-red-500/8" : "border-green-500/40 bg-green-500/8"}`}>
                {simResult.verdict.detected
                  ? <ShieldAlert size={28} style={{ color: "#f85149" }} />
                  : <Shield     size={28} style={{ color: "#3fb950" }} />}
                <div>
                  <div className="text-[9px] text-white/30 font-mono">
                    RESULTADO · {simResult.model_used?.toUpperCase()} · {simResult.dataset?.toUpperCase()}
                  </div>
                  <div className="text-lg font-bold font-mono"
                    style={{ color: simResult.verdict.detected ? "#f85149" : "#3fb950" }}>
                    {simResult.verdict.detected ? "⚠ ATAQUE DETECTADO" : "✓ NO DETECTADO"}
                  </div>
                  <div className="text-[10px] text-white/35 mt-0.5">
                    {simResult.target} · {simResult.mode.toUpperCase()} · confianza {simResult.verdict.confidence ? `${(simResult.verdict.confidence*100).toFixed(1)}%` : "—"}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <div className="text-[9px] text-white/25 font-mono uppercase mb-2">Pasos de la simulación</div>
                {simResult.steps.map((s, i) => <SimStepRow key={i} step={s} />)}
              </div>
            </>
          )}

          {!simResult && !simLoading && !simError && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/20">
              <Zap size={36} />
              <p className="text-xs font-mono text-center">
                Selecciona modo de ataque, ingresa un target y presiona Simular<br/>
                Se usan muestras reales del test set {dataset.toUpperCase()}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
