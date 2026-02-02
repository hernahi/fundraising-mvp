
import AvatarCore from "./AvatarCore";
export default function CoachMiniAvatar({ coach }) {
  if (!coach) return null;
  return <AvatarCore name={coach.name} src={coach.photoURL || coach.imgUrl} size={32} />;
}
