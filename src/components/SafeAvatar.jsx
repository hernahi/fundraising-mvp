export default function SafeAvatar({ name = "", imgUrl = "", size = 40, className = "" }) {
  const isSafe = imgUrl && (imgUrl.startsWith("https://") || imgUrl.startsWith("http://"));
  const display = isSafe ? imgUrl : "";
  const initials = name ? name[0].toUpperCase() : "?";
  return (
    <div
      style={{ width: size, height: size }}
      className={"bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-600 overflow-hidden " + className}
    >
      {display ? <img src={display} alt={name} className="w-full h-full object-cover" /> : initials}
    </div>
  );
}
