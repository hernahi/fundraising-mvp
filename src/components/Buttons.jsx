export function PrimaryButton({ children, onClick, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl bg-yellow-400 text-slate-900 font-semibold transition-all duration-300 hover:bg-yellow-300 hover:shadow-[0_0_12px_rgba(250,204,21,0.5)] ${className}`}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ children, onClick, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl border border-yellow-400 text-yellow-400 font-semibold transition-all duration-300 hover:bg-yellow-400 hover:text-slate-900 hover:shadow-[0_0_10px_rgba(250,204,21,0.5)] ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, className = '' }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-slate-300 rounded-xl transition-all duration-300 hover:text-yellow-400 hover:bg-slate-800 hover:shadow-[0_0_6px_rgba(250,204,21,0.25)] ${className}`}
    >
      {children}
    </button>
  );
}
