import { useEffect, useRef, useState, useCallback } from "react";

const W = 940, H = 420;

const NODES = [
  { id: "inet",   label: "INTERNET",    x: 55,  y: 210, r: 20, type: "external" },
  { id: "fw",     label: "FIREWALL",    x: 185, y: 210, r: 18, type: "firewall"  },
  { id: "ids",    label: "AI·IDS",      x: 330, y: 210, r: 22, type: "ids"       },
  { id: "dmz1",   label: "WEB DMZ",     x: 470, y: 110, r: 16, type: "server"    },
  { id: "dmz2",   label: "MAIL DMZ",    x: 470, y: 310, r: 16, type: "server"    },
  { id: "sw",     label: "CORE SW",     x: 610, y: 210, r: 18, type: "router"    },
  { id: "db",     label: "DATABASE",    x: 750, y: 120, r: 16, type: "database"  },
  { id: "app",    label: "APP SRV",     x: 750, y: 300, r: 16, type: "server"    },
  { id: "ep1",    label: "CLIENT A",    x: 880, y: 160, r: 13, type: "endpoint"  },
  { id: "ep2",    label: "CLIENT B",    x: 880, y: 260, r: 13, type: "endpoint"  },
];
const NODE_MAP = Object.fromEntries(NODES.map(n => [n.id, n]));

const EDGES = [
  { id:"e1", from:"inet",  to:"fw"   },
  { id:"e2", from:"fw",    to:"ids"  },
  { id:"e3", from:"ids",   to:"dmz1" },
  { id:"e4", from:"ids",   to:"dmz2" },
  { id:"e5", from:"ids",   to:"sw"   },
  { id:"e6", from:"sw",    to:"db"   },
  { id:"e7", from:"sw",    to:"app"  },
  { id:"e8", from:"db",    to:"ep1"  },
  { id:"e9", from:"app",   to:"ep2"  },
];

const COLORS = {
  external: "#8b949e", firewall: "#d29922", ids: "#58a6ff",
  server:   "#3fb950", router:   "#39d353", database: "#a371f7", endpoint: "#79c0ff",
};

const ATTACK_PATHS = [
  ["inet","fw","ids","sw","db","ep1"],
  ["inet","fw","ids","dmz1"],
  ["inet","fw","ids","sw","app","ep2"],
  ["inet","fw","ids","dmz2"],
  ["inet","fw","ids","sw","db"],
];

let pid = 0;

