/**
 * ThreatRadar — visualiza conexiones reales del IDS.
 * Blips rojos = ataques, verdes = normales.
 * Sin datos simulados. Solo activo cuando hay captura corriendo.
 */
import { useEffect, useRef, useState } from "react";

const API  = import.meta.env.VITE_API_URL || "http://localhost:8000";
const CX   = 88;
const CY   = 88;
const MAX_R = 78;

// Mapea una conexión a coordenadas polares deterministas
function connToPoint(conn) {
  // Ángulo: hash del IP destino + puerto → 0–360°
  const ipParts  = (conn.dst || "0.0.0.0:0").split(":")[0].split(".");
  const ipHash   = ipParts.reduce((acc, p) => acc * 31 + parseInt(p || 0), 0);
  const portHash = parseInt((conn.dst || ":0").split(":")[1] || 0);
  const angle    = ((ipHash * 13 + portHash * 7) % 360) * (Math.PI / 180);

  // Radio: ataques más lejos del centro; normal cerca
  const conf  = conn.confidence ?? 0.5;
  const r     = conn.prediction === "Attack"
    ? MAX_R * (0.55 + conf * 0.42)   // ataques: 55–97% del radio
    : MAX_R * (0.15 + (1 - conf) * 0.35); // normales: 15–50%

  return {
    x: CX + r * Math.cos(angle),
    y: CY + r * Math.sin(angle),
  };
}

