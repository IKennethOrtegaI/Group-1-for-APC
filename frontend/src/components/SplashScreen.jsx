import { useEffect, useRef, useState } from "react";
import { Shield, Lock, ChevronRight, Wifi, AlertTriangle, Eye } from "lucide-react";

// ── Matrix rain ────────────────────────────────────────────────────────────
function MatrixRain() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; };
    resize();
    const chars = "01アイウエオABCDEF0110";
    const fontSize = 12;
    const cols = Math.floor(canvas.width / fontSize);
    const drops = Array(cols).fill(1);
    const draw = () => {
      ctx.fillStyle = "rgba(4,7,12,0.06)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drops.forEach((y, i) => {
        ctx.fillStyle = i % 7 === 0 ? "#1e6b1e" : "#0b3b0b";
        ctx.font = `${fontSize}px monospace`;
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * fontSize, y * fontSize);
        if (y * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
    };
    const iv = setInterval(draw, 55);
    return () => clearInterval(iv);
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ opacity: 0.35 }}/>;
}

// ── UNMSM Shield SVG ───────────────────────────────────────────────────────
function UnmsmShield() {
  return (
    <svg viewBox="0 0 220 260" width="180" height="210" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="goldGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#d4a017" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#d4a017" stopOpacity="0"/>
        </radialGradient>
        <filter id="goldShadow">
          <feGaussianBlur stdDeviation="3" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Outer glow */}
      <ellipse cx="110" cy="130" rx="95" ry="110" fill="url(#goldGlow)"/>

      {/* Shield body */}
      <path d="M110 8 L200 45 L200 145 Q200 210 110 250 Q20 210 20 145 L20 45 Z"
        fill="none" stroke="#b8960c" strokeWidth="2.5" filter="url(#goldShadow)"/>
      <path d="M110 18 L190 50 L190 148 Q190 205 110 242 Q30 205 30 148 L30 50 Z"
        fill="rgba(180,140,10,0.06)" stroke="#d4a017" strokeWidth="1"/>

      {/* Inner shield dividers */}
      <line x1="110" y1="18" x2="110" y2="242" stroke="#b8960c" strokeWidth="0.8" strokeOpacity="0.5"/>
      <line x1="30" y1="130" x2="190" y2="130" stroke="#b8960c" strokeWidth="0.8" strokeOpacity="0.5"/>

      {/* Top left — sun/star */}
      <circle cx="70" cy="72" r="18" fill="none" stroke="#d4a017" strokeWidth="1" strokeOpacity="0.7"/>
      {[0,45,90,135,180,225,270,315].map(a => {
        const r = a * Math.PI / 180;
        return <line key={a} x1={70+12*Math.cos(r)} y1={72+12*Math.sin(r)}
          x2={70+20*Math.cos(r)} y2={72+20*Math.sin(r)}
          stroke="#d4a017" strokeWidth="1.5" strokeLinecap="round"/>;
      })}
      <circle cx="70" cy="72" r="6" fill="#d4a017" opacity="0.8"/>

      {/* Top right — 3 crowns */}
      {[85, 105, 125].map((x, i) => (
        <g key={i} transform={`translate(${x}, 58)`}>
          <rect x="-7" y="4" width="14" height="5" rx="1" fill="#d4a017" opacity="0.7"/>
          <path d="M-7,4 L-7,-2 L-3,1 L0,-4 L3,1 L7,-2 L7,4 Z" fill="#d4a017" opacity="0.8"/>
        </g>
      ))}

      {/* Center — figure (San Marcos) */}
      <ellipse cx="110" cy="160" rx="30" ry="38" fill="none" stroke="#b8960c" strokeWidth="1" strokeOpacity="0.6"/>
      {/* Stylized figure */}
      <circle cx="110" cy="140" r="6" fill="none" stroke="#d4a017" strokeWidth="1.5" opacity="0.7"/>
      <path d="M104 148 Q110 155 116 148 L118 170 L102 170 Z" fill="none" stroke="#d4a017" strokeWidth="1.2" opacity="0.6"/>
      {/* Columns */}
      <rect x="85" y="158" width="4" height="20" rx="1" fill="#d4a017" opacity="0.5"/>
      <rect x="131" y="158" width="4" height="20" rx="1" fill="#d4a017" opacity="0.5"/>

      {/* Bottom — lion */}
      <path d="M75 205 Q80 195 90 198 Q95 190 105 195 Q110 188 120 195 Q130 190 135 198 Q145 195 150 205 Q140 220 110 222 Q80 220 75 205 Z"
        fill="none" stroke="#b8960c" strokeWidth="1.2" opacity="0.6"/>
      <circle cx="110" cy="200" r="3" fill="#d4a017" opacity="0.6"/>

      {/* Text arc top */}
      <path id="topArc" d="M 45 80 A 70 70 0 0 1 175 80" fill="none"/>
      <text fontSize="7" fill="#d4a017" opacity="0.8" fontFamily="serif" letterSpacing="1">
        <textPath href="#topArc" startOffset="10%">UNIVERSITAS · S · MARCI · LIMENSIS</textPath>
      </text>

      {/* Text arc bottom */}
      <path id="botArc" d="M 45 175 A 70 70 0 0 0 175 175" fill="none"/>
      <text fontSize="7" fill="#d4a017" opacity="0.8" fontFamily="serif" letterSpacing="1">
        <textPath href="#botArc" startOffset="8%">DECANO DE AMERICA · MDLXXXI</textPath>
      </text>

      {/* Corner wheat/laurel hints */}
      {[-1,1].map(s => (
        <g key={s} transform={`translate(${110 + s*80}, 130) scale(${s},1)`}>
          {[0,1,2,3].map(i => (
            <ellipse key={i} cx={-6-i*5} cy={-15+i*10} rx="4" ry="7"
              fill="none" stroke="#b8960c" strokeWidth="1" opacity="0.4"
              transform={`rotate(${-30+i*15}, ${-6-i*5}, ${-15+i*10})`}/>
          ))}
        </g>
      ))}
    </svg>
  );
}

// ── Hacker Character SVG ───────────────────────────────────────────────────
function HackerCharacter() {
  return (
    <svg viewBox="0 0 260 320" width="240" height="300" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bodyGrad" cx="50%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#2a2a2a"/>
          <stop offset="100%" stopColor="#111111"/>
        </radialGradient>
        <radialGradient id="screenGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#58a6ff" stopOpacity="0.9"/>
          <stop offset="100%" stopColor="#1d6fe6" stopOpacity="0.6"/>
        </radialGradient>
        <filter id="charGlow">
          <feGaussianBlur stdDeviation="4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="softShadow">
          <feGaussianBlur stdDeviation="6" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      {/* Shadow under character */}
      <ellipse cx="130" cy="305" rx="70" ry="10" fill="#000" opacity="0.4" filter="url(#softShadow)"/>

      {/* ── LEGS / BASE ── */}
      <rect x="88" y="230" width="34" height="55" rx="10" fill="#1a1a1a"/>
      <rect x="138" y="230" width="34" height="55" rx="10" fill="#1a1a1a"/>
      {/* Shoes - orange */}
      <rect x="82" y="272" width="42" height="18" rx="9" fill="#e85d00"/>
      <rect x="136" y="272" width="42" height="18" rx="9" fill="#e85d00"/>
      {/* Shoe highlight */}
      <ellipse cx="103" cy="275" rx="14" ry="4" fill="#ff7722" opacity="0.5"/>
      <ellipse cx="157" cy="275" rx="14" ry="4" fill="#ff7722" opacity="0.5"/>

      {/* ── BODY / HOODIE ── */}
      <rect x="70" y="140" width="120" height="100" rx="18" fill="url(#bodyGrad)"/>
      {/* Hoodie center pocket */}
      <rect x="105" y="195" width="50" height="35" rx="8" fill="#1a1a1a" opacity="0.6"/>
      {/* Hoodie front seam */}
      <line x1="130" y1="150" x2="130" y2="235" stroke="#252525" strokeWidth="2"/>

      {/* ── ARMS ── */}
      {/* Left arm (holding laptop bottom) */}
      <path d="M70 155 Q40 170 45 200 Q50 215 75 220" fill="none" stroke="#1a1a1a" strokeWidth="28" strokeLinecap="round"/>
      <path d="M70 155 Q40 170 45 200 Q50 215 75 220" fill="none" stroke="#252525" strokeWidth="24" strokeLinecap="round"/>
      {/* Right arm */}
      <path d="M190 155 Q220 170 215 200 Q210 215 185 220" fill="none" stroke="#1a1a1a" strokeWidth="28" strokeLinecap="round"/>
      <path d="M190 155 Q220 170 215 200 Q210 215 185 220" fill="none" stroke="#252525" strokeWidth="24" strokeLinecap="round"/>

      {/* ── LAPTOP ── */}
      {/* Base */}
      <rect x="58" y="208" width="144" height="8" rx="3" fill="#333"/>
      {/* Screen */}
      <rect x="68" y="158" width="124" height="55" rx="6" fill="#1a1a1a"/>
      <rect x="72" y="162" width="116" height="47" rx="4" fill="url(#screenGlow)" opacity="0.9"/>
      {/* Screen content — code lines */}
      {[0,1,2,3,4].map(i => (
        <rect key={i} x={78} y={167+i*8} width={30+Math.random()*60|0} height="3" rx="1"
          fill={i===1?"#3fb950":i===3?"#f85149":"#ffffff"} opacity="0.7"/>
      ))}
      <rect x="78" y="167" width="50" height="3" rx="1" fill="#fff" opacity="0.7"/>
      <rect x="78" y="175" width="80" height="3" rx="1" fill="#3fb950" opacity="0.8"/>
      <rect x="78" y="183" width="35" height="3" rx="1" fill="#fff" opacity="0.5"/>
      <rect x="78" y="191" width="65" height="3" rx="1" fill="#f85149" opacity="0.7"/>
      <rect x="78" y="199" width="45" height="3" rx="1" fill="#fff" opacity="0.4"/>
      {/* Lock icon on laptop lid area */}
      <circle cx="130" cy="183" r="12" fill="none" stroke="#58a6ff" strokeWidth="1" opacity="0.3"/>

      {/* ── NECK ── */}
      <rect x="114" y="120" width="32" height="28" rx="8" fill="#c8a882"/>

      {/* ── HEAD ── */}
      {/* Hood back */}
      <ellipse cx="130" cy="95" rx="58" ry="55" fill="#111"/>
      {/* Face */}
      <ellipse cx="130" cy="100" rx="44" ry="42" fill="#c8a882"/>
      {/* Hood shadow on face sides */}
      <ellipse cx="88" cy="95" rx="18" ry="38" fill="#0d0d0d" opacity="0.7"/>
      <ellipse cx="172" cy="95" rx="18" ry="38" fill="#0d0d0d" opacity="0.7"/>

      {/* Mask (lower face) */}
      <rect x="100" y="110" width="60" height="32" rx="10" fill="#1a1a1a"/>
      <rect x="104" y="114" width="52" height="24" rx="8" fill="#222"/>
      {/* Mask vent lines */}
      {[0,1,2].map(i => (
        <line key={i} x1="108" y1={118+i*7} x2="152" y2={118+i*7}
          stroke="#333" strokeWidth="1.5" strokeLinecap="round"/>
      ))}

      {/* ── EYES ── */}
      {/* Angry eyebrows */}
      <path d="M103 95 Q112 88 120 92" fill="none" stroke="#3a2a1a" strokeWidth="3" strokeLinecap="round"/>
      <path d="M140 92 Q148 88 157 95" fill="none" stroke="#3a2a1a" strokeWidth="3" strokeLinecap="round"/>
      {/* Eyes */}
      <ellipse cx="112" cy="100" rx="9" ry="7" fill="#1a0a00"/>
      <ellipse cx="148" cy="100" rx="9" ry="7" fill="#1a0a00"/>
      {/* Iris */}
      <ellipse cx="112" cy="100" rx="5" ry="5" fill="#8b5e00"/>
      <ellipse cx="148" cy="100" rx="5" ry="5" fill="#8b5e00"/>
      {/* Pupils */}
      <ellipse cx="113" cy="100" rx="3" ry="3" fill="#000"/>
      <ellipse cx="149" cy="100" rx="3" ry="3" fill="#000"/>
      {/* Eye shine */}
      <ellipse cx="114" cy="98" rx="1.5" ry="1.5" fill="#fff" opacity="0.8"/>
      <ellipse cx="150" cy="98" rx="1.5" ry="1.5" fill="#fff" opacity="0.8"/>

      {/* ── HOODIE DETAILS ── */}
      {/* Hood rim */}
      <path d="M72 80 Q80 45 130 40 Q180 45 188 80" fill="none" stroke="#222" strokeWidth="8" strokeLinecap="round"/>
      <path d="M72 80 Q80 48 130 44 Q180 48 188 80" fill="none" stroke="#2a2a2a" strokeWidth="4" strokeLinecap="round"/>

      {/* Glow from screen on character */}
      <ellipse cx="130" cy="185" rx="55" ry="20" fill="#58a6ff" opacity="0.04" filter="url(#charGlow)"/>

      {/* Floating code bits around character */}
      {["01","10","FF","IDS","0x"].map((t, i) => (
        <text key={t} x={[30,200,20,205,25][i]} y={[120,100,200,180,155][i]}
          fontSize="9" fill="#58a6ff" opacity={0.25+i*0.05} fontFamily="monospace"
          style={{ animation: `floatCode ${2+i*0.3}s ease-in-out ${i*0.4}s infinite alternate` }}>
          {t}
        </text>
      ))}
    </svg>
  );
}

