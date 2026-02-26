export default function AnalyticsCard({ title, value, subtext, children, onClick }) {
  const interactive = typeof onClick === "function";
  const baseClass =
    "bg-white rounded-xl border border-slate-200 p-5 shadow-sm text-left w-full";

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} transition hover:border-slate-300 hover:shadow focus:outline-none focus:ring-2 focus:ring-slate-300`}
      >
        <div className="text-sm text-slate-500 mb-1">{title}</div>
        <div className="text-2xl font-semibold text-slate-900">{value}</div>
        {subtext && <div className="text-xs text-slate-400 mt-1">{subtext}</div>}
        {children}
      </button>
    );
  }

  return (
    <div className={baseClass}>
      <div className="text-sm text-slate-500 mb-1">{title}</div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      {subtext && <div className="text-xs text-slate-400 mt-1">{subtext}</div>}
      {children}
    </div>
  );
}