export default function ThreatRadar() {
  const [sweepAngle, setSweepAngle] = useState(0);
  const [blips,      setBlips]      = useState([]);   // {id, x, y, attack, attackType, t, conf}
  const [running,    setRunning]    = useState(false);
  const [stats,      setStats]      = useState({ total: 0, attacks: 0, normal: 0 });
  const animRef  = useRef();
  const seenRef  = useRef(new Set());   // ts+src+dst ya vistos

  // Sweep rotation (siempre gira — pausa visualmente cuando no hay captura)
  useEffect(() => {
    let a = 0;
    const tick = () => {
      a = (a + (running ? 0.8 : 0.15)) % 360;
      setSweepAngle(a);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [running]);

  // Polling de resultados reales
  useEffect(() => {
    const poll = async () => {
      try {
        const [statusRes, resultsRes] = await Promise.all([
          fetch(`${API}/capture/status`),
          fetch(`${API}/capture/results?limit=80`),
        ]);
        const statusData  = await statusRes.json();
        const resultsData = await resultsRes.json();

        setRunning(statusData.running ?? false);
        setStats(statusData.stats ?? { total: 0, attacks: 0, normal: 0 });

        const conns = resultsData.connections ?? [];
        const now   = Date.now();

        const newBlips = [];
        for (const conn of conns) {
          const key = `${conn.ts}-${conn.src}-${conn.dst}`;
          if (seenRef.current.has(key)) continue;
          seenRef.current.add(key);

          const pt = connToPoint(conn);
          newBlips.push({
            id:         key,
            x:          pt.x,
            y:          pt.y,
            attack:     conn.prediction === "Attack",
            attackType: conn.attack_type ?? null,
            conf:       conn.confidence ?? 0.5,
            t:          now,
          });
        }

        if (newBlips.length > 0) {
          setBlips(prev => {
            const alive = prev.filter(b => now - b.t < 9000);
            return [...alive, ...newBlips].slice(-40);
          });
        }
      } catch { /* backend no disponible */ }
    };

    poll();
    const iv = setInterval(poll, 1800);
    return () => clearInterval(iv);
  }, []);

  const rad  = (sweepAngle * Math.PI) / 180;
  const sx   = CX + MAX_R * Math.cos(rad);
  const sy   = CY + MAX_R * Math.sin(rad);
  const now  = Date.now();
  const activeAttacks = blips.filter(b => b.attack && now - b.t < 9000).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "#3fb950" }}>
          Radar de Amenazas
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full"
            style={{
              background: running ? "#3fb950" : "#545d68",
              boxShadow:  running ? "0 0 5px #3fb950" : "none",
              animation:  running ? "flicker 2s infinite" : "none",
            }}/>
          <span className="text-[9px]" style={{ color: running ? "#3fb950" : "#545d68" }}>
            {running ? "EN VIVO" : "INACTIVO"}
          </span>
        </div>
      </div>

      {/* SVG Radar */}
      <svg width="176" height="176" viewBox="0 0 176 176">
        <defs>
          <radialGradient id="rbg2">
            <stop offset="0%"   stopColor={running ? "#071309" : "#08090c"}/>
            <stop offset="100%" stopColor="#050609"/>
          </radialGradient>
          <filter id="glow2">
            <feGaussianBlur stdDeviation="2.5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="atkGlow">
            <feGaussianBlur stdDeviation="5" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <clipPath id="radarClip2">
            <circle cx={CX} cy={CY} r={MAX_R}/>
          </clipPath>
        </defs>

        {/* Fondo */}
        <circle cx={CX} cy={CY} r={MAX_R + 5} fill="url(#rbg2)" stroke="#0d1c0d" strokeWidth="1"/>

        {/* Anillos */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <circle key={f} cx={CX} cy={CY} r={MAX_R * f}
            fill="none"
            stroke={running ? "#163516" : "#141820"}
            strokeWidth="0.8" opacity="0.7"/>
        ))}

        {/* Ejes */}
        <line x1={CX-MAX_R} y1={CY} x2={CX+MAX_R} y2={CY} stroke={running ? "#163516" : "#141820"} strokeWidth="0.5" opacity="0.5"/>
        <line x1={CX} y1={CY-MAX_R} x2={CX} y2={CY+MAX_R} stroke={running ? "#163516" : "#141820"} strokeWidth="0.5" opacity="0.5"/>

        {/* Sweep (atenuado si no hay captura) */}
        <g clipPath="url(#radarClip2)" opacity={running ? 1 : 0.2}>
          {[70, 50, 30, 15].map((off, i) => {
            const a = ((sweepAngle - off + 360) % 360) * Math.PI / 180;
            return (
              <line key={off} x1={CX} y1={CY}
                x2={CX + MAX_R * Math.cos(a)} y2={CY + MAX_R * Math.sin(a)}
                stroke="#3fb950" strokeWidth="1" opacity={0.035 * (5 - i)}/>
            );
          })}
          <line x1={CX} y1={CY} x2={sx} y2={sy}
            stroke="#3fb950" strokeWidth="1.5" opacity="0.9" filter="url(#glow2)"/>
        </g>

        {/* Blips reales */}
        {blips.map(b => {
          const age = (now - b.t) / 9000;
          const op  = Math.max(0, 1 - age * 1.2);
          if (op <= 0) return null;
          return (
            <g key={b.id}>
              {b.attack && (
                <circle cx={b.x} cy={b.y} r={7} fill="rgba(248,81,73,0.15)"
                  stroke="#f85149" strokeWidth="0.5" opacity={op * 0.6}/>
              )}
              <circle cx={b.x} cy={b.y}
                r={b.attack ? 4.5 : 2.5}
                fill={b.attack ? "#f85149" : "#3fb950"}
                opacity={op}
                filter={b.attack ? "url(#atkGlow)" : "url(#glow2)"}
              />
            </g>
          );
        })}

        {/* Centro */}
        <circle cx={CX} cy={CY} r="3.5" fill={running ? "#3fb950" : "#545d68"} filter="url(#glow2)"/>
        <circle cx={CX} cy={CY} r="1.2" fill="#fff"/>

        {/* Etiquetas cardinales */}
        {[["N",CX,CY-MAX_R-8],["S",CX,CY+MAX_R+14],["E",CX+MAX_R+10,CY+4],["O",CX-MAX_R-9,CY+4]].map(([l,x,y])=>(
          <text key={l} x={x} y={y} textAnchor="middle" fontSize="8"
            fill={running ? "#1e4d1e" : "#1c2333"} fontFamily="monospace" fontWeight="bold">{l}</text>
        ))}

        {/* Sin datos */}
        {!running && (
          <text x={CX} y={CY + 22} textAnchor="middle" fontSize="8" fill="#3a4455" fontFamily="monospace">
            Sin captura activa
          </text>
        )}
      </svg>

      {/* Stats + leyenda compactos */}
      <div className="flex items-center justify-between mt-1.5 gap-2">
        <div className="flex gap-2 flex-1">
          <div className="rounded px-2 py-1 text-center flex-1"
            style={{ background: "#0c1018", border: "1px solid #1c2333" }}>
            <p className="text-[7px] uppercase" style={{ color: "#545d68" }}>ATK</p>
            <p className="text-[13px] font-bold" style={{ color: activeAttacks > 0 ? "#f85149" : "#3a4455" }}>
              {activeAttacks}
            </p>
          </div>
          <div className="rounded px-2 py-1 text-center flex-1"
            style={{ background: "#0c1018", border: "1px solid #1c2333" }}>
            <p className="text-[7px] uppercase" style={{ color: "#545d68" }}>Total</p>
            <p className="text-[13px] font-bold" style={{ color: "#3fb950" }}>{stats.total}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#f85149" }}/>
            <span className="text-[7px]" style={{ color: "#545d68" }}>Ataque</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#3fb950" }}/>
            <span className="text-[7px]" style={{ color: "#545d68" }}>Normal</span>
          </div>
        </div>
      </div>
    </div>
  );
}
