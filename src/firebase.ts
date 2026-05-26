import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import firebaseConfigStatic from '../firebase-applet-config.json';

// Prefer Vite env var VITE_FIREBASE_CONFIG_JSON (set at build time) for custom configs.
// Fallback to the committed `firebase-applet-config.json` when env is not provided.
let firebaseConfig: any = null;
try {
  const envJson = (import.meta as any).env?.VITE_FIREBASE_CONFIG_JSON;
  if (envJson) {
    firebaseConfig = JSON.parse(envJson);
  } else {
    firebaseConfig = firebaseConfigStatic;
  }
} catch (e) {
  console.error('Failed to load Firebase config:', e);
  throw e;
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firestore removed: DB access now goes through the server API (Postgres)
