// src/utils/uploadAthleteImage.js
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase/config";

/**
 * Upload athlete image to Firebase Storage
 * Returns a public download URL
 */
export async function uploadAthleteImage(file, athleteId) {
  if (!file) return null;

  const safeName = String(file.name || "profile-image")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .toLowerCase();
  const path = `athletes/${athleteId}/profile-${Date.now()}-${safeName}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, file);

  const downloadUrl = await getDownloadURL(storageRef);
  return downloadUrl;
}
