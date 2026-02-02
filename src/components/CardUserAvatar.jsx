
import AvatarCore from "./AvatarCore";
export default function CardUserAvatar({ user }) {
  if (!user) return null;
  return (
    <div className="flex items-center gap-3">
      <AvatarCore name={user.name} src={user.photoURL || user.imgUrl} size={48} />
      <div>
        <div className="font-semibold">{user.name}</div>
        {user.email && <div className="text-sm text-slate-500">{user.email}</div>}
      </div>
    </div>
  );
}
