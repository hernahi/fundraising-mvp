// scripts/toggleEnv.js
import fs from "fs";
import path from "path";

const envPath = path.resolve(process.cwd(), ".env");

// Read current .env file
let env = fs.readFileSync(envPath, "utf-8");
const useFirebase = env.match(/VITE_USE_FIREBASE\s*=\s*true/i);

// Flip the value
const newValue = useFirebase ? "false" : "true";
env = env.replace(/VITE_USE_FIREBASE\s*=\s*(true|false)/i, `VITE_USE_FIREBASE=${newValue}`);

// Write updated .env file
fs.writeFileSync(envPath, env);
console.log(`✅ Toggled VITE_USE_FIREBASE=${newValue}`);

// Optional: Restart Vite (dev mode only)
console.log("🔁 Restart your dev server for changes to take effect.");
