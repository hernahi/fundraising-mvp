// scripts/showClaims.js
import fs from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));
initializeApp({ credential: cert(serviceAccount) });

const email = "hernahi@gmail.com"; // replace this

(async () => {
  const user = await getAuth().getUserByEmail(email);
  console.log(`🧾 Claims for ${email}:`, user.customClaims || "(none)");
})();
