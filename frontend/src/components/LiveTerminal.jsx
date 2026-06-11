import { useEffect, useRef, useState } from "react";
import { getAlerts } from "../api/client";

const PREFIX = { ALERTA: "#f85149", INFO: "#3fb950", WARN: "#d29922", SYS: "#58a6ff" };

const SYS_LINES = [
  { type: "SYS",   msg: "IDS Engine v1.0.0 iniciado correctamente" },
  { type: "SYS",   msg: "Modelos cargados: Random Forest + XGBoost" },
  { type: "SYS",   msg: "Escuchando tráfico en interfaz eth0..." },
  { type: "SYS",   msg: "Base de datos SQLite inicializada" },
  { type: "INFO",  msg: "Sistema de detección ACTIVO — monitoreo continuo" },
];

export default function LiveTerminal({ newAttack }) {
  const [lines, setLines] = useState(SYS_LINES.map((l, i) => ({ ...l, id: i, ts: formatTs(new Date()) })));
  const bottomRef = useRef(null);
  const seenIds = useRef(new Set());
  const prevAttack = useRef(null);
  let idSeq = useRef(100);

  function formatTs(d) {
    return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  const push = (type, msg) => {
    setLines(prev => [...prev.slice(-60), { id: ++idSeq.current, type, msg, ts: formatTs(new Date()) }]);
  };

  // Poll real alerts
  useEffect(() => {
    const load = async () => {
      try {
        const r = await getAlerts(20);
        r.data.forEach(a => {
          if (!seenIds.current.has(a.id)) {
            seenIds.current.add(a.id);
            const model = a.model_name === "random_forest" ? "RF" : "XGB";
            if (a.prediction === "Attack") {
              push("ALERTA", `Ataque detectado por ${model} — Confianza: ${(a.confidence * 100).toFixed(1)}% [${a.dataset?.toUpperCase()}]`);
            } else {
              push("INFO", `Tráfico normal verificado por ${model} — ${(a.confidence * 100).toFixed(1)}% seguro`);
            }
          }
        });
      } catch {}
    };
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  // React to network map attack events
  useEffect(() => {
    if (!newAttack || newAttack === prevAttack.current) return;
    prevAttack.current = newAttack;
    const targets = { ep1: "CLIENT-A", ep2: "CLIENT-B", db: "DATABASE", app: "APP-SRV", dmz1: "WEB-DMZ", dmz2: "MAIL-DMZ" };
    const t = targets[newAttack.target] ?? newAttack.target.toUpperCase();
    push("WARN",  `Paquetes maliciosos detectados en ruta → ${t}`);
    setTimeout(() => push("ALERTA", `INTRUSIÓN CONFIRMADA en ${t} — activando protocolo de bloqueo`), 800);
    setTimeout(() => push("SYS",   `Regla de firewall actualizada: DROP src=INET dst=${t}`), 1600);
    setTimeout(() => push("INFO",  `Nodo ${t} restaurado — tráfico bloqueado en perímetro`), 3200);
  }, [newAttack]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "#58a6ff" }}>
          Terminal · Log del Sistema
        </span>
        <div className="flex gap-1">
          {["#f85149","#d29922","#3fb950"].map(c => (
            <span key={c} className="w-2 h-2 rounded-full" style={{ background: c }}/>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto rounded-lg p-3 font-mono text-[11px] leading-relaxed"
        style={{ background: "#04070a", border: "1px solid #1c2333", minHeight: 0 }}>
        {lines.map(l => (
          <div key={l.id} className="fade-up flex gap-2 py-0.5">
            <span style={{ color: "#545d68", flexShrink: 0 }}>[{l.ts}]</span>
            <span style={{ color: PREFIX[l.type] ?? "#cdd9e5", fontWeight: 700, flexShrink: 0 }}>{l.type}</span>
            <span style={{ color: l.type === "ALERTA" ? "#f8514988" : "#8b949e" }}>{l.msg}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 mt-1">
          <span style={{ color: "#3fb950" }}>●</span>
          <span style={{ color: "#545d68" }}>_</span>
          <span className="inline-block w-2 h-3 ml-0.5" style={{ background: "#3fb950", animation: "flicker 1.2s step-start infinite" }}/>
        </div>
        <div ref={bottomRef}/>
      </div>
    </div>
  );
}
