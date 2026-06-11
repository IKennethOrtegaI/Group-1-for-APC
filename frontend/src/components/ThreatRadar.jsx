import { useEffect, useRef, useState } from "react";

const CX = 130, CY = 130, MAX_R = 115;

export default function ThreatRadar({ newAttack }) {
  const [angle, setAngle] = useState(0);
  const [blips, setBlips] = useState([]);
  const animRef = useRef();
  const prevAttack = useRef(null);

  // Sweep rotation
  useEffect(() => {
    let a = 0;
    const animate = () => {
      a = (a + 0.6) % 360;
      setAngle(a);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  // Add blips periodically
  useEffect(() => {
    const iv = setInterval(() => {
      const theta = Math.random() * Math.PI * 2;
      const r = 25 + Math.random() * 95;
      setBlips(prev => [
        ...prev.filter(b => Date.now() - b.t < 6000).slice(-14),
        { id: Date.now(), x: CX + r * Math.cos(theta), y: CY + r * Math.sin(theta), t: Date.now(), attack: Math.random() < 0.3 },
      ]);
    }, 1200);
    return () => clearInterval(iv);
  }, []);

  // React to external attack event
  useEffect(() => {
    if (!newAttack || newAttack === prevAttack.current) return;
    prevAttack.current = newAttack;
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const theta = Math.random() * Math.PI * 2;
        const r = 40 + Math.random() * 75;
        setBlips(prev => [
          ...prev.slice(-14),
          { id: Date.now() + i, x: CX + r * Math.cos(theta), y: CY + r * Math.sin(theta), t: Date.now(), attack: true },
        ]);
      }, i * 200);
    }
  }, [newAttack]);

  const rad = (angle * Math.PI) / 180;
  const sx = CX + MAX_R * Math.cos(rad);
  const sy = CY + MAX_R * Math.sin(rad);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "#3fb950" }}>
          Radar de Amenazas
        </span>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#3fb950", boxShadow: "0 0 4px #3fb950" }}/>
          <span className="text-[9px]" style={{ color: "#3fb950" }}>ACTIVO</span>
        </div>
      </div>

      <svg width="260" height="260" viewBox="0 0 260 260">
        <defs>
          <radialGradient id="rbg">
            <stop offset="0%" stopColor="#091409"/>
            <stop offset="100%" stopColor="#050a05"/>
          </radialGradient>
          <filter id="rf"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="rf2"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <clipPath id="radarClip">
            <circle cx={CX} cy={CY} r={MAX_R}/>
          </clipPath>
        </defs>

        {/* Background */}
        <circle cx={CX} cy={CY} r={MAX_R + 6} fill="url(#rbg)" stroke="#0d2b0d" strokeWidth="1"/>

        {/* Rings */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <circle key={f} cx={CX} cy={CY} r={MAX_R * f} fill="none" stroke="#163516" strokeWidth="0.8" opacity="0.7"/>
        ))}

        {/* Cross */}
        <line x1={CX - MAX_R} y1={CY} x2={CX + MAX_R} y2={CY} stroke="#163516" strokeWidth="0.5" opacity="0.5"/>
        <line x1={CX} y1={CY - MAX_R} x2={CX} y2={CY + MAX_R} stroke="#163516" strokeWidth="0.5" opacity="0.5"/>
        <line x1={CX - MAX_R * 0.7} y1={CY - MAX_R * 0.7} x2={CX + MAX_R * 0.7} y2={CY + MAX_R * 0.7} stroke="#163516" strokeWidth="0.3" opacity="0.3"/>
        <line x1={CX + MAX_R * 0.7} y1={CY - MAX_R * 0.7} x2={CX - MAX_R * 0.7} y2={CY + MAX_R * 0.7} stroke="#163516" strokeWidth="0.3" opacity="0.3"/>

        {/* Sweep trail */}
        <g clipPath="url(#radarClip)">
          {[80, 60, 40, 20].map((off, i) => {
            const a = ((angle - off + 360) % 360) * Math.PI / 180;
            return (
              <line key={off}
                x1={CX} y1={CY}
                x2={CX + MAX_R * Math.cos(a)} y2={CY + MAX_R * Math.sin(a)}
                stroke="#3fb950" strokeWidth="1"
                opacity={0.04 * (5 - i)}
              />
            );
          })}
          {/* Sweep line */}
          <line x1={CX} y1={CY} x2={sx} y2={sy}
            stroke="#3fb950" strokeWidth="1.5" opacity="0.95"
            filter="url(#rf)"/>
        </g>

        {/* Blips */}
        {blips.map(b => {
          const age = (Date.now() - b.t) / 6000;
          const op = Math.max(0, 1 - age * 1.3);
          return (
            <circle key={b.id} cx={b.x} cy={b.y}
              r={b.attack ? 4 : 2.5}
              fill={b.attack ? "#f85149" : "#3fb950"}
              opacity={op}
              filter={b.attack ? "url(#rf2)" : "url(#rf)"}
            />
          );
        })}

        {/* Center */}
        <circle cx={CX} cy={CY} r="3" fill="#3fb950" filter="url(#rf2)"/>
        <circle cx={CX} cy={CY} r="1" fill="#fff"/>

        {/* Cardinal labels */}
        {[["N", CX, CY - MAX_R - 8], ["S", CX, CY + MAX_R + 14], ["E", CX + MAX_R + 10, CY + 4], ["O", CX - MAX_R - 8, CY + 4]].map(([l, x, y]) => (
          <text key={l} x={x} y={y} textAnchor="middle" fontSize="8" fill="#1e4d1e" fontFamily="monospace" fontWeight="bold">{l}</text>
        ))}

        {/* Outer ring */}
        <circle cx={CX} cy={CY} r={MAX_R + 6} fill="none" stroke="#1a4d1a" strokeWidth="0.5"/>
      </svg>

      {/* Stats below radar */}
      <div className="grid grid-cols-2 gap-2 mt-2">
        {[
          { label: "AMENAZAS ACTIVAS", value: blips.filter(b => b.attack).length, color: "#f85149" },
          { label: "SEÑALES TOTALES",  value: blips.length,                        color: "#3fb950" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg px-2 py-1.5 text-center"
            style={{ background: "#0c1018", border: "1px solid #1c2333" }}>
            <p className="text-[8px] uppercase tracking-wider" style={{ color: "#545d68" }}>{label}</p>
            <p className="text-[16px] font-bold" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
