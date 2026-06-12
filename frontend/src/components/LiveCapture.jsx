import { useState, useEffect, useRef } from "react";
import {
  Wifi, WifiOff, Play, Square, RefreshCw, Shield,
  ShieldAlert, Activity, AlertTriangle, Info,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const MODEL_OPTS = [
  { value: "random_forest", label: "Random Forest" },
  { value: "xgboost",       label: "XGBoost" },
  { value: "svm",           label: "SVM" },
  { value: "mlp",           label: "MLP" },
];

// ── Single connection row ─────────────────────────────────────────────────────
function ConnRow({ conn, idx }) {
  const isAtk = conn.prediction === "Attack";
  const ts    = new Date(conn.ts * 1000).toLocaleTimeString();
  return (
    <tr className="border-b transition-colors"
      style={{ borderColor: "#0d1117",
               background: isAtk ? "rgba(248,81,73,0.04)" : "transparent" }}>
      <td className="py-1.5 px-2 font-mono text-[9px]" style={{ color: "#545d68" }}>{ts}</td>
      <td className="py-1.5 px-2 font-mono text-[10px]" style={{ color: "#8b949e" }}>{conn.src}</td>
      <td className="py-1.5 px-2 font-mono text-[10px]" style={{ color: "#cdd9e5" }}>{conn.dst}</td>
      <td className="py-1.5 px-2 text-[9px] uppercase" style={{ color: "#58a6ff" }}>{conn.protocol}</td>
      <td className="py-1.5 px-2 text-[9px]" style={{ color: "#a371f7" }}>{conn.service}</td>
      <td className="py-1.5 px-2 text-[9px]" style={{ color: "#545d68" }}>{conn.flag}</td>
      <td className="py-1.5 px-2 font-mono text-[9px]" style={{ color: "#545d68" }}>
        {conn.src_bytes > 0 ? `↑${(conn.src_bytes/1024).toFixed(1)}K` : "—"}
        {conn.dst_bytes > 0 ? ` ↓${(conn.dst_bytes/1024).toFixed(1)}K` : ""}
      </td>
      <td className="py-1.5 px-2 text-[9px]" style={{ color: "#545d68" }}>
        {conn.duration ? `${conn.duration.toFixed(2)}s` : "—"}
      </td>
      <td className="py-1.5 px-2">
        <span className="px-2 py-0.5 rounded text-[9px] font-bold"
          style={{
            background: isAtk ? "rgba(248,81,73,0.12)" : "rgba(63,185,80,0.10)",
            color:      isAtk ? "#f85149" : "#3fb950",
            border:     `1px solid ${isAtk ? "#f8514922" : "#3fb95022"}`,
          }}>
          {isAtk ? "⚠ ATAQUE" : "✓ NORMAL"}
          {conn.confidence != null && (
            <span className="ml-1 opacity-60">{(conn.confidence * 100).toFixed(0)}%</span>
          )}
        </span>
      </td>
    </tr>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
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
export default function LiveCapture({ dataset = "nslkdd" }) {
  const [scapyOk,    setScapyOk]    = useState(null);   // null=loading
  const [interfaces, setInterfaces] = useState([]);  // [{id, label}]
  const [iface,      setIface]      = useState("");
  const [model,      setModel]      = useState("random_forest");
  const [running,    setRunning]    = useState(false);
  const [conns,      setConns]      = useState([]);
  const [stats,      setStats]      = useState({ total: 0, attacks: 0, normal: 0 });
  const [error,      setError]      = useState(null);
  const pollRef = useRef(null);

  // Check Scapy + load interfaces
  useEffect(() => {
    fetch(`${API}/capture/available`)
      .then(r => r.json())
      .then(d => {
        setScapyOk(d.scapy_available);
        if (d.scapy_available) {
          return fetch(`${API}/capture/interfaces`)
            .then(r => r.json())
            .then(d => {
              const ifaces = d.interfaces || [];
              setInterfaces(ifaces);
              if (ifaces.length) setIface(ifaces[0].id ?? ifaces[0]);
            });
        }
      })
      .catch(() => setScapyOk(false));

    // Recover state if already running
    fetch(`${API}/capture/status`)
      .then(r => r.json())
      .then(d => { if (d.running) setRunning(true); setStats(d.stats); })
      .catch(() => {});
  }, []);

  // Polling while running
  useEffect(() => {
    if (running) {
      pollRef.current = setInterval(() => {
        fetch(`${API}/capture/results?limit=100`)
          .then(r => r.json())
          .then(d => {
            setConns(d.connections || []);
            setStats(d.stats || {});
          })
          .catch(() => {});
      }, 1500);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [running]);

  const handleStart = async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/capture/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iface, dataset, model_name: model }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.detail || "Error al iniciar captura");
        return;
      }
      setRunning(true);
      setConns([]);
      setStats({ total: 0, attacks: 0, normal: 0 });
    } catch (e) {
      setError("No se pudo conectar al backend");
    }
  };

  const handleStop = async () => {
    await fetch(`${API}/capture/stop`, { method: "POST" }).catch(() => {});
    setRunning(false);
  };

  const attackRate = stats.total > 0
    ? ((stats.attacks / stats.total) * 100).toFixed(1)
    : "0.0";

  // ── Scapy not available ───────────────────────────────────────────────────
  if (scapyOk === false) {
    return (
      <div className="rounded-xl p-6" style={{ background: "#050d14", border: "1px solid #d2992233" }}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={16} style={{ color: "#d29922" }}/>
          <p className="text-[13px] font-bold" style={{ color: "#d29922" }}>
            Scapy no disponible
          </p>
        </div>
        <p className="text-[11px] mb-4" style={{ color: "#8b949e" }}>
          Para captura real de paquetes necesitas instalar Scapy y Npcap (Windows):
        </p>
        <div className="rounded-lg p-3 font-mono text-[11px] mb-3"
          style={{ background: "#0a1019", border: "1px solid #1c2333", color: "#3fb950" }}>
          # 1. Instala Npcap desde https://npcap.com/#download<br/>
          # 2. Instala Scapy:<br/>
          pip install scapy
        </div>
        <div className="rounded-lg p-3 text-[10px]"
          style={{ background: "rgba(88,166,255,0.05)", border: "1px solid #58a6ff22", color: "#8b949e" }}>
          <Info size={10} className="inline mr-1" style={{ color: "#58a6ff" }}/>
          Nota: la captura de paquetes requiere ejecutar el backend como <strong style={{ color: "#cdd9e5" }}>Administrador</strong> en Windows.
        </div>
      </div>
    );
  }

  if (scapyOk === null) {
    return (
      <div className="flex items-center justify-center py-12" style={{ color: "#545d68" }}>
        <RefreshCw size={14} className="mr-2" style={{ animation: "spin 1s linear infinite" }}/>
        Verificando Scapy…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Config bar ── */}
      <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
        <p className="text-[10px] uppercase tracking-widest mb-3" style={{ color: "#545d68" }}>
          Configuración de Captura
        </p>
        <div className="flex gap-3 items-end flex-wrap">

          {/* Interface selector */}
          <div className="flex-1 min-w-40">
            <label className="block text-[9px] uppercase tracking-wider mb-1" style={{ color: "#545d68" }}>
              Interfaz de Red
            </label>
            <select value={iface} onChange={e => setIface(e.target.value)}
              disabled={running}
              className="w-full px-2 py-1.5 rounded-lg text-[11px]"
              style={{ background: "#0a1019", border: "1px solid #1c2333",
                       color: "#cdd9e5", outline: "none" }}>
              {interfaces.length === 0 && <option value="">Sin interfaces</option>}
              {interfaces.map(i => {
                const id    = i.id    ?? i;
                const label = i.label ?? i;
                return <option key={id} value={id}>{label}</option>;
              })}
            </select>
          </div>

          {/* Model selector */}
          <div className="flex-1 min-w-36">
            <label className="block text-[9px] uppercase tracking-wider mb-1" style={{ color: "#545d68" }}>
              Modelo ML
            </label>
            <select value={model} onChange={e => setModel(e.target.value)}
              disabled={running}
              className="w-full px-2 py-1.5 rounded-lg text-[11px]"
              style={{ background: "#0a1019", border: "1px solid #1c2333",
                       color: "#cdd9e5", outline: "none" }}>
              {MODEL_OPTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {/* Dataset badge */}
          <div className="text-[10px] px-3 py-1.5 rounded-lg"
            style={{ background: "rgba(88,166,255,0.08)", border: "1px solid #58a6ff22", color: "#58a6ff" }}>
            {dataset === "nslkdd" ? "NSL-KDD" : "CICIDS2017"}
          </div>

          {/* Start / Stop */}
          {!running ? (
            <button onClick={handleStart}
              disabled={!iface}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold transition"
              style={{ background: iface ? "rgba(63,185,80,0.12)" : "rgba(63,185,80,0.03)",
                       border: `1px solid ${iface ? "#3fb95044" : "#3fb95011"}`,
                       color: iface ? "#3fb950" : "#3a5040",
                       cursor: iface ? "pointer" : "not-allowed" }}>
              <Play size={12}/> Iniciar Captura
            </button>
          ) : (
            <button onClick={handleStop}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-semibold transition"
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

        {/* Admin warning */}
        <p className="mt-2 text-[9px]" style={{ color: "#3a4455" }}>
          <Info size={9} className="inline mr-1"/>
          Requiere ejecutar el backend como Administrador en Windows para capturar paquetes.
        </p>
      </div>

      {/* ── Stats row ── */}
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
            style={{ background: "#3fb950", boxShadow: "0 0 6px #3fb950",
                     animation: "flicker 1.5s infinite" }}/>
          <span className="text-[10px] font-semibold" style={{ color: "#3fb950" }}>
            Capturando en tiempo real — interfaz: <strong>{iface}</strong>
          </span>
          <span className="ml-auto text-[9px]" style={{ color: "#545d68" }}>
            actualización cada 1.5s
          </span>
        </div>
      )}

      {/* ── Connections table ── */}
      {conns.length > 0 ? (
        <div className="rounded-xl overflow-hidden"
          style={{ background: "#050d14", border: "1px solid #1c2333" }}>
          <div className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: "1px solid #1c2333" }}>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: "#545d68" }}>
              Conexiones clasificadas (últimas {conns.length})
            </p>
            {stats.attacks > 0 && (
              <span className="flex items-center gap-1 text-[9px] font-bold"
                style={{ color: "#f85149" }}>
                <ShieldAlert size={10}/> {stats.attacks} ataques detectados
              </span>
            )}
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: "420px", overflowY: "auto" }}>
            <table className="w-full text-left">
              <thead>
                <tr style={{ borderBottom: "1px solid #1c2333" }}>
                  {["Hora","Origen","Destino","Proto","Servicio","Flag","Bytes","Duración","Clasificación"].map(h => (
                    <th key={h} className="px-2 py-2 text-[9px] uppercase tracking-wider font-semibold"
                      style={{ color: "#545d68", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conns.map((c, i) => <ConnRow key={i} conn={c} idx={i}/>)}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="rounded-xl p-8 text-center"
          style={{ background: "#050d14", border: "1px dashed #1c2333" }}>
          {running ? (
            <div>
              <Activity size={20} className="mx-auto mb-2"
                style={{ color: "#545d68", animation: "spin 2s linear infinite" }}/>
              <p className="text-[11px]" style={{ color: "#545d68" }}>
                Esperando tráfico de red…
              </p>
              <p className="text-[9px] mt-1" style={{ color: "#3a4455" }}>
                Genera tráfico navegando en el navegador o ejecutando ping
              </p>
            </div>
          ) : (
            <div>
              <Wifi size={20} className="mx-auto mb-2" style={{ color: "#3a4455" }}/>
              <p className="text-[11px]" style={{ color: "#545d68" }}>
                Selecciona una interfaz y presiona "Iniciar Captura"
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── How it works ── */}
      <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
        <p className="text-[10px] font-bold mb-2" style={{ color: "#58a6ff" }}>
          ¿Cómo funciona?
        </p>
        <div className="grid grid-cols-4 gap-3 text-[9px]" style={{ color: "#545d68" }}>
          {[
            ["1. Captura", "Scapy captura paquetes IP/TCP/UDP/ICMP de la interfaz seleccionada"],
            ["2. Extracción", "Agrupa paquetes en conexiones y extrae las 41 features de NSL-KDD"],
            ["3. Clasificación", "El modelo ML entrenado clasifica cada conexión como Normal o Ataque"],
            ["4. Display", "Los resultados aparecen en tiempo real con confianza y estadísticas"],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg p-2"
              style={{ background: "#0a1019", border: "1px solid #1c2333" }}>
              <p className="font-bold mb-1" style={{ color: "#cdd9e5" }}>{title}</p>
              <p>{desc}</p>
            </div>
          ))}
        </div>
        <p className="text-[9px] mt-2" style={{ color: "#3a4455" }}>
          Nota: las features de contenido (logged_in, num_shells, etc.) se fijan a 0 — requieren inspección profunda de paquetes (DPI) de capa de aplicación.
        </p>
      </div>
    </div>
  );
}
