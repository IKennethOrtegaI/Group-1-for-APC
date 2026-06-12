import { useState, useEffect, useCallback, useRef } from "react";
import {
  Shield, Activity, BarChart2, Terminal as TermIcon,
  Upload, Cpu, X, ChevronRight, Wifi,
} from "lucide-react";
import NetworkMap       from "./components/NetworkMap";
import ThreatRadar      from "./components/ThreatRadar";
import LiveTerminal     from "./components/LiveTerminal";
import TrainPanel       from "./components/TrainPanel";
import PredictSimulator from "./components/PredictSimulator";
import BatchUpload      from "./components/BatchUpload";
import ModelComparison  from "./components/ModelComparison";
import SplashScreen     from "./components/SplashScreen";
import NetworkMonitor   from "./components/NetworkMonitor";
import LiveCapture      from "./components/LiveCapture";
import { getAlertStats } from "./api/client";

// ── Side panels config ──────────────────────────────────────────────────────
const PANELS = [
  { id: "train",       label: "Entrenar",    icon: Cpu,       color: "#58a6ff" },
  { id: "predict",     label: "Predictor",   icon: TermIcon,  color: "#a371f7" },
  { id: "batch",       label: "CSV",         icon: Upload,    color: "#3fb950" },
  { id: "comparativa", label: "Comparativa", icon: BarChart2, color: "#d29922" },
  { id: "monitor",     label: "Monitor",     icon: Wifi,      color: "#ff7b72" },
  { id: "captura",    label: "Captura Live", icon: Activity,  color: "#39d353" },
];

// ── KPI Chip ────────────────────────────────────────────────────────────────
function KpiChip({ label, value, rgb, hex, blink }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
      style={{ background: `rgba(${rgb},0.07)`, border: `1px solid rgba(${rgb},0.18)` }}>
      {blink && <span className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: hex, boxShadow: `0 0 5px ${hex}`, animation: "flicker 2s infinite" }}/>}
      <div>
        <p className="text-[8px] uppercase tracking-widest leading-none" style={{ color: "#545d68" }}>{label}</p>
        <p className="text-[13px] font-bold font-mono leading-tight mt-0.5" style={{ color: hex }}>{value}</p>
      </div>
    </div>
  );
}

// ── Panel title map ─────────────────────────────────────────────────────────
const PANEL_TITLES = {
  train:       "Entrenar Modelo de IA",
  predict:     "Predictor de Tráfico",
  batch:       "Análisis por Lote (CSV)",
  comparativa: "Análisis Comparativo de Modelos",
  monitor:     "Monitor de Red en Tiempo Real",
  captura:     "Captura de Paquetes en Vivo — NSL-KDD Features",
};

