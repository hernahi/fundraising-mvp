import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/config";

function withTimeout(promise, timeoutMs = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Team image upload timed out.")), timeoutMs);
    }),
  ]);
}

export async function uploadTeamImage(file, teamId) {
  if (!file) return null;

  const safeName = String(file.name || "team-image")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
  const path = `teams/${teamId}/avatar-${Date.now()}-${safeName}`;
  const storageRef = ref(storage, path);

  await withTimeout(uploadBytes(storageRef, file));
  return await withTimeout(getDownloadURL(storageRef));
}
