/**
 * Analytics — indicadores históricos de captura por rango de tiempo.
 * Datos reales de CaptureLog (DB). Sin simulación.
 */
import { useState, useEffect, useCallback } from "react";
import { RefreshCw, ShieldAlert, Shield, Activity, Zap, Clock, Database } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const RANGES = [
  { key: "5m",  label: "5 min" },
  { key: "1h",  label: "1 hora" },
  { key: "12h", label: "12 h" },
  { key: "1d",  label: "1 día" },
  { key: "7d",  label: "1 semana" },
  { key: "30d", label: "1 mes" },
];

const ATK_COLORS = {
  "DoS/DDoS":    "#f85149", "DDoS":        "#f85149",
  "SYN Flood":   "#ff6b35", "Flood":       "#ff6b35",
  "Port Scan":   "#a371f7", "UDP Scan":    "#a371f7", "ICMP Scan": "#a371f7",
  "Brute Force": "#d29922", "Web Attack":  "#58a6ff",
  "DNS Abuse":   "#39d353", "Exfiltración":"#f85149", "Anomalía":  "#8b949e",
};

function fmtBytes(n) {
  if (!n) return "0 B";
  if (n >= 1_073_741_824) return `${(n/1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576)     return `${(n/1_048_576).toFixed(1)} MB`;
  if (n >= 1024)          return `${(n/1024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtPct(v) { return v != null ? `${(v * 100).toFixed(1)}%` : "—"; }

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color, bg }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: bg ?? "#050d14", border: `1px solid ${color}22` }}>
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg" style={{ background: `${color}18` }}>
          <Icon size={12} style={{ color }}/>
        </div>
        <span className="text-[9px] uppercase tracking-wider" style={{ color: "#545d68" }}>{label}</span>
      </div>
      <p className="text-[24px] font-bold font-mono mt-1" style={{ color }}>{value}</p>
      {sub && <p className="text-[9px]" style={{ color: "#3a4455" }}>{sub}</p>}
    </div>
  );
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
function BarChart({ data, colorKey = "attacks", label = "" }) {
  if (!data?.length) return <EmptyChart label={label}/>;
  const max = Math.max(...data.map(d => d[colorKey] || d.total || 1), 1);
  return (
    <div className="flex flex-col gap-1 h-full">
      {label && <p className="text-[9px] uppercase tracking-wider mb-2" style={{ color: "#545d68" }}>{label}</p>}
      <div className="flex items-end gap-px flex-1" style={{ minHeight: 60 }}>
        {data.map((d, i) => {
          const hAtk = ((d.attacks || 0) / max) * 100;
          const hNrm = ((d.normal  || 0) / max) * 100;
          return (
            <div key={i} className="flex-1 flex flex-col justify-end gap-px" title={`${d.label ?? ""}\nAtaques: ${d.attacks ?? 0}\nNormal: ${d.normal ?? 0}`}>
              {hAtk > 0 && (
                <div style={{ height: `${hAtk}%`, minHeight: hAtk > 0 ? 1 : 0,
                  background: "#f85149", borderRadius: "1px 1px 0 0", opacity: 0.85 }}/>
              )}
              {hNrm > 0 && (
                <div style={{ height: `${hNrm}%`, minHeight: hNrm > 0 ? 1 : 0,
                  background: "#3fb950", borderRadius: "1px 1px 0 0", opacity: 0.5 }}/>
              )}
              {hAtk === 0 && hNrm === 0 && (
                <div style={{ height: "1px", background: "#1c2333" }}/>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[7px] font-mono" style={{ color: "#3a4455" }}>
          {data[0]?.label ?? ""}
        </span>
        <span className="text-[7px] font-mono" style={{ color: "#3a4455" }}>
          {data[data.length - 1]?.label ?? ""}
        </span>
      </div>
    </div>
  );
}

function EmptyChart({ label }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-1" style={{ minHeight: 60 }}>
      {label && <p className="text-[9px] uppercase tracking-wider" style={{ color: "#545d68" }}>{label}</p>}
      <p className="text-[9px]" style={{ color: "#3a4455" }}>Sin datos en este rango</p>
    </div>
  );
}

// ── Horizontal bar ────────────────────────────────────────────────────────────
function HBar({ label, count, max, color }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono w-28 truncate" style={{ color: "#8b949e" }} title={label}>{label}</span>
      <div className="flex-1 rounded-full overflow-hidden" style={{ background: "#0d1117", height: 5 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 9999, transition: "width 0.4s" }}/>
      </div>
      <span className="text-[9px] font-bold font-mono w-8 text-right" style={{ color }}>{count}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Analytics() {
  const [range,    setRange]    = useState("1h");
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [lastFetch,setLastFetch]= useState(null);
  const [autoRef,  setAutoRef]  = useState(true);

  const load = useCallback(async (r = range) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/analytics/${r}`);
      const d   = await res.json();
      setData(d);
      setLastFetch(new Date());
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(range); }, [range]);

  // Auto-refresh each 15s when in small ranges
  useEffect(() => {
    if (!autoRef) return;
    const iv = setInterval(() => load(range), 15000);
    return () => clearInterval(iv);
  }, [range, autoRef, load]);

  const hasData = data && data.total > 0;

  return (
    <div className="flex flex-col gap-4">

      {/* ── Header toolbar ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Range buttons */}
        <div className="flex rounded-lg overflow-hidden shrink-0"
          style={{ border: "1px solid #1c2333" }}>
          {RANGES.map(({ key, label }) => (
            <button key={key} onClick={() => setRange(key)}
              className="px-3 py-1.5 text-[10px] font-semibold transition"
              style={{
                background: range === key ? "rgba(88,166,255,0.12)" : "transparent",
                color:      range === key ? "#58a6ff" : "#545d68",
                borderRight: key !== "30d" ? "1px solid #1c2333" : "none",
              }}>
              {label}
            </button>
          ))}
        </div>

        <button onClick={() => load(range)} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] transition"
          style={{ background: "rgba(88,166,255,0.07)", border: "1px solid #58a6ff22", color: "#58a6ff" }}>
          <RefreshCw size={11} className={loading ? "animate-spin" : ""}/>
          Actualizar
        </button>

        <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: "#545d68" }}>
          <input type="checkbox" checked={autoRef} onChange={e => setAutoRef(e.target.checked)}
            className="w-3 h-3 accent-blue-500"/>
          Auto (15s)
        </label>

        {lastFetch && (
          <span className="ml-auto text-[9px] flex items-center gap-1" style={{ color: "#3a4455" }}>
            <Clock size={9}/> {lastFetch.toLocaleTimeString()}
          </span>
        )}
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center py-10 gap-2" style={{ color: "#545d68" }}>
          <RefreshCw size={14} className="animate-spin"/> Cargando analytics…
        </div>
      )}

      {!loading && !hasData && (
        <div className="rounded-xl p-8 text-center"
          style={{ background: "#050d14", border: "1px dashed #1c2333" }}>
          <Database size={24} className="mx-auto mb-3" style={{ color: "#3a4455" }}/>
          <p className="text-[12px] font-semibold mb-1" style={{ color: "#545d68" }}>
            Sin datos para "{RANGES.find(r => r.key === range)?.label}"
          </p>
          <p className="text-[10px]" style={{ color: "#3a4455" }}>
            Inicia una captura en Monitor IDS para comenzar a registrar eventos.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* ── KPIs ── */}
          <div className="grid grid-cols-5 gap-3">
            <KpiCard icon={Activity}   label="Conexiones"   value={data.total.toLocaleString()}           color="#58a6ff"/>
            <KpiCard icon={ShieldAlert}label="Ataques"      value={data.attacks.toLocaleString()}         color="#f85149"/>
            <KpiCard icon={Shield}     label="Normales"     value={data.normal.toLocaleString()}          color="#3fb950"/>
            <KpiCard icon={Zap}        label="Attack Rate"  value={fmtPct(data.attack_rate)}              color="#d29922"/>
            <KpiCard icon={Database}   label="Bytes totales"value={fmtBytes(data.total_bytes)}            color="#a371f7"/>
          </div>

          {/* ── Segunda fila KPIs ── */}
          <div className="grid grid-cols-4 gap-3">
            {[
              ["Confianza media (ataques)", data.avg_conf_attack != null ? fmtPct(data.avg_conf_attack) : "—", "#f85149"],
              ["Confianza media (normal)",  data.avg_conf_normal != null ? fmtPct(data.avg_conf_normal) : "—", "#3fb950"],
              ["Tipos de ataque únicos",    data.attack_types?.length ?? 0, "#a371f7"],
              ["Dataset activo",            Object.keys(data.datasets ?? {}).join(", ") || "—", "#58a6ff"],
            ].map(([label, value, color]) => (
              <div key={label} className="rounded-xl p-3"
                style={{ background: "#050d14", border: "1px solid #1c2333" }}>
                <p className="text-[8px] uppercase tracking-wider mb-1" style={{ color: "#3a4455" }}>{label}</p>
                <p className="text-[16px] font-bold font-mono" style={{ color }}>{value}</p>
              </div>
            ))}
          </div>

          {/* ── Timeline + Tipos de ataque ── */}
          <div className="grid grid-cols-3 gap-3">

            {/* Timeline */}
            <div className="col-span-2 rounded-xl p-4"
              style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#cdd9e5" }}>
                  Actividad en el tiempo
                </p>
                <div className="flex items-center gap-3 text-[8px]">
                  <span className="flex items-center gap-1"><span style={{width:8,height:8,background:"#f85149",display:"inline-block",borderRadius:2}}/> Ataques</span>
                  <span className="flex items-center gap-1" style={{color:"#545d68"}}><span style={{width:8,height:8,background:"#3fb950",display:"inline-block",borderRadius:2}}/> Normal</span>
                </div>
              </div>
              <div style={{ height: 100 }}>
                <BarChart data={data.timeline} label=""/>
              </div>
            </div>

            {/* Tipos de ataque */}
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#f85149" }}>
                Tipos de ataque
              </p>
              {data.attack_types?.length ? (
                <div className="flex flex-col gap-2">
                  {data.attack_types.slice(0, 7).map(({ type, count }) => (
                    <HBar key={type} label={type} count={count}
                      max={data.attack_types[0].count}
                      color={ATK_COLORS[type] ?? "#f85149"}/>
                  ))}
                </div>
              ) : (
                <p className="text-[9px]" style={{ color: "#3a4455" }}>Sin ataques en este rango</p>
              )}
            </div>
          </div>

          {/* ── Protocolos + Servicios + IPs ── */}
          <div className="grid grid-cols-3 gap-3">

            {/* Protocolos */}
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#a371f7" }}>
                Protocolos
              </p>
              <div className="flex flex-col gap-2">
                {data.protocols?.slice(0, 6).map(({ proto, count }) => (
                  <HBar key={proto} label={(proto ?? "?").toUpperCase()} count={count}
                    max={data.protocols[0]?.count ?? 1} color="#a371f7"/>
                ))}
              </div>
            </div>

            {/* Servicios atacados */}
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#d29922" }}>
                Servicios atacados
              </p>
              {data.top_services?.length ? (
                <div className="flex flex-col gap-2">
                  {data.top_services.slice(0, 6).map(({ service, count }) => (
                    <HBar key={service} label={service ?? "other"} count={count}
                      max={data.top_services[0]?.count ?? 1} color="#d29922"/>
                  ))}
                </div>
              ) : (
                <p className="text-[9px]" style={{ color: "#3a4455" }}>Sin ataques registrados</p>
              )}
            </div>

            {/* Top IPs origen */}
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#f85149" }}>
                IPs atacantes (src)
              </p>
              {data.top_src_ips?.length ? (
                <div className="flex flex-col gap-2">
                  {data.top_src_ips.slice(0, 6).map(({ ip, count }) => (
                    <HBar key={ip} label={ip ?? "?"} count={count}
                      max={data.top_src_ips[0]?.count ?? 1} color="#f85149"/>
                  ))}
                </div>
              ) : (
                <p className="text-[9px]" style={{ color: "#3a4455" }}>Sin ataques registrados</p>
              )}
            </div>
          </div>

          {/* ── Top destinos ── */}
          {data.top_dst_ips?.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: "#050d14", border: "1px solid #1c2333" }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: "#58a6ff" }}>
                IPs destino más atacadas
              </p>
              <div className="grid grid-cols-2 gap-2">
                {data.top_dst_ips.map(({ ip, count }) => (
                  <HBar key={ip} label={ip ?? "?"} count={count}
                    max={data.top_dst_ips[0]?.count ?? 1} color="#58a6ff"/>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
