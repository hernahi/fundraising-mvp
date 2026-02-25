import safeImageURL from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";

export default function AvatarCircle({
  src,
  imgUrl,
  name,
  email,
  size = 32,
  entity = "user",
}) {
  const numericSize =
    typeof size === "string"
      ? size === "xl"
        ? 72
        : size === "lg"
        ? 56
        : size === "md"
        ? 40
        : 32
      : Number(size || 32);
  const label = name || email || "User";
  const fallback = avatarFallback({ label, type: entity, size: numericSize * 3 });
  const imageUrl = safeImageURL(src || imgUrl, fallback);
  const alt = `${entity} avatar`;

  return (
      <img
        src={imageUrl}
      alt={alt}
      className="rounded-full object-cover"
      style={{ width: numericSize, height: numericSize }}
    />
  );
}
