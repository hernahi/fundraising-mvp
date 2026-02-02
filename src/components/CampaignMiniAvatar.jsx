
import AvatarCore from "./AvatarCore";
export default function CampaignMiniAvatar({ name, imgUrl }) {
  return <AvatarCore name={name} src={imgUrl} size={36} />;
}
