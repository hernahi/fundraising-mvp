import { useFirebase } from '../context/FirebaseProvider';

export default function ModeBadge() {
  const { useFirebase: isLive } = useFirebase();

  return (
    <div className="fixed top-3 right-80 z-50">
      <span
        className={`px-3 py-1 text-xs font-semibold rounded-full shadow-md transition-all duration-300 ${
          isLive
            ? 'bg-yellow-400 text-slate-900'
            : 'bg-slate-700 text-yellow-400 border border-yellow-400'
        }`}
      >
        {isLive ? '📡 Live Firebase' : '🧩 Mock Mode'}
      </span>
    </div>
  );
}
