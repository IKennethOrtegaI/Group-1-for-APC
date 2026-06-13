/**
 * LiveTerminal — log en tiempo real del IDS.
 * Solo datos reales de /capture/results y /capture/status.
 * Sin simulaciones.
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const LEVEL_COLOR = {
  SYS:    "#58a6ff",
  INFO:   "#3fb950",
  WARN:   "#d29922",
  ALERT:  "#f85149",
  NORMAL: "#3fb950",
};

const ATK_SHORT = {
  "DoS/DDoS":    "DOS",
  "DDoS":        "DDoS",
  "SYN Flood":   "SYN",
  "Flood":       "FLD",
  "Port Scan":   "SCN",
  "UDP Scan":    "UDP",
  "ICMP Scan":   "ICM",
  "Brute Force": "BRF",
  "Web Attack":  "WEB",
  "DNS Abuse":   "DNS",
  "Exfiltración":"EXF",
  "Anomalía":    "ANO",
};

let _idSeq = 1;
function mkLine(level, msg, detail = null) {
  return {
    id:     _idSeq++,
    level,
    msg,
    detail,
    ts: new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
}

function fmtBytes(n) {
  if (!n || n === 0) return "0B";
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)}MB`;
  if (n >= 1024)      return `${(n / 1024).toFixed(0)}KB`;
  return `${n}B`;
}

export default function LiveTerminal() {
  const [lines,   setLines]   = useState([
    mkLine("SYS",  "IDS Engine inicializado"),
    mkLine("SYS",  "Esperando inicio de captura de paquetes..."),
  ]);
  const [filter,  setFilter]  = useState("ALL");   // ALL | ALERT | INFO | SYS
  const [paused,  setPaused]  = useState(false);
  const [running, setRunning] = useState(false);
  const bottomRef  = useRef(null);
  const seenRef    = useRef(new Set());
  const pausedRef  = useRef(false);
  const runningRef = useRef(false);

  pausedRef.current  = paused;
  runningRef.current = running;

  const push = (...newLines) => {
    if (pausedRef.current) return;
    setLines(prev => [...prev.slice(-120), ...newLines]);
  };

  // Polling de captura real
  useEffect(() => {
    let prevRunning = false;

    const poll = async () => {
      try {
        const [statusRes, resultsRes] = await Promise.all([
          fetch(`${API}/capture/status`),
          fetch(`${API}/capture/results?limit=80`),
        ]);
        const status  = await statusRes.json();
        const results = await resultsRes.json();

        const nowRunning = status.running ?? false;
        setRunning(nowRunning);

        // Cambio de estado de captura
        if (nowRunning && !prevRunning) {
          push(
            mkLine("SYS",  "━━━ CAPTURA INICIADA ━━━"),
            mkLine("SYS",  `Interfaz activa · escuchando paquetes en tiempo real`),
            mkLine("INFO", `Flujos activos: 0 · ataques: 0`),
          );
        } else if (!nowRunning && prevRunning) {
          const s = status.stats ?? {};
          push(
            mkLine("SYS", "━━━ CAPTURA DETENIDA ━━━"),
            mkLine("SYS", `Resumen: ${s.total ?? 0} flujos · ${s.attacks ?? 0} ataques · ${s.normal ?? 0} normales`),
          );
        }
        prevRunning = nowRunning;

        // Procesar conexiones nuevas
        const conns = results.connections ?? [];
        const toLog = [];

        for (const conn of conns) {
          const key = `${conn.ts}|${conn.src}|${conn.dst}`;
          if (seenRef.current.has(key)) continue;
          seenRef.current.add(key);

          const proto = (conn.protocol ?? "").toUpperCase();
          const pct   = conn.confidence != null ? `${(conn.confidence * 100).toFixed(0)}%` : "";
          const bytes = `↑${fmtBytes(conn.src_bytes)} ↓${fmtBytes(conn.dst_bytes)}`;
          const dur   = conn.duration ? `${conn.duration.toFixed(2)}s` : "";

          if (conn.prediction === "Attack") {
            const atk   = conn.attack_type ?? "Anomalía";
            const short = ATK_SHORT[atk] ?? atk.slice(0, 3).toUpperCase();
            toLog.push(mkLine(
              "ALERT",
              `[${short}] ${conn.src} → ${conn.dst}`,
              `${proto} · confianza: ${pct} · ${bytes}${dur ? " · " + dur : ""} · ${conn.traffic_desc ?? ""}`,
            ));
          } else {
            // Normales: log cada 3 para no saturar (pero siempre los primeros)
            if (seenRef.current.size <= 5 || seenRef.current.size % 3 === 0) {
              toLog.push(mkLine(
                "NORMAL",
                `[OK] ${conn.src} → ${conn.dst}`,
                `${proto} · ${pct} · ${bytes}${conn.traffic_desc ? " · " + conn.traffic_desc : ""}`,
              ));
            }
          }
        }

        // Ordenar: ataques primero dentro del batch
        toLog.sort((a, b) => (a.level === "ALERT" ? -1 : 1) - (b.level === "ALERT" ? -1 : 1) || 0);

        if (toLog.length > 0) push(...toLog.slice(0, 20));

        // Actualizar stat line periódicamente si captura activa
        if (nowRunning) {
          const s = status.stats ?? {};
          const rate = s.total > 0 ? ((s.attacks / s.total) * 100).toFixed(1) : "0.0";
          push(mkLine("SYS", `Stats · total: ${s.total} · ataques: ${s.attacks} · rate: ${rate}%`));
        }
      } catch { /* backend no disponible */ }
    };

    poll();
    const iv = setInterval(poll, 2500);
    return () => clearInterval(iv);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, paused]);

  const visible = filter === "ALL"
    ? lines
    : lines.filter(l =>
        filter === "ALERT"  ? l.level === "ALERT"
      : filter === "INFO"   ? l.level === "NORMAL" || l.level === "INFO"
      : /* SYS */             l.level === "SYS"
      );

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="shrink-0 flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Terminal size={11} style={{ color: "#58a6ff" }}/>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "#58a6ff" }}>
            Log IDS
          </span>
          {running && (
            <span className="w-1.5 h-1.5 rounded-full ml-1"
              style={{ background: "#3fb950", boxShadow: "0 0 4px #3fb950", animation: "flicker 2s infinite" }}/>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Filtros */}
          {[["ALL","Todos"],["ALERT","⚠ ATK"],["INFO","✓ OK"],["SYS","SYS"]].map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-1.5 py-0.5 rounded text-[8px] font-semibold transition"
              style={{
                background: filter === f ? "rgba(88,166,255,0.12)" : "transparent",
                color: filter === f ? "#58a6ff" : "#3a4455",
                border: `1px solid ${filter === f ? "#58a6ff33" : "transparent"}`,
              }}>
              {label}
            </button>
          ))}
          {/* Pausa */}
          <button onClick={() => setPaused(p => !p)}
            className="px-1.5 py-0.5 rounded text-[8px] font-semibold transition ml-1"
            style={{
              background: paused ? "rgba(210,153,34,0.12)" : "transparent",
              color: paused ? "#d29922" : "#3a4455",
              border: `1px solid ${paused ? "#d2992233" : "transparent"}`,
            }}>
            {paused ? "▶ Reanudar" : "⏸ Pausar"}
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div className="flex-1 overflow-y-auto rounded-lg p-2.5 font-mono text-[10px] leading-relaxed min-h-0"
        style={{ background: "#04070a", border: "1px solid #1c2333" }}>

        {visible.length === 0 && (
          <div className="text-center py-4" style={{ color: "#3a4455" }}>
            Sin eventos para este filtro
          </div>
        )}

        {visible.map(l => (
          <div key={l.id} className="py-0.5 group">
            <div className="flex gap-1.5 items-baseline">
              <span style={{ color: "#3a4455", flexShrink: 0, fontSize: "9px" }}>{l.ts}</span>
              <span className="font-bold text-[8px] px-1 py-px rounded"
                style={{
                  background: `${LEVEL_COLOR[l.level] ?? "#8b949e"}18`,
                  color: LEVEL_COLOR[l.level] ?? "#8b949e",
                  flexShrink: 0,
                }}>
                {l.level === "NORMAL" ? "OK" : l.level}
              </span>
              <span style={{ color: l.level === "ALERT" ? "#f85149" : l.level === "SYS" ? "#58a6ff" : "#cdd9e5" }}>
                {l.msg}
              </span>
            </div>
            {l.detail && (
              <div className="ml-20 text-[8px] mt-0.5" style={{ color: "#545d68" }}>
                └ {l.detail}
              </div>
            )}
          </div>
        ))}

        {/* Cursor */}
        <div className="flex items-center gap-1 mt-1 py-0.5">
          <span style={{ color: "#3fb950" }}>$</span>
          <span className="inline-block w-1.5 h-3"
            style={{ background: "#3fb950", animation: "flicker 1.2s step-start infinite", opacity: 0.8 }}/>
        </div>
        <div ref={bottomRef}/>
      </div>

      {/* Footer stats */}
      <div className="shrink-0 flex items-center justify-between mt-1.5 px-1">
        <span className="text-[8px]" style={{ color: "#3a4455" }}>
          {visible.length} entradas · {paused ? "⏸ pausado" : "actualización cada 2.5s"}
        </span>
        <span className="text-[8px]" style={{ color: running ? "#3fb950" : "#3a4455" }}>
          {running ? "● captura activa" : "○ sin captura"}
        </span>
      </div>
    </div>
  );
}
