import { useState, useRef, useEffect } from "react";
import { Wifi, WifiOff, Search, Activity, Shield, ShieldAlert, Loader2, Globe } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const THREAT_COLOR = { LOW: "#3fb950", MEDIUM: "#d29922", HIGH: "#f85149" };
const THREAT_LABEL = { LOW: "NORMAL", MEDIUM: "SOSPECHOSO", HIGH: "AMENAZA" };

function ProbeRow({ probe }) {
  const ok  = probe.http?.ok;
  const att = probe.prediction === "Attack";
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-white/5 text-xs font-mono">
      <span className="text-white/40 w-4">#{probe.probe}</span>
      <span className={ok ? "text-green-400" : "text-red-400"}>
        {ok ? "●" : "○"} {probe.http?.status_code ?? "—"}
      </span>
      <span className="text-white/60">{probe.tcp?.latency_ms ? `${probe.tcp.latency_ms}ms` : "timeout"}</span>
      <span className="text-white/50">{probe.http?.duration_ms}ms HTTP</span>
      <span className="text-white/50">{probe.http?.content_bytes ? `${(probe.http.content_bytes/1024).toFixed(1)}KB` : "0KB"}</span>
      {probe.prediction && (
        <span style={{ color: att ? "#f85149" : "#3fb950" }} className="ml-auto">
          {att ? "⚠ ATTACK" : "✓ NORMAL"}{" "}
          <span className="text-white/30">{(probe.confidence * 100).toFixed(1)}%</span>
        </span>
      )}
    </div>
  );
}

export default function NetworkMonitor() {
  const [target,   setTarget]   = useState("");
  const [count,    setCount]    = useState(5);
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState(null);
  const [autoMode, setAutoMode] = useState(false);
  const timerRef = useRef(null);

  const run = async (t = target, c = count) => {
    if (!t.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/monitor/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: t.trim(), count: c }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${res.status}`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoMode && target.trim()) {
      timerRef.current = setInterval(() => run(), 30_000);
      return () => clearInterval(timerRef.current);
    }
    clearInterval(timerRef.current);
  }, [autoMode, target]);

  const summary = result?.summary;
  const level   = summary?.threat_level ?? "LOW";

  return (
    <div className="h-full flex flex-col gap-4 text-sm">
      {/* Input row */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={target}
            onChange={e => setTarget(e.target.value)}
            onKeyDown={e => e.key === "Enter" && run()}
            placeholder="IP o URL — ej. 8.8.8.8  /  google.com  /  https://unmsm.edu.pe"
            className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded text-white placeholder-white/20 focus:outline-none focus:border-[#58a6ff]/50 text-xs font-mono"
          />
        </div>
        <select
          value={count}
          onChange={e => setCount(Number(e.target.value))}
          className="bg-white/5 border border-white/10 rounded px-2 text-white/70 text-xs"
        >
          {[1,3,5,10].map(n => <option key={n} value={n}>{n} sondeos</option>)}
        </select>
        <button
          onClick={() => run()}
          disabled={loading || !target.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold bg-[#58a6ff]/20 border border-[#58a6ff]/40 text-[#58a6ff] hover:bg-[#58a6ff]/30 disabled:opacity-40 transition"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
          {loading ? "Analizando…" : "Escanear"}
        </button>
        <button
          onClick={() => setAutoMode(v => !v)}
          className={`flex items-center gap-1 px-3 py-2 rounded text-xs border transition ${
            autoMode
              ? "bg-green-500/20 border-green-500/40 text-green-400"
              : "bg-white/5 border-white/10 text-white/40"
          }`}
          title="Repetir cada 30s"
        >
          <Activity size={13} />
          Auto
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-400 text-xs font-mono">
          ✗ {error}
        </div>
      )}

      {loading && !result && (
        <div className="flex-1 flex items-center justify-center text-white/30 gap-3">
          <Loader2 size={20} className="animate-spin" />
          <span className="font-mono text-xs">Sondeando {target}…</span>
        </div>
      )}

      {result && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="IP resuelta"    value={result.resolved_ip}              color="#58a6ff" />
            <Card label="Latencia TCP"   value={summary?.avg_latency_ms ? `${summary.avg_latency_ms} ms` : "—"} color="#3fb950" />
            <Card label="Tiempo HTTP"    value={summary?.avg_duration_ms ? `${summary.avg_duration_ms} ms` : "—"} color="#a371f7" />
            <Card label="Pérdida pkt"   value={`${summary?.packet_loss_pct ?? 0}%`}  color="#d29922" />
          </div>

          {/* Threat indicator */}
          <div
            className="rounded p-4 border flex items-center gap-4"
            style={{
              background: `${THREAT_COLOR[level]}11`,
              borderColor: `${THREAT_COLOR[level]}44`,
            }}
          >
            {level === "LOW"
              ? <Shield size={32} style={{ color: THREAT_COLOR[level] }} />
              : <ShieldAlert size={32} style={{ color: THREAT_COLOR[level] }} />
            }
            <div>
              <div className="text-xs text-white/40 font-mono">NIVEL DE AMENAZA</div>
              <div className="text-xl font-bold font-mono" style={{ color: THREAT_COLOR[level] }}>
                {THREAT_LABEL[level]}
              </div>
              <div className="text-xs text-white/40 mt-1">
                {summary?.attacks_detected ?? 0} de {summary?.total_probes} sondeos clasificados como Attack
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-xs text-white/30 font-mono">OBJETIVO</div>
              <div className="text-sm font-mono text-white/70">{result.host}</div>
              <div className="text-xs text-white/30">:{result.port}</div>
            </div>
          </div>

          {/* Probes table */}
          <div className="flex-1 overflow-auto rounded border border-white/5 bg-black/20 p-3">
            <div className="flex gap-3 text-[10px] font-mono text-white/20 uppercase pb-1 border-b border-white/5 mb-1">
              <span className="w-4">#</span>
              <span>Status</span>
              <span>TCP</span>
              <span>HTTP</span>
              <span>Tamaño</span>
              <span className="ml-auto">Predicción</span>
            </div>
            {result.probes.map(p => <ProbeRow key={p.probe} probe={p} />)}
          </div>

          {/* Note when no model */}
          {result.probes[0]?.prediction === null && (
            <p className="text-xs text-white/30 font-mono text-center">
              * Entrena un modelo primero para obtener predicciones ML
            </p>
          )}
        </>
      )}

      {!result && !loading && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/20">
          <Wifi size={40} />
          <p className="text-xs font-mono text-center">
            Ingresa una IP o URL y haz clic en <strong className="text-white/40">Escanear</strong><br />
            para monitorear tráfico real con el IDS
          </p>
          <div className="text-[10px] font-mono text-white/10 text-center space-y-0.5">
            <div>8.8.8.8 — Google DNS</div>
            <div>cloudflare.com — Cloudflare</div>
            <div>unmsm.edu.pe — UNMSM</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, color }) {
  return (
    <div className="rounded p-3 border border-white/5 bg-white/3">
      <div className="text-[10px] text-white/30 font-mono uppercase">{label}</div>
      <div className="text-base font-bold font-mono mt-0.5" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
