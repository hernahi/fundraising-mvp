
import AvatarCore from "./AvatarCore";
export default function AvatarCircle({ name, imgUrl, size = 48 }) {
  return <AvatarCore name={name} src={imgUrl} size={size} />;
}
