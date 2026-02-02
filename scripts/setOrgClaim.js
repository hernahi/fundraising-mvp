// scripts/setOrgClaim.js
import fs from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));
initializeApp({ credential: cert(serviceAccount) });

const email = "hernahi@gmail.com";
const claims = { orgId: "demo-org", role: "admin" };

(async () => {
  const user = await getAuth().getUserByEmail(email);
  await getAuth().setCustomUserClaims(user.uid, claims);
  console.log(`✅ Custom claims set for ${email}:`, claims);
})();