export default function NetworkMap({ onAttack }) {
  const particlesRef = useRef([]);
  const animRef = useRef();
  const lastRef = useRef(0);
  const addRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [attacked, setAttacked] = useState(new Set());
  const [hover, setHover] = useState(null);
  const [stats, setStats] = useState({ packets: 0, attacks: 0 });

  const addParticle = useCallback((fromId, toId, isAttack, size) => {
    particlesRef.current.push({
      id: ++pid, from: fromId, to: toId, progress: 0,
      speed: isAttack ? 0.18 + Math.random() * 0.08 : 0.28 + Math.random() * 0.22,
      isAttack, size: size ?? (isAttack ? 4.5 : 1.8),
    });
  }, []);
  addRef.current = addParticle;

  const simulateAttack = useCallback(() => {
    const path = ATTACK_PATHS[Math.floor(Math.random() * ATTACK_PATHS.length)];
    const target = path[path.length - 1];
    path.slice(0, -1).forEach((n, i) => {
      const next = path[i + 1];
      const edge = EDGES.find(e => e.from === n && e.to === next);
      if (edge) setTimeout(() => addRef.current?.(n, next, true, 5), i * 380);
    });
    setTimeout(() => {
      setAttacked(prev => new Set([...prev, target]));
      onAttack?.({ target, path, time: new Date() });
      setTimeout(() => setAttacked(prev => { const s = new Set(prev); s.delete(target); return s; }), 3500);
    }, path.length * 380);
  }, [onAttack]);

  useEffect(() => {
    const animate = (t) => {
      const dt = Math.min((t - lastRef.current) / 1000, 0.05);
      lastRef.current = t;
      particlesRef.current = particlesRef.current
        .map(p => ({ ...p, progress: p.progress + p.speed * dt }))
        .filter(p => p.progress <= 1.05);
      if (Math.random() < 0.06) {
        const e = EDGES[Math.floor(Math.random() * EDGES.length)];
        addRef.current?.(e.from, e.to, false);
      }
      setStats(s => ({ ...s, packets: particlesRef.current.length }));
      setTick(t => t + 1);
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  useEffect(() => {
    const schedule = () => {
      const delay = 9000 + Math.random() * 8000;
      return setTimeout(() => { simulateAttack(); ref = schedule(); }, delay);
    };
    let ref = schedule();
    return () => clearTimeout(ref);
  }, [simulateAttack]);

  const pos = (p) => {
    const f = NODE_MAP[p.from], t = NODE_MAP[p.to];
    return { x: f.x + (t.x - f.x) * Math.min(p.progress, 1), y: f.y + (t.y - f.y) * Math.min(p.progress, 1) };
  };

  const attackParticles = particlesRef.current.filter(p => p.isAttack).length;

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "#58a6ff" }}>
            Topología de Red · Tiempo Real
          </span>
          <div className="flex gap-3 mt-0.5">
            <span className="text-[10px]" style={{ color: "#545d68" }}>
              <span style={{ color: "#58a6ff" }}>{particlesRef.current.length}</span> paquetes activos
            </span>
            {attackParticles > 0 && (
              <span className="text-[10px]" style={{ color: "#f85149" }}>
                ⚠ {attackParticles} ataques en tránsito
              </span>
            )}
          </div>
        </div>
        <button onClick={simulateAttack}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all active:scale-95"
          style={{ background:"rgba(248,81,73,0.1)", border:"1px solid rgba(248,81,73,0.4)", color:"#f85149" }}>
          ⚡ Simular Ataque
        </button>
      </div>

      <div className="flex-1" style={{ minHeight: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" style={{ overflow: "visible" }}>
          <defs>
            <filter id="glow-b"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="glow-r"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <filter id="glow-n"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <pattern id="dots" width="30" height="30" patternUnits="userSpaceOnUse">
              <circle cx="15" cy="15" r="0.6" fill="#1c2333"/>
            </pattern>
            {NODES.map(n => (
              <radialGradient key={`rg-${n.id}`} id={`rg-${n.id}`} cx="40%" cy="35%">
                <stop offset="0%" stopColor={COLORS[n.type]} stopOpacity="0.18"/>
                <stop offset="100%" stopColor="#060910" stopOpacity="1"/>
              </radialGradient>
            ))}
          </defs>

          <rect width={W} height={H} fill="url(#dots)" rx="8"/>

          {/* Edges */}
          {EDGES.map(e => {
            const f = NODE_MAP[e.from], t = NODE_MAP[e.to];
            return (
              <g key={e.id}>
                <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke="#1c2333" strokeWidth="1.5"/>
                <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke="#2d3748" strokeWidth="0.5" strokeDasharray="5 10"/>
              </g>
            );
          })}

          {/* Particles */}
          {particlesRef.current.map(p => {
            const { x, y } = pos(p);
            return (
              <circle key={p.id} cx={x} cy={y} r={p.size}
                fill={p.isAttack ? "#f85149" : "#58a6ff"}
                opacity={0.9}
                filter={p.isAttack ? "url(#glow-r)" : "url(#glow-b)"}
              />
            );
          })}

          {/* Nodes */}
          {NODES.map(n => {
            const isAtt = attacked.has(n.id);
            const isHov = hover === n.id;
            const col = COLORS[n.type];
            return (
              <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
                {isAtt && (
                  <>
                    <circle cx={n.x} cy={n.y} r={n.r + 6} fill="none" stroke="#f85149" strokeWidth="1.5" opacity="0.5">
                      <animate attributeName="r" values={`${n.r+4};${n.r+28};${n.r+4}`} dur="1.2s" repeatCount="indefinite"/>
                      <animate attributeName="opacity" values="0.6;0;0.6" dur="1.2s" repeatCount="indefinite"/>
                    </circle>
                    <circle cx={n.x} cy={n.y} r={n.r + 3} fill="none" stroke="#f85149" strokeWidth="2.5" opacity="0.4">
                      <animate attributeName="opacity" values="0.6;0.1;0.6" dur="0.6s" repeatCount="indefinite"/>
                    </circle>
                  </>
                )}
                {(isHov || n.type === "ids") && (
                  <circle cx={n.x} cy={n.y} r={n.r + 8} fill="none" stroke={col} strokeWidth="0.5" opacity="0.2"/>
                )}
                <circle cx={n.x} cy={n.y} r={n.r + 2} fill="none" stroke={col} strokeWidth="0.5" opacity="0.15"/>
                <circle cx={n.x} cy={n.y} r={n.r}
                  fill={`url(#rg-${n.id})`}
                  stroke={isAtt ? "#f85149" : col}
                  strokeWidth={isAtt ? 2 : isHov ? 1.5 : 1}
                  filter="url(#glow-n)"
                />
                {n.type === "ids" && (
                  <circle cx={n.x} cy={n.y} r={n.r - 5} fill="none" stroke="#58a6ff" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.5">
                    <animateTransform attributeName="transform" type="rotate" from={`0 ${n.x} ${n.y}`} to={`360 ${n.x} ${n.y}`} dur="8s" repeatCount="indefinite"/>
                  </circle>
                )}
                <text x={n.x} y={n.y + n.r + 13} textAnchor="middle" fontSize="7.5"
                  fill={isAtt ? "#f85149" : col} fontFamily="'Courier New', monospace" fontWeight="700" letterSpacing="0.8">
                  {n.label}
                </text>
              </g>
            );
          })}

          {/* Hover tooltip */}
          {hover && (() => {
            const n = NODE_MAP[hover];
            return (
              <g>
                <rect x={n.x - 52} y={n.y - n.r - 46} width="104" height="34" rx="5"
                  fill="#0c1018" stroke="#1c2333" strokeWidth="1"/>
                <text x={n.x} y={n.y - n.r - 28} textAnchor="middle" fontSize="10" fill="#cdd9e5" fontFamily="sans-serif" fontWeight="600">{n.label}</text>
                <text x={n.x} y={n.y - n.r - 16} textAnchor="middle" fontSize="8.5" fill={COLORS[n.type]} fontFamily="monospace">{n.type.toUpperCase()} · {attacked.has(n.id) ? "⚠ BAJO ATAQUE" : "NORMAL"}</text>
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}
