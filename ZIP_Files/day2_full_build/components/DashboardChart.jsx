
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

export default function DashboardChart({ data = [] }) {
  if (!data.length) return <div className="text-slate-500 p-4 text-sm">No chart data</div>;

  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data}>
          <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke="#94a3b8" />
          <YAxis stroke="#94a3b8" />
          <Tooltip />
          <Bar dataKey="donations" barSize={20} fill="#facc15" />
          <Line type="monotone" dataKey="cumulative" stroke="#eab308" strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
