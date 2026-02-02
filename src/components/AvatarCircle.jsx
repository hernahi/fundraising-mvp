import safeImageURL from "../utils/safeImage";

export default function AvatarCircle({
  src,
  email,
  size = 32,
}) {
  const imageUrl = safeImageURL(src);

  // Fallback: letter avatar
  if (!imageUrl) {
    const letter = email?.[0]?.toUpperCase() || "?";

    return (
      <div
        className="rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-semibold"
        style={{ width: size, height: size }}
        aria-label="avatar fallback"
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt="User avatar"
      className="rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  );
}
