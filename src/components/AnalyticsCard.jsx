export default function AnalyticsCard({ title, value, subtext }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="text-sm text-slate-500 mb-1">{title}</div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      {subtext && (
        <div className="text-xs text-slate-400 mt-1">{subtext}</div>
      )}
    </div>
  );
}