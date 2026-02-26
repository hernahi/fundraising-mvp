export default function AnalyticsCard({ title, value, subtext, children, onClick }) {
  const interactive = typeof onClick === "function";
  const baseClass =
    "rounded-xl border p-5 text-left w-full";

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} bg-gradient-to-b from-white to-slate-50/70 border-slate-300 shadow-sm cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300`}
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="text-sm text-slate-600">{title}</div>
          <span className="text-[11px] font-medium text-slate-500 rounded-full border border-slate-300 px-2 py-0.5">
            View details
          </span>
        </div>
        <div className="text-2xl font-semibold text-slate-900">{value}</div>
        {subtext && <div className="text-xs text-slate-400 mt-1">{subtext}</div>}
        {children}
      </button>
    );
  }

  return (
    <div className={`${baseClass} bg-white border-slate-200 shadow-sm`}>
      <div className="text-sm text-slate-500 mb-1">{title}</div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      {subtext && <div className="text-xs text-slate-400 mt-1">{subtext}</div>}
      {children}
    </div>
  );
}