// ── Floating stat badge ────────────────────────────────────────────────────
function StatBadge({ icon: Icon, label, value, color, delay = 0 }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{
        background: "rgba(4,7,12,0.85)",
        border: `1px solid ${color}33`,
        backdropFilter: "blur(8px)",
        animation: `floatBadge 3s ease-in-out ${delay}s infinite alternate`,
      }}>
      <Icon size={12} style={{ color }}/>
      <div>
        <p className="text-[8px] uppercase tracking-widest leading-none" style={{ color: "#3a4455" }}>{label}</p>
        <p className="text-[11px] font-bold font-mono leading-tight" style={{ color }}>{value}</p>
      </div>
    </div>
  );
}

// ── Boot terminal ──────────────────────────────────────────────────────────
const BOOT_LINES = [
  { text: "Inicializando módulos de detección…",        color: "#58a6ff" },
  { text: "Cargando modelos: RF · XGBoost · SVM · MLP", color: "#58a6ff" },
  { text: "Conectando base de datos SQLite…",            color: "#58a6ff" },
  { text: "Verificando datasets NSL-KDD · CICIDS2017…", color: "#58a6ff" },
  { text: "Levantando API REST en :8000…",               color: "#58a6ff" },
  { text: "Motor de monitoreo de red activo…",           color: "#58a6ff" },
  { text: "✓ Todos los sistemas operativos — LISTO",     color: "#3fb950" },
];

