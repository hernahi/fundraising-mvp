
import safeImageURL from "../utils/safeImage";

export default function AvatarCore({ src, name = "", size = 48, className = "" }) {
  const sizeClass = {
    24: "w-6 h-6",
    32: "w-8 h-8",
    40: "w-10 h-10",
    48: "w-12 h-12",
    64: "w-16 h-16",
  }[size] || "w-12 h-12";

  const initials = name
    ? name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase()
    : "?";

  const srcFinal = safeImageURL(src);

  return (
    <div className={`inline-flex items-center justify-center rounded-full bg-slate-300 text-slate-700 font-semibold ${sizeClass} ${className}`}>
      {srcFinal ? (
        <img src={srcFinal} alt={name} className="rounded-full w-full h-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
