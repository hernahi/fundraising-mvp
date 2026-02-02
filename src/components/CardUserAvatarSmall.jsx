import AvatarCore from "./AvatarCore";

export default function CardUserAvatarSmall({ user = {}, size = 32, className = "" }) {
  const {
    name = "",
    displayName = "",
    fullName = "",
    firstName = "",
    lastName = "",
    photoURL,
    avatar,
    imgUrl,
    image,
    profileImage,
  } = user;

  // Normalize all possible name fields
  const finalName =
    name ||
    displayName ||
    fullName ||
    `${firstName || ""} ${lastName || ""}`.trim() ||
    "User";

  // Normalize all possible image fields
  const finalSrc =
    photoURL ||
    avatar ||
    imgUrl ||
    image ||
    profileImage ||
    "";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <AvatarCore src={finalSrc} name={finalName} size={size} />
      <span className="text-sm font-medium text-slate-800 truncate">
        {finalName}
      </span>
    </div>
  );
}