// ── Main SplashScreen ──────────────────────────────────────────────────────
export default function SplashScreen({ onEnter }) {
  const [phase,    setPhase]    = useState("idle");
  const [lines,    setLines]    = useState([]);
  const [progress, setProgress] = useState(0);

  const startBoot = () => {
    setPhase("booting");
    BOOT_LINES.forEach((l, i) => {
      setTimeout(() => {
        setLines(prev => [...prev, l]);
        setProgress(Math.round(((i + 1) / BOOT_LINES.length) * 100));
        if (i === BOOT_LINES.length - 1) setTimeout(() => setPhase("ready"), 400);
      }, i * 320 + 150);
    });
  };

  return (
    <div className="fixed inset-0 flex overflow-hidden" style={{ background: "#04070c", zIndex: 100 }}>
      <MatrixRain/>

      {/* Grid overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(63,185,80,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(63,185,80,0.03) 1px, transparent 1px)",
        backgroundSize: "55px 55px",
      }}/>

      {/* Scan line */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div style={{
          position: "absolute", left: 0, right: 0, height: 2,
          background: "linear-gradient(90deg, transparent 0%, rgba(88,166,255,0.25) 50%, transparent 100%)",
          animation: "scanSplash 5s linear infinite",
        }}/>
      </div>

      {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col justify-between w-[52%] px-14 py-10">

        {/* UNMSM Shield + titles */}
        <div className="flex items-start gap-6">
          <div style={{ filter: "drop-shadow(0 0 20px rgba(212,160,23,0.35))" }}>
            <UnmsmShield/>
          </div>
          <div className="flex flex-col justify-center" style={{ paddingTop: 20 }}>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] mb-1" style={{ color: "#b8960c" }}>
              UNMSM · Posgrado
            </p>
            <p className="text-[9px] mb-4" style={{ color: "#5a4818" }}>
              Dirección General de Estudios de Posgrado
            </p>
            <h1 className="font-black leading-[0.95] mb-3"
              style={{ fontSize: 36, color: "#cdd9e5", textShadow: "0 0 40px rgba(88,166,255,0.2)" }}>
              SISTEMA DE<br/>
              <span style={{ color: "#58a6ff", textShadow: "0 0 20px rgba(88,166,255,0.5)" }}>DETECCIÓN</span><br/>
              DE INTRUSOS
            </h1>
            <div className="h-px w-48 mb-2" style={{ background: "linear-gradient(90deg,#58a6ff44,transparent)" }}/>
            <p className="text-[12px] font-semibold mb-0.5" style={{ color: "#3fb950" }}>
              AI-Based Intrusion Detection System
            </p>
            <p className="text-[10px]" style={{ color: "#3a4455" }}>
              APC — Grupo 1 · RF · XGBoost · SVM · MLP
            </p>
          </div>
        </div>

        {/* Stat badges */}
        <div className="flex flex-wrap gap-2 my-4">
          <StatBadge icon={Shield}        label="Modelos IA"    value="4 activos"   color="#58a6ff" delay={0}/>
          <StatBadge icon={Wifi}          label="Dataset"       value="NSL-KDD"     color="#3fb950" delay={0.4}/>
          <StatBadge icon={AlertTriangle} label="Ataques"       value="DoS·Probe"   color="#f85149" delay={0.8}/>
          <StatBadge icon={Eye}           label="CICIDS2017"    value="DDoS·Web"    color="#a371f7" delay={1.2}/>
        </div>

        {/* Boot terminal */}
        {phase !== "idle" && (
          <div className="rounded-xl p-4 font-mono text-[11px] mb-3"
            style={{ background: "rgba(4,7,12,0.92)", border: "1px solid #1c2333", maxHeight: 170, overflowY: "auto" }}>
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 fade-up">
                <span style={{ color: l.color }}>›</span>
                <span style={{ color: i === lines.length - 1 ? l.color : "#545d68" }}>{l.text}</span>
              </div>
            ))}
            {phase === "booting" && (
              <span className="inline-block w-2 h-3 ml-4" style={{ background: "#3fb950", animation: "flicker 1s step-start infinite" }}/>
            )}
          </div>
        )}

        {/* Progress bar */}
        {phase === "booting" && (
          <div className="mb-3">
            <div className="flex justify-between text-[9px] mb-1" style={{ color: "#3a4455" }}>
              <span>Iniciando sistema IDS…</span><span style={{ color: "#58a6ff" }}>{progress}%</span>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: "#1c2333" }}>
              <div className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, background: "linear-gradient(90deg,#1d6fe6,#3fb950)" }}/>
            </div>
          </div>
        )}

        {/* CTA */}
        {phase === "idle" && (
          <button onClick={startBoot}
            className="flex items-center justify-center gap-3 py-3.5 rounded-2xl font-bold text-[13px] transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(29,111,230,0.12), rgba(63,185,80,0.08))",
              border: "1px solid rgba(88,166,255,0.3)",
              color: "#58a6ff",
              boxShadow: "0 0 30px rgba(88,166,255,0.08)",
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = "0 0 40px rgba(88,166,255,0.2)"}
            onMouseLeave={e => e.currentTarget.style.boxShadow = "0 0 30px rgba(88,166,255,0.08)"}>
            <Lock size={15}/>
            INICIAR SISTEMA IDS
            <ChevronRight size={15}/>
          </button>
        )}

        {phase === "ready" && (
          <button onClick={onEnter}
            className="flex items-center justify-center gap-3 py-3.5 rounded-2xl font-bold text-[13px] transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(63,185,80,0.15), rgba(29,111,230,0.08))",
              border: "1px solid rgba(63,185,80,0.45)",
              color: "#3fb950",
              boxShadow: "0 0 35px rgba(63,185,80,0.15)",
              animation: "pulseEnter 2s ease infinite",
            }}>
            <Shield size={15}/>
            ACCEDER AL DASHBOARD
            <ChevronRight size={15}/>
          </button>
        )}
      </div>

      {/* ── RIGHT PANEL ─────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center justify-center w-[48%]">

        {/* Concentric glow rings */}
        {[440, 340, 250].map((s, i) => (
          <div key={s} className="absolute rounded-full"
            style={{
              width: s, height: s,
              border: `1px solid rgba(88,166,255,${0.04 + i * 0.03})`,
              background: i === 2 ? "radial-gradient(circle, rgba(88,166,255,0.03) 0%, transparent 70%)" : "none",
              animation: `pulseRing ${3 + i}s ease-in-out ${i * 0.5}s infinite alternate`,
            }}/>
        ))}

        {/* Orbiting dots */}
        <div className="absolute" style={{ width: 460, height: 460, animation: "spinSlow 18s linear infinite" }}>
          {[0, 60, 120, 180, 240, 300].map(deg => (
            <div key={deg} className="absolute rounded-full"
              style={{
                width: deg % 120 === 0 ? 6 : 4,
                height: deg % 120 === 0 ? 6 : 4,
                background: deg % 120 === 0 ? "#58a6ff" : "#1d6fe633",
                boxShadow: deg % 120 === 0 ? "0 0 8px #58a6ff" : "none",
                top: "50%", left: "50%",
                transform: `rotate(${deg}deg) translateX(230px) translateY(-50%)`,
              }}/>
          ))}
        </div>

        {/* Secondary orbit */}
        <div className="absolute" style={{ width: 320, height: 320, animation: "spinSlow 12s linear infinite reverse" }}>
          {[0, 90, 180, 270].map(deg => (
            <div key={deg} className="absolute rounded-full"
              style={{
                width: 5, height: 5,
                background: "#3fb950",
                boxShadow: "0 0 6px #3fb950",
                top: "50%", left: "50%",
                transform: `rotate(${deg}deg) translateX(160px) translateY(-50%)`,
              }}/>
          ))}
        </div>

        {/* Hacker character */}
        <div style={{ animation: "floatChar 4s ease-in-out infinite alternate", position: "relative", zIndex: 2 }}>
          <HackerCharacter/>
        </div>

        {/* Threat type labels */}
        <div className="absolute bottom-10 left-6 flex flex-col gap-1.5">
          {[
            { label: "DoS Attack",  color: "#f85149", on: true  },
            { label: "Port Scan",   color: "#d29922", on: false },
            { label: "R2L Attack",  color: "#a371f7", on: false },
            { label: "U2R Attack",  color: "#f85149", on: false },
          ].map(({ label, color, on }) => (
            <div key={label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{ background: "rgba(4,7,12,0.85)", border: `1px solid ${color}22`, backdropFilter: "blur(8px)" }}>
              <span className="w-1.5 h-1.5 rounded-full"
                style={{ background: color, boxShadow: on ? `0 0 5px ${color}` : "none",
                         animation: on ? "flicker 1.5s infinite" : "none" }}/>
              <span className="text-[9px] font-mono" style={{ color: on ? color : "#2a3444" }}>{label}</span>
              <span className="text-[8px] ml-1" style={{ color: on ? "#3fb950" : "#1c2333" }}>
                {on ? "DETECTADO" : "monitoreando"}
              </span>
            </div>
          ))}
        </div>

        {/* Top right info */}
        <div className="absolute top-8 right-8 text-right">
          <p className="text-[8px] uppercase tracking-widest" style={{ color: "#2a3444" }}>Proyecto Académico</p>
          <p className="text-[11px] font-bold" style={{ color: "#58a6ff" }}>APC · Grupo 1</p>
          <p className="text-[9px] mt-0.5" style={{ color: "#2a3444" }}>UNMSM · 2025</p>
        </div>

        {/* Tech stack top left */}
        <div className="absolute top-8 left-6 flex flex-col gap-1">
          {["FastAPI", "React 18", "scikit-learn", "Docker"].map(t => (
            <span key={t} className="px-2 py-0.5 rounded text-[8px] font-mono"
              style={{ background: "rgba(14,20,30,0.9)", border: "1px solid #1c2333", color: "#3a4455" }}>
              {t}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes scanSplash {
          0%   { top: -3px; }
          100% { top: 100%; }
        }
        @keyframes floatBadge {
          from { transform: translateY(0px); }
          to   { transform: translateY(-7px); }
        }
        @keyframes floatChar {
          from { transform: translateY(0px); filter: drop-shadow(0 10px 30px rgba(88,166,255,0.15)); }
          to   { transform: translateY(-20px); filter: drop-shadow(0 30px 50px rgba(88,166,255,0.25)); }
        }
        @keyframes floatCode {
          from { transform: translateY(0px); opacity: 0.2; }
          to   { transform: translateY(-8px); opacity: 0.45; }
        }
        @keyframes pulseRing {
          from { transform: scale(1); opacity: 0.6; }
          to   { transform: scale(1.04); opacity: 1; }
        }
        @keyframes pulseEnter {
          0%,100% { box-shadow: 0 0 35px rgba(63,185,80,0.15); }
          50%     { box-shadow: 0 0 55px rgba(63,185,80,0.35); }
        }
        @keyframes spinSlow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
