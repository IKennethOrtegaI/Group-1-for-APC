import { useEffect, useState } from "react";
import { getAlerts } from "../api/client";
import { ShieldAlert, ShieldCheck, MoreHorizontal } from "lucide-react";

export default function AlertsFeed({ refreshKey }) {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    getAlerts(40).then((r) => setAlerts(r.data)).catch(() => {});
    const iv = setInterval(() => {
      getAlerts(40).then((r) => setAlerts(r.data)).catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, [refreshKey]);

  const fmt = (dt) => {
    if (!dt) return "";
    const d = new Date(dt);
    return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "#8b949e" }}>
          Feed de Alertas Recientes
        </h3>
        <MoreHorizontal size={14} style={{ color: "#8b949e" }} className="cursor-pointer" />
      </div>

      {!alerts.length ? (
        <div className="flex-1 flex items-center justify-center text-[12px]" style={{ color: "#484f58" }}>
          Sin alertas — entrena un modelo primero
        </div>
      ) : (
        <div className="space-y-1.5 overflow-y-auto flex-1 pr-1">
          {alerts.map((a) => {
            const isAttack = a.prediction === "Attack";
            return (
              <div key={a.id} className="fade-in flex items-start gap-2.5 px-3 py-2 rounded-lg text-[12px]"
                style={{ background: isAttack ? "rgba(248,81,73,0.06)" : "rgba(63,185,80,0.06)",
                         border: `1px solid ${isAttack ? "rgba(248,81,73,0.15)" : "rgba(63,185,80,0.12)"}` }}>
                {isAttack
                  ? <ShieldAlert size={13} className="shrink-0 mt-0.5 alert-pulse" style={{ color: "#f85149" }} />
                  : <ShieldCheck size={13} className="shrink-0 mt-0.5" style={{ color: "#3fb950" }} />}
                <div className="flex-1 min-w-0">
                  <span style={{ color: isAttack ? "#f85149" : "#3fb950", fontWeight: 600 }}>
                    {isAttack ? "ALERTA" : "INFO"}
                  </span>
                  <span style={{ color: "#8b949e" }}>
                    {isAttack
                      ? ` Intento de ataque detectado — Confianza: ${(a.confidence * 100).toFixed(1)}%`
                      : ` Tráfico legítimo verificado`}
                  </span>
                  <span className="ml-1 text-[10px]" style={{ color: "#484f58" }}>
                    ({a.model_name === "random_forest" ? "Random Forest" : "XGBoost"})
                  </span>
                </div>
                <span className="text-[10px] shrink-0" style={{ color: "#484f58" }}>{fmt(a.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
