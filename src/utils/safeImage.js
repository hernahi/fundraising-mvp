const FALLBACK_AVATAR =
  "https://ui-avatars.com/api/?background=0f172a&color=ffffff&size=256&name=Team";

function safeImageURL(url, fallback = FALLBACK_AVATAR) {
  // No URL provided → fallback
  if (!url || typeof url !== "string") {
    return fallback;
  }

  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.href;
  } catch {
    return fallback;
  }
}
export { safeImageURL };
export default safeImageURL;
