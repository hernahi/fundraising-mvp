// src/firebase/config.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import {
  getAuth,
  GoogleAuthProvider,
} from "firebase/auth";

// --- Firebase config (from .env) ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// --- Initialize app ---
const app = initializeApp(firebaseConfig);

// --- Auth ---
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// --- Firestore ---
export const db = getFirestore(app);

// --- Cloud Functions ---
export const functions = getFunctions(app, "us-central1");

// --- Storage ---
export const storage = getStorage(app);

// Default export
export default app;