// ───────────────────────────────────────────────────────────────────────────
export default function App() {
  const [showSplash,  setShowSplash]  = useState(true);
  const [activePanel, setActivePanel] = useState(null);
  const [dataset,     setDataset]     = useState("nslkdd");
  const [stats,       setStats]       = useState({ total: 0, attacks: 0, normal: 0, attack_rate: 0 });
  const [refreshKey,  setRefreshKey]  = useState(0);
  const [lastAttack,  setLastAttack]  = useState(null);
  const attackRef = useRef(null);
  const refresh   = () => setRefreshKey(k => k + 1);

  useEffect(() => {
    const load = () => getAlertStats().then(r => setStats(r.data)).catch(() => {});
    load();
    const iv = setInterval(load, 6000);
    return () => clearInterval(iv);
  }, [refreshKey]);

  const handleAttack = useCallback((evt) => {
    if (evt !== attackRef.current) { attackRef.current = evt; setLastAttack(evt); }
  }, []);

  const togglePanel = (id) => setActivePanel(p => p === id ? null : id);

  // Dataset toggle inline
  const DatasetToggle = () => (
    <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: "1px solid #1c2333" }}>
      {["nslkdd","cicids"].map(d => (
        <button key={d} onClick={() => setDataset(d)}
          className="px-3 py-1 text-[10px] font-semibold transition"
          style={{
            background: dataset === d ? "rgba(88,166,255,0.12)" : "transparent",
            color: dataset === d ? "#58a6ff" : "#545d68",
            borderRight: d === "nslkdd" ? "1px solid #1c2333" : "none",
          }}>
          {d === "nslkdd" ? "NSL-KDD" : "CICIDS2017"}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      {showSplash && <SplashScreen onEnter={() => setShowSplash(false)}/>}

      {/* ══════════════ HEADER ══════════════════════════════════════════════ */}
      <header className="shrink-0 flex items-center gap-3 px-4 py-2"
        style={{ background: "#070b10", borderBottom: "1px solid #1c2333", zIndex: 30 }}>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-1.5 rounded-lg"
            style={{ background: "rgba(88,166,255,0.1)", border: "1px solid rgba(88,166,255,0.22)" }}>
            <Shield size={14} style={{ color: "#58a6ff" }}/>
          </div>
          <div>
            <h1 className="text-[11px] font-bold tracking-tight leading-none" style={{ color: "#cdd9e5" }}>
              AI · SISTEMA DE DETECCIÓN DE INTRUSOS
            </h1>
            <p className="text-[8px] mt-0.5" style={{ color: "#3a4455" }}>
              NSL-KDD · CICIDS2017 · RF · XGBoost · SVM · MLP
            </p>
          </div>
        </div>

        {/* Separator */}
        <div className="w-px h-6 shrink-0" style={{ background: "#1c2333" }}/>

        {/* Panel action buttons */}
        <nav className="flex items-center gap-1.5">
          {PANELS.map(({ id, label, icon: Icon, color }) => {
            const active = activePanel === id;
            return (
              <button key={id} onClick={() => togglePanel(id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all"
                style={{
                  background: active ? `${color}14` : "transparent",
                  border: `1px solid ${active ? color + "44" : "transparent"}`,
                  color: active ? color : "#545d68",
                }}>
                <Icon size={11}/>
                {label}
                {active && <X size={10} style={{ marginLeft: 2 }}/>}
              </button>
            );
          })}
        </nav>

        {/* KPIs — pushed right */}
        <div className="flex items-center gap-1.5 ml-auto">
          <KpiChip label="Conexiones"   value={stats.total.toLocaleString()}               rgb="88,166,255"  hex="#58a6ff"/>
          <KpiChip label="Ataques"      value={stats.attacks.toLocaleString()}             rgb="248,81,73"   hex="#f85149" blink={stats.attacks > 0}/>
          <KpiChip label="Normal"       value={stats.normal.toLocaleString()}              rgb="63,185,80"   hex="#3fb950"/>
          <KpiChip label="Attack Rate"  value={`${(stats.attack_rate * 100).toFixed(1)}%`} rgb="210,153,34"  hex="#d29922"/>
        </div>

        {/* Online dot */}
        <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg"
          style={{ background: "rgba(63,185,80,0.07)", border: "1px solid rgba(63,185,80,0.18)" }}>
          <span className="w-1.5 h-1.5 rounded-full"
            style={{ background: "#3fb950", boxShadow: "0 0 5px #3fb950", animation: "flicker 3s infinite" }}/>
          <span className="text-[9px] font-semibold" style={{ color: "#3fb950" }}>Online</span>
        </div>
      </header>

      {/* ══════════════ BODY ════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT: Network topology (always visible) ── */}
        <div className="flex-1 relative overflow-hidden" style={{ minWidth: 0 }}>

          {/* Topology fills the whole area */}
          <div className="absolute inset-0 p-3">
            <div className="w-full h-full rounded-xl overflow-hidden"
              style={{ background: "#070d14", border: "1px solid #1c2333" }}>
              <NetworkMap onAttack={handleAttack}/>
            </div>
          </div>

          {/* ── Floating overlay panel ── */}
          {activePanel && (
            <div className="absolute inset-3 rounded-xl overflow-hidden flex flex-col"
              style={{
                background: "rgba(4,7,12,0.96)",
                border: `1px solid ${PANELS.find(p => p.id === activePanel)?.color}33`,
                backdropFilter: "blur(12px)",
                zIndex: 20,
                animation: "fadeSlideUp 0.18s ease",
              }}>

              {/* Panel header */}
              <div className="shrink-0 flex items-center justify-between px-5 py-3"
                style={{ borderBottom: "1px solid #1c2333" }}>
                <div className="flex items-center gap-3">
                  {(() => { const p = PANELS.find(x => x.id === activePanel); const Icon = p?.icon; return Icon ? <Icon size={14} style={{ color: p.color }}/> : null; })()}
                  <span className="text-[12px] font-bold" style={{ color: "#cdd9e5" }}>
                    {PANEL_TITLES[activePanel]}
                  </span>
                  {(activePanel === "train" || activePanel === "predict" || activePanel === "batch" || activePanel === "comparativa") && (
                    <DatasetToggle/>
                  )}
                </div>
                <button onClick={() => setActivePanel(null)}
                  className="p-1.5 rounded-lg transition"
                  style={{ background: "rgba(248,81,73,0.07)", border: "1px solid rgba(248,81,73,0.15)" }}>
                  <X size={13} style={{ color: "#f85149" }}/>
                </button>
              </div>

              {/* Panel body — scrollable */}
              <div className="flex-1 overflow-y-auto p-5">
                {activePanel === "train" && (
                  <div className="max-w-2xl mx-auto">
                    <TrainPanel dataset={dataset} onTrained={refresh}/>
                  </div>
                )}
                {activePanel === "predict" && (
                  <div className="max-w-2xl mx-auto">
                    <PredictSimulator dataset={dataset} onPredicted={refresh}/>
                  </div>
                )}
                {activePanel === "batch" && (
                  <div className="max-w-2xl mx-auto">
                    <BatchUpload dataset={dataset} onDone={refresh}/>
                  </div>
                )}
                {activePanel === "comparativa" && (
                  <div className="max-w-5xl mx-auto">
                    <ModelComparison dataset={dataset} refreshKey={refreshKey}/>
                  </div>
                )}
                {activePanel === "monitor" && (
                  <div className="max-w-4xl mx-auto h-full">
                    <NetworkMonitor />
                  </div>
                )}
                {activePanel === "captura" && (
                  <div className="max-w-5xl mx-auto">
                    <LiveCapture dataset={dataset}/>
                  </div>
                )}
              </div>

              {/* Topology peek strip at bottom */}
              <div className="shrink-0 px-5 py-2 flex items-center gap-2"
                style={{ borderTop: "1px solid #1c2333" }}>
                <Activity size={10} style={{ color: "#545d68" }}/>
                <span className="text-[9px]" style={{ color: "#3a4455" }}>
                  Topología de red activa en background — los eventos siguen siendo monitoreados
                </span>
                <button onClick={() => setActivePanel(null)}
                  className="ml-auto text-[9px] flex items-center gap-1 transition"
                  style={{ color: "#545d68" }}>
                  Ver red <ChevronRight size={9}/>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Radar + Terminal (siempre visible, terminal grande) ── */}
        <div className="w-72 shrink-0 flex flex-col gap-3 p-3 overflow-hidden"
          style={{ borderLeft: "1px solid #1c2333" }}>

          {/* Radar — fijo, pequeño */}
          <div className="shrink-0 rounded-xl p-3"
            style={{ background: "#050d05", border: "1px solid #163516" }}>
            <ThreatRadar newAttack={lastAttack}/>
          </div>

          {/* Terminal — ocupa todo el espacio restante */}
          <div className="flex-1 rounded-xl p-4 overflow-hidden flex flex-col"
            style={{ background: "#04070a", border: "1px solid #1c2333", minHeight: 0 }}>
            <LiveTerminal newAttack={lastAttack}/>
          </div>
        </div>
      </div>
    </div>
  );
}
