
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function ThemedLineChart({ data = [], dataKey, label }) {
  if (!data.length) return <div className="text-slate-500 p-4 text-sm">No data available</div>;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-4 shadow-lg">
      <h3 className="text-yellow-400 font-semibold text-sm mb-3">{label}</h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke="#94a3b8" />
          <YAxis stroke="#94a3b8" />
          <Tooltip />
          <Line type="monotone" dataKey={dataKey} stroke="#facc15" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
