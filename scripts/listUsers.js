// scripts/listUsers.js
import fs from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json"));
initializeApp({ credential: cert(serviceAccount) });

(async () => {
  const list = await getAuth().listUsers(10);
  list.users.forEach(u => console.log(u.email, u.uid, u.customClaims));
})();
