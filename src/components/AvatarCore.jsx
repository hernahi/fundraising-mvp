
import safeImageURL from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";

export default function AvatarCore({
  src,
  name = "",
  size = 48,
  className = "",
  entity = "user",
}) {
  const numericSize = Number(size) > 0 ? Number(size) : 48;

  const initials = name
    ? name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase()
    : "?";

  const fallback = avatarFallback({
    label: name || initials,
    type: entity,
    size: numericSize * 3,
  });
  const srcFinal = safeImageURL(src, fallback);

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full bg-slate-300 text-slate-700 font-semibold ${className}`}
      style={{ width: numericSize, height: numericSize }}
    >
      {srcFinal ? (
        <img src={srcFinal} alt={name} className="rounded-full w-full h-full object-cover" />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
