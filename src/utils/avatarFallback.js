function encodeLabel(value) {
  return encodeURIComponent(String(value || "").trim() || "User");
}

const COLORS = {
  user: "334155", // slate-700
  athlete: "0f766e", // teal-700
  coach: "1d4ed8", // blue-700
  team: "7c3aed", // violet-600
};

export function avatarFallback({ label = "User", type = "user", size = 128 } = {}) {
  const background = COLORS[type] || COLORS.user;
  const safeSize = Number.isFinite(Number(size)) ? Math.max(64, Number(size)) : 128;
  return `https://ui-avatars.com/api/?background=${background}&color=ffffff&size=${safeSize}&name=${encodeLabel(label)}`;
}

export default avatarFallback;

