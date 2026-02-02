export function Card({ title, value, children }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5 shadow-[0_0_12px_rgba(250,204,21,0.1)] hover:shadow-[0_0_20px_rgba(250,204,21,0.25)] transition-all duration-300">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-yellow-400 font-semibold text-sm uppercase tracking-wider">{title}</h3>
        {children && <div className="text-slate-400 text-xs">{children}</div>}
      </div>
      <div className="text-3xl font-bold text-slate-100">{value}</div>
    </div>
  );
}
