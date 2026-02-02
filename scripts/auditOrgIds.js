/**
 * audits all collections to ensure orgId exists
 * Usage: node scripts/auditOrgIds.js
 */
import fs from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// --- load service account manually (works in both CJS/ESM) ---
const serviceAccount = JSON.parse(
  fs.readFileSync("./serviceAccountKey.json", "utf8")
);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const collections = [
  "users",
  "campaigns",
  "athletes",
  "coaches",
  "donors",
  "donations",
  "teams",
  "campaignAthletes"
];

(async () => {
  console.log("🔍 Auditing orgId fields...");
  for (const col of collections) {
    const snap = await db.collection(col).get();
    const missing = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (!data.orgId) missing.push(doc.id);
    });
    if (missing.length) {
      console.log(`⚠️ ${col}: ${missing.length} missing orgId`, missing);
    } else {
      console.log(`✅ ${col}: all docs have orgId`);
    }
  }
  process.exit(0);
})();
