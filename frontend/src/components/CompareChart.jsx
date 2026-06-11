import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { compareModels } from "../api/client";

const METRIC_LABELS = { accuracy: "Accuracy", f1_score: "F1 Score", precision: "Precisión", recall: "Recall" };

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "#161b22", border: "1px solid #30363d" }}>
      <p className="font-semibold mb-1" style={{ color: "#e6edf3" }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.fill }}>{p.name === "random_forest" ? "Random Forest" : "XGBoost"}: <strong>{p.value}%</strong></p>
      ))}
    </div>
  );
};

export default function CompareChart({ dataset, refreshKey }) {
  const [data, setData] = useState([]);

  useEffect(() => {
    compareModels(dataset).then((res) => {
      const comparison = res.data.comparison;
      if (!comparison?.length) return;
      const rows = Object.keys(METRIC_LABELS).map((metric) => ({
        metric: METRIC_LABELS[metric],
        ...Object.fromEntries(comparison.map((m) => [m.model_name, parseFloat((m[metric] * 100).toFixed(2))])),
      }));
      setData(rows);
    }).catch(() => {});
  }, [dataset, refreshKey]);

  if (!data.length) return (
    <div className="flex items-center justify-center h-52 text-[12px]" style={{ color: "#484f58" }}>
      Sin datos — entrena ambos modelos primero
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -15, bottom: 5 }} barGap={3}>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" vertical={false} />
        <XAxis dataKey="metric" tick={{ fill: "#8b949e", fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[70, 100]} tick={{ fill: "#8b949e", fontSize: 10 }} axisLine={false} tickLine={false} unit="%" />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Legend wrapperStyle={{ fontSize: 11, color: "#8b949e", paddingTop: 8 }}
          formatter={(val) => val === "random_forest" ? "Random Forest" : "XGBoost"} />
        <Bar dataKey="random_forest" name="random_forest" fill="#1d6fe6" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="xgboost" name="xgboost" fill="#d29922" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
