export default function CardStatBadge({ label, value }) {
  return (
    <div className="px-2 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-medium">
      <span className="opacity-70">{label}:</span> <span>{value}</span>
    </div>
  );
}
