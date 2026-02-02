// src/utils/uploadAthleteImage.js
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../firebase";

/**
 * Upload athlete image to Firebase Storage
 * Returns a public download URL
 */
export async function uploadAthleteImage(file, athleteId) {
  if (!file) return null;

  const path = `athletes/${athleteId}/${file.name}`;
  const storageRef = ref(storage, path);

  await uploadBytes(storageRef, file);

  const downloadUrl = await getDownloadURL(storageRef);
  return downloadUrl;
}
