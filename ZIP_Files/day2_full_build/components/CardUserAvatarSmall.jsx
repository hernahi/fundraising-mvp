
import AvatarCore from "./AvatarCore";
export default function CardUserAvatarSmall({ user }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-2">
      <AvatarCore name={user.name} src={user.photoURL || user.imgUrl} size={32} />
      <div className="text-sm font-medium">{user.name}</div>
    </div>
  );
}
