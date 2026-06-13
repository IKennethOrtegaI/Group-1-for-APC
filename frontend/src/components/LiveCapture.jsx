import { useState, useEffect, useRef } from "react";
import {
  Wifi, Play, Square, RefreshCw, Shield,
  ShieldAlert, Activity, AlertTriangle, Info, Trophy,
  ChevronDown, ChevronRight, Globe,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const MODEL_LABELS = {
  random_forest: "Random Forest",
  xgboost:       "XGBoost",
  svm:           "SVM",
  mlp:           "MLP (Red Neuronal)",
};

// Color por tipo de ataque
const ATTACK_TYPE_COLORS = {
  "DoS/DDoS":    { bg: "rgba(248,81,73,0.18)",  border: "#f85149", text: "#ff6b6b" },
  "DDoS":        { bg: "rgba(248,81,73,0.18)",  border: "#f85149", text: "#ff6b6b" },
  "SYN Flood":   { bg: "rgba(255,100,0,0.15)",  border: "#ff6400", text: "#ff8c42" },
  "Flood":       { bg: "rgba(255,100,0,0.15)",  border: "#ff6400", text: "#ff8c42" },
  "Port Scan":   { bg: "rgba(163,113,247,0.15)",border: "#a371f7", text: "#bf94ff" },
  "UDP Scan":    { bg: "rgba(163,113,247,0.15)",border: "#a371f7", text: "#bf94ff" },
  "ICMP Scan":   { bg: "rgba(163,113,247,0.15)",border: "#a371f7", text: "#bf94ff" },
  "Brute Force": { bg: "rgba(210,153,34,0.15)", border: "#d29922", text: "#e3b341" },
  "Web Attack":  { bg: "rgba(88,166,255,0.15)", border: "#58a6ff", text: "#79c0ff" },
  "DNS Abuse":   { bg: "rgba(88,166,255,0.12)", border: "#58a6ff", text: "#79c0ff" },
  "Exfiltración":{ bg: "rgba(248,81,73,0.12)",  border: "#f85149", text: "#ff6b6b" },
  "Anomalía":    { bg: "rgba(248,81,73,0.08)",  border: "#f8514966", text: "#f85149" },
};

async function fetchBestModel(dataset) {
  try {
    const res  = await fetch(`${API}/models/compare/${dataset}`);
    const data = await res.json();
    const models = data.comparison || [];
    if (!models.length) return null;
    const best = models.sort((a, b) =>
      (b.roc_auc ?? 0) - (a.roc_auc ?? 0) ||
      (b.f1_binary ?? b.f1_score ?? 0) - (a.f1_binary ?? a.f1_score ?? 0)
    )[0];
    return { name: best.model_name, roc_auc: best.roc_auc, f1: best.f1_binary ?? best.f1_score, acc: best.accuracy };
  } catch { return null; }
}

// ── Fila expandible ───────────────────────────────────────────────────────────
function ConnRow({ conn }) {
  const [open, setOpen] = useState(false);
  const isAtk   = conn.prediction === "Attack";
  const ts      = new Date(conn.ts * 1000).toLocaleTimeString();
  const atkClr  = isAtk ? (ATTACK_TYPE_COLORS[conn.attack_type] ?? ATTACK_TYPE_COLORS["Anomalía"]) : null;

  return (
    <>
      <tr
        className="border-b transition-colors cursor-pointer select-none"
        style={{ borderColor: "#0d1117", background: isAtk ? "rgba(248,81,73,0.04)" : "transparent" }}
        onClick={() => setOpen(o => !o)}
      >
        {/* Chevron */}
        <td className="py-1.5 pl-2 pr-0 w-4">
          {open
            ? <ChevronDown  size={10} style={{ color: "#545d68" }}/>
            : <ChevronRight size={10} style={{ color: "#3a4455" }}/>
          }
        </td>
        <td className="py-1.5 px-2 font-mono text-[9px]"  style={{ color: "#545d68" }}>{ts}</td>
        <td className="py-1.5 px-2 font-mono text-[10px]" style={{ color: "#8b949e" }}>{conn.src}</td>
        <td className="py-1.5 px-2 font-mono text-[10px]" style={{ color: "#cdd9e5" }}>{conn.dst}</td>
        <td className="py-1.5 px-2 text-[9px] uppercase"  style={{ color: "#58a6ff" }}>{conn.protocol}</td>
        <td className="py-1.5 px-2 text-[9px] max-w-[180px]" style={{ color: "#8b949e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          title={conn.traffic_desc || conn.service}>
          {conn.traffic_desc || conn.service || "—"}
        </td>
        <td className="py-1.5 px-2 text-[9px]"            style={{ color: "#545d68" }}>{conn.flag}</td>
        <td className="py-1.5 px-2 font-mono text-[9px]"  style={{ color: "#545d68" }}>
          {conn.src_bytes > 0 ? `↑${(conn.src_bytes/1024).toFixed(1)}K` : "—"}
          {conn.dst_bytes > 0 ? ` ↓${(conn.dst_bytes/1024).toFixed(1)}K` : ""}
        </td>
        <td className="py-1.5 px-2 text-[9px]" style={{ color: "#545d68" }}>
          {conn.duration ? `${conn.duration.toFixed(2)}s` : "—"}
        </td>
        <td className="py-1.5 px-2">
          {isAtk ? (
            <div className="flex flex-col gap-0.5">
              <span className="px-2 py-0.5 rounded text-[9px] font-bold inline-flex items-center gap-1"
                style={{ background: "rgba(248,81,73,0.12)", color: "#f85149", border: "1px solid #f8514922" }}>
                ⚠ ATAQUE {conn.confidence != null && <span className="opacity-60">{(conn.confidence*100).toFixed(0)}%</span>}
              </span>
              {conn.attack_type && (
                <span className="px-1.5 py-0.5 rounded text-[8px] font-bold"
                  style={{
                    background: atkClr?.bg,
                    color:      atkClr?.text,
                    border:     `1px solid ${atkClr?.border}44`,
                  }}>
                  {conn.attack_type}
                </span>
              )}
            </div>
          ) : (
            <span className="px-2 py-0.5 rounded text-[9px] font-bold"
              style={{ background: "rgba(63,185,80,0.10)", color: "#3fb950", border: "1px solid #3fb95022" }}>
              ✓ NORMAL {conn.confidence != null && <span className="opacity-60">{(conn.confidence*100).toFixed(0)}%</span>}
            </span>
          )}
        </td>
      </tr>

      {/* Detalle expandido */}
      {open && (
        <tr style={{ background: isAtk ? "rgba(248,81,73,0.06)" : "rgba(88,166,255,0.03)" }}>
          <td colSpan={10} className="px-6 py-3">
            <div className="flex flex-wrap gap-4 text-[10px]">

              {/* Descripción tráfico */}
              {conn.traffic_desc && (
                <div className="flex items-start gap-2 flex-1 min-w-48">
                  <Globe size={11} style={{ color: "#58a6ff", marginTop: 1, flexShrink: 0 }}/>
                  <div>
                    <p className="text-[8px] uppercase tracking-wider mb-0.5" style={{ color: "#3a4455" }}>Descripción del tráfico</p>
                    <p style={{ color: "#cdd9e5" }}>{conn.traffic_desc}</p>
                  </div>
                </div>
              )}

              {/* Tipo de ataque detallado */}
              {isAtk && conn.attack_type && (
                <div className="flex items-start gap-2 flex-1 min-w-48">
                  <ShieldAlert size={11} style={{ color: atkClr?.text, marginTop: 1, flexShrink: 0 }}/>
                  <div>
                    <p className="text-[8px] uppercase tracking-wider mb-0.5" style={{ color: "#3a4455" }}>Tipo de ataque</p>
                    <p className="font-bold" style={{ color: atkClr?.text }}>{conn.attack_type}</p>
                    <p className="text-[9px] mt-0.5" style={{ color: "#545d68" }}>
                      {ATTACK_DESCRIPTIONS[conn.attack_type] ?? "Comportamiento anómalo detectado."}
                    </p>
                  </div>
                </div>
              )}

              {/* Métricas del flujo */}
              <div className="flex gap-3 flex-wrap">
                {[
                  ["Confianza", conn.confidence != null ? `${(conn.confidence*100).toFixed(1)}%` : "—", isAtk ? "#f85149" : "#3fb950"],
                  ["Duración",  conn.duration ? `${conn.duration.toFixed(3)}s` : "—", "#8b949e"],
                  ["↑ Enviados", conn.src_bytes > 0 ? fmtBytes(conn.src_bytes) : "—", "#58a6ff"],
                  ["↓ Recibidos",conn.dst_bytes > 0 ? fmtBytes(conn.dst_bytes) : "—", "#a371f7"],
                  ["Flag TCP",  conn.flag, "#d29922"],
                ].map(([label, val, color]) => (
                  <div key={label} className="text-center rounded-lg px-3 py-1.5"
                    style={{ background: "#0a1019", border: "1px solid #1c2333" }}>
                    <p className="text-[7px] uppercase tracking-wider mb-0.5" style={{ color: "#3a4455" }}>{label}</p>
                    <p className="font-mono text-[11px] font-bold" style={{ color }}>{val}</p>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function fmtBytes(n) {
  if (n >= 1_048_576) return `${(n/1_048_576).toFixed(1)} MB`;
  if (n >= 1024)      return `${(n/1024).toFixed(0)} KB`;
  return `${n} B`;
}

const ATTACK_DESCRIPTIONS = {
  "DoS/DDoS":     "Alto volumen de paquetes hacia el destino con poca o ninguna respuesta. Puede saturar la red o el servicio.",
  "DDoS":         "Tráfico distribuido de alta densidad. Múltiples fuentes enviando paquetes simultáneamente.",
  "SYN Flood":    "Muchos paquetes SYN sin completar el handshake TCP. Agota las conexiones semiabiertas del servidor.",
  "Flood":        "Inundación de paquetes de alta frecuencia. El destino recibe más tráfico del que puede procesar.",
  "Port Scan":    "Conexiones cortas a múltiples puertos sin intercambio de datos. Técnica de reconocimiento de servicios activos.",
  "UDP Scan":     "Envío de datagramas UDP sin respuesta. Identifica puertos UDP abiertos o servicios UDP expuestos.",
  "ICMP Scan":    "Ping sweep o ICMP flood para mapear hosts activos en la red.",
  "Brute Force":  "Intentos repetidos y rápidos de autenticación en un servicio (SSH, RDP, FTP). Busca credenciales válidas.",
  "Web Attack":   "Tráfico HTTP/S con carga anormalmente grande del cliente. Puede indicar inyección SQL, XSS o directory traversal.",
  "DNS Abuse":    "Consultas DNS con payload excesivo. Posible amplificación DNS o exfiltración de datos vía DNS.",
  "Exfiltración": "Gran volumen de datos salientes hacia un destino inusual. Posible robo de información.",
  "Anomalía":     "Comportamiento estadísticamente anómalo que no encaja en patrones de tráfico normal.",
};

// ── Tabla con barra de scroll y botón "ir arriba" ────────────────────────────
function TableWithScrollbar({ conns }) {
  const scrollRef = useRef(null);
  const [showTop, setShowTop] = useState(false);

  const onScroll = () => {
    setShowTop((scrollRef.current?.scrollTop ?? 0) > 120);
  };

  const scrollTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="overflow-x-auto"
        style={{ maxHeight: "480px", overflowY: "scroll" }}
      >
        <table className="w-full text-left">
          <thead style={{ position: "sticky", top: 0, zIndex: 2, background: "#050d14" }}>
            <tr style={{ borderBottom: "1px solid #1c2333" }}>
              <th className="px-2 py-2 w-4"/>
              {["Hora","Origen","Destino","Proto","Actividad","Flag","Bytes","Duración","Clasificación"].map(h => (
                <th key={h} className="px-2 py-2 text-[9px] uppercase tracking-wider font-semibold"
                  style={{ color: "#545d68", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {conns.map((c, i) => <ConnRow key={i} conn={c}/>)}
          </tbody>
        </table>
      </div>

      {/* Botón flotante "ir arriba" */}
      {showTop && (
        <button
          onClick={scrollTop}
          className="absolute right-3 bottom-3 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all"
          style={{
            background: "rgba(88,166,255,0.15)",
            border: "1px solid rgba(88,166,255,0.35)",
            color: "#58a6ff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            zIndex: 10,
          }}
        >
          ↑ Ir arriba
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div className="rounded-xl p-3 text-center flex-1"
      style={{ background: "#050d14", border: "1px solid #1c2333" }}>
      <p className="text-[8px] uppercase tracking-wider mb-1" style={{ color: "#545d68" }}>{label}</p>
      <p className="text-[18px] font-bold font-mono" style={{ color }}>{value}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LiveCapture({ dataset = "cicids" }) {
  const [scapyOk,    setScapyOk]    = useState(null);
  const [interfaces, setInterfaces] = useState([]);
  const [iface,      setIface]      = useState("");
  const [bestModel,  setBestModel]  = useState(null);
  const [loadingBest,setLoadingBest]= useState(true);
  const [running,    setRunning]    = useState(false);
  const [conns,      setConns]      = useState([]);
  const [stats,      setStats]      = useState({ total: 0, attacks: 0, normal: 0 });
  const [error,      setError]      = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    setLoadingBest(true);
    setBestModel(null);
    fetchBestModel(dataset).then(best => { setBestModel(best); setLoadingBest(false); });
  }, [dataset]);

  useEffect(() => {
    fetch(`${API}/capture/available`)
      .then(r => r.json())
      .then(d => {
        setScapyOk(d.scapy_available);
        if (d.scapy_available) {
          fetch(`${API}/capture/interfaces`).then(r => r.json()).then(d => {
            const ifaces = d.interfaces || [];
            setInterfaces(ifaces);
            if (ifaces.length) setIface(ifaces[0].id ?? ifaces[0]);
          });
        }
      })
      .catch(() => setScapyOk(false));

    fetch(`${API}/capture/status`)
      .then(r => r.json())
      .then(d => { if (d.running) setRunning(true); setStats(d.stats); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (running) {
      pollRef.current = setInterval(() => {
        fetch(`${API}/capture/results?limit=100`)
          .then(r => r.json())
          .then(d => { setConns(d.connections || []); setStats(d.stats || {}); })
          .catch(() => {});
      }, 1500);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [running]);

  const handleStart = async () => {
    if (!bestModel) return;
    setError(null);
    try {
      const res = await fetch(`${API}/capture/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iface, dataset, model_name: bestModel.name }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.detail || "Error al iniciar"); return; }
      setRunning(true); setConns([]); setStats({ total: 0, attacks: 0, normal: 0 });
    } catch { setError("No se pudo conectar al backend"); }
  };

  const handleStop = async () => {
    await fetch(`${API}/capture/stop`, { method: "POST" }).catch(() => {});
    setRunning(false);
  };

  const attackRate = stats.total > 0 ? ((stats.attacks / stats.total) * 100).toFixed(1) : "0.0";

  if (scapyOk === false) {
    return (
      <div className="rounded-xl p-6" style={{ background: "#050d14", border: "1px solid #d2992233" }}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} style={{ color: "#d29922" }}/>
          <p className="text-[13px] font-bold" style={{ color: "#d29922" }}>Scapy no disponible</p>
        </div>
        <p className="text-[11px] mb-4" style={{ color: "#8b949e" }}>
          Para captura real de paquetes instala Scapy y Npcap (Windows):
        </p>
        <div className="rounded-lg p-3 font-mono text-[11px] mb-3"
          style={{ background: "#0a1019", border: "1px solid #1c2333", color: "#3fb950" }}>
          # 1. Instala Npcap desde https://npcap.com/#download<br/>
          # 2. pip install scapy
        </div>
      </div>
    );
  }

  if (scapyOk === null) {
    return (
      <div className="flex items-center justify-center py-12" style={{ color: "#545d68" }}>
        <RefreshCw size={14} className="mr-2 animate-spin"/> Verificando Scapy…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Mejor modelo ── */}
      <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
        <div className="flex items-center gap-2 mb-3">
          <Trophy size={13} style={{ color: "#d29922" }}/>
          <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#d29922" }}>
            Modelo seleccionado automáticamente
          </p>
          <span className="ml-auto text-[9px]" style={{ color: "#3a4455" }}>basado en ROC-AUC</span>
        </div>
        {loadingBest ? (
          <div className="flex items-center gap-2 text-[11px]" style={{ color: "#545d68" }}>
            <RefreshCw size={12} className="animate-spin"/> Consultando métricas…
          </div>
        ) : bestModel ? (
          <div className="flex items-center gap-4">
            <div className="flex-1 rounded-lg p-3"
              style={{ background: "rgba(210,153,34,0.06)", border: "1px solid rgba(210,153,34,0.2)" }}>
              <div className="text-[18px] font-bold font-mono" style={{ color: "#d29922" }}>
                {MODEL_LABELS[bestModel.name] ?? bestModel.name}
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: "#545d68" }}>
                Dataset: <span style={{ color: "#58a6ff" }}>{dataset === "nslkdd" ? "NSL-KDD · 41 features" : "CICIDS2017 · 78 features"}</span>
              </div>
            </div>
            <div className="flex gap-3">
              {[
                ["ROC-AUC",   bestModel.roc_auc?.toFixed(4) ?? "—",                     "#d29922"],
                ["F1-Binary", bestModel.f1?.toFixed(4) ?? "—",                           "#a371f7"],
                ["Accuracy",  `${((bestModel.acc ?? 0)*100).toFixed(1)}%`,               "#3fb950"],
              ].map(([label, value, color]) => (
                <div key={label} className="text-center rounded-lg px-4 py-2"
                  style={{ background: "#0a1019", border: "1px solid #1c2333" }}>
                  <div className="text-[8px] uppercase tracking-wider mb-1" style={{ color: "#545d68" }}>{label}</div>
                  <div className="text-[15px] font-bold font-mono" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-[11px] px-3 py-2 rounded-lg"
            style={{ background: "rgba(248,81,73,0.07)", border: "1px solid #f8514922", color: "#f85149" }}>
            No hay modelos entrenados para {dataset === "nslkdd" ? "NSL-KDD" : "CICIDS2017"}. Ve a Entrenar primero.
          </div>
        )}
      </div>

      {/* ── Config ── */}
      <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
        <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "#545d68" }}>Interfaz de Red</p>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-40">
            <select value={iface} onChange={e => setIface(e.target.value)} disabled={running}
              className="w-full px-2 py-1.5 rounded-lg text-[11px]"
              style={{ background: "#0a1019", border: "1px solid #1c2333", color: "#cdd9e5", outline: "none" }}>
              {interfaces.length === 0 && <option value="">Sin interfaces</option>}
              {interfaces.map(i => { const id = i.id ?? i; return <option key={id} value={id}>{i.label ?? i}</option>; })}
            </select>
          </div>
          {!running ? (
            <button onClick={handleStart} disabled={!iface || !bestModel || loadingBest}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold transition"
              style={{
                background: (iface && bestModel) ? "rgba(63,185,80,0.12)" : "rgba(63,185,80,0.03)",
                border: `1px solid ${(iface && bestModel) ? "#3fb95044" : "#3fb95011"}`,
                color: (iface && bestModel) ? "#3fb950" : "#3a5040",
                cursor: (iface && bestModel) ? "pointer" : "not-allowed",
              }}>
              <Play size={12}/> Iniciar Captura
            </button>
          ) : (
            <button onClick={handleStop}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold"
              style={{ background: "rgba(248,81,73,0.1)", border: "1px solid #f8514933", color: "#f85149" }}>
              <Square size={12}/> Detener
            </button>
          )}
        </div>
        {error && (
          <p className="mt-2 text-[10px] px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(248,81,73,0.07)", border: "1px solid #f8514922", color: "#f85149" }}>
            ⚠ {error}
          </p>
        )}
        <p className="mt-2 text-[9px]" style={{ color: "#3a4455" }}>
          <Info size={9} className="inline mr-1"/>
          Requiere ejecutar el backend como Administrador en Windows.
        </p>
      </div>

      {/* ── Stats ── */}
      <div className="flex gap-2">
        <Stat label="Total capturadas" value={stats.total.toLocaleString()} color="#58a6ff"/>
        <Stat label="Normales"         value={stats.normal.toLocaleString()} color="#3fb950"/>
        <Stat label="Ataques"          value={stats.attacks.toLocaleString()} color="#f85149"/>
        <Stat label="Attack Rate"      value={`${attackRate}%`} color="#d29922"/>
      </div>

      {/* ── Live indicator ── */}
      {running && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "rgba(63,185,80,0.06)", border: "1px solid #3fb95022" }}>
          <span className="w-2 h-2 rounded-full"
            style={{ background: "#3fb950", boxShadow: "0 0 6px #3fb950", animation: "flicker 1.5s infinite" }}/>
          <span className="text-[10px] font-semibold" style={{ color: "#3fb950" }}>
            Capturando — <strong>{iface}</strong> · modelo: <strong>{MODEL_LABELS[bestModel?.name]}</strong>
          </span>
          <span className="ml-auto text-[9px]" style={{ color: "#545d68" }}>haz clic en una fila para detalles</span>
        </div>
      )}

      {/* ── Tabla ── */}
      {conns.length > 0 ? (
        <div className="rounded-xl overflow-hidden" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
          <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid #1c2333" }}>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: "#545d68" }}>
              Conexiones clasificadas (últimas {conns.length}) — clic para expandir
            </p>
            {stats.attacks > 0 && (
              <span className="flex items-center gap-1 text-[9px] font-bold" style={{ color: "#f85149" }}>
                <ShieldAlert size={10}/> {stats.attacks} ataques detectados
              </span>
            )}
          </div>
          <TableWithScrollbar conns={conns}/>
        </div>
      ) : (
        <div className="rounded-xl p-8 text-center" style={{ background: "#050d14", border: "1px dashed #1c2333" }}>
          {running ? (
            <div>
              <Activity size={20} className="mx-auto mb-2" style={{ color: "#545d68" }}/>
              <p className="text-[11px]" style={{ color: "#545d68" }}>Esperando tráfico…</p>
              <p className="text-[9px] mt-1" style={{ color: "#3a4455" }}>Navega en el navegador o ejecuta ping</p>
            </div>
          ) : (
            <div>
              <Wifi size={20} className="mx-auto mb-2" style={{ color: "#3a4455" }}/>
              <p className="text-[11px]" style={{ color: "#545d68" }}>Selecciona una interfaz y presiona "Iniciar Captura"</p>
            </div>
          )}
        </div>
      )}

      {/* ── Leyenda tipos de ataque ── */}
      {stats.attacks > 0 && (
        <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
          <p className="text-[10px] font-bold mb-3" style={{ color: "#f85149" }}>Tipos de ataque detectados</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(ATTACK_TYPE_COLORS).map(([name, clr]) => (
              <span key={name} className="px-2 py-1 rounded text-[9px] font-semibold"
                style={{ background: clr.bg, color: clr.text, border: `1px solid ${clr.border}44` }}>
                {name}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[9px]" style={{ color: "#3a4455" }}>
            <Info size={9} className="inline mr-1"/>
            Los tipos se infieren por heurística de features del flujo (tasa de paquetes, flags TCP, bytes, puerto, duración).
            Haz clic en cualquier fila para ver la descripción completa.
          </p>
        </div>
      )}

      {/* ── Arquitectura ── */}
      <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
        <p className="text-[10px] font-bold mb-2" style={{ color: "#58a6ff" }}>Arquitectura del IDS</p>
        <div className="grid grid-cols-4 gap-3 text-[9px]" style={{ color: "#545d68" }}>
          {[
            ["1. Captura", "Scapy captura paquetes IP/TCP/UDP/ICMP en modo promiscuo"],
            ["2. Flujos", "Agrupa paquetes en flujos bidireccionales por 5-tupla. Cierra en FIN/RST o timeout 30s"],
            ["3. Features", `Extrae ${dataset === "nslkdd" ? "41 features NSL-KDD" : "features CICIDS2017"} del flujo para alimentar el modelo`],
            ["4. Clasificación", `${MODEL_LABELS[bestModel?.name] ?? "Modelo"} (mejor ROC-AUC) clasifica y determina tipo de ataque por heurística`],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg p-2" style={{ background: "#0a1019", border: "1px solid #1c2333" }}>
              <p className="font-bold mb-1" style={{ color: "#cdd9e5" }}>{title}</p>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
