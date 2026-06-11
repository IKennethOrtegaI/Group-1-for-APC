import { LineChart, Line, ResponsiveContainer } from "recharts";

const COLOR_MAP = {
  blue:   { border: "#1d6fe6", text: "#58a6ff", bg: "rgba(29,111,230,0.08)", spark: "#58a6ff" },
  red:    { border: "#da3633", text: "#f85149", bg: "rgba(218,54,51,0.08)",  spark: "#f85149" },
  green:  { border: "#238636", text: "#3fb950", bg: "rgba(35,134,54,0.08)",  spark: "#3fb950" },
  yellow: { border: "#9e6a03", text: "#d29922", bg: "rgba(158,106,3,0.08)",  spark: "#d29922" },
};

export default function StatCard({ title, value, subtitle, color = "blue", icon: Icon, sparkData = [] }) {
  const c = COLOR_MAP[color];
  const data = sparkData.length ? sparkData : Array.from({ length: 12 }, (_, i) => ({ v: Math.random() * 40 + 30 }));

  return (
    <div className="rounded-xl p-5 flex flex-col gap-2 relative overflow-hidden"
      style={{ background: c.bg, border: `1px solid ${c.border}30` }}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.15em] font-semibold" style={{ color: "#8b949e" }}>{title}</p>
          <p className="text-[28px] font-bold leading-tight mt-1" style={{ color: c.text }}>{value}</p>
          {subtitle && <p className="text-[11px] mt-0.5" style={{ color: "#8b949e" }}>{subtitle}</p>}
        </div>
        {Icon && (
          <div className="p-2 rounded-lg mt-1" style={{ background: `${c.border}20` }}>
            <Icon size={18} style={{ color: c.text }} />
          </div>
        )}
      </div>
      <div className="h-10 -mx-1 sparkline-wrapper">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line type="monotone" dataKey="v" stroke={c.spark} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
