/**
 * Normalize orgId across all major collections to "demo-org"
 * Run with: node scripts/normalizeOrgIds.js
 */

import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(
  readFileSync(new URL("../firestone-migrate/serviceAccountKey.json", import.meta.url))
);

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id,
});

const db = getFirestore();


// ---- SETTINGS ----
const TARGET_ORG = "demo-org";
const COLLECTIONS = [
  "users",
  "campaigns",
  "athletes",
  "coaches",
  "donors",
  "donations",
  "teams",
  "campaignAthletes",
];

// ---- MAIN ----
async function normalize() {
  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).get();
    if (snap.empty) {
      console.log(`⚠️  No docs in ${col}`);
      continue;
    }

    console.log(`\n🔧 Updating ${snap.size} docs in ${col}...`);
    let updated = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const orgId = data.orgId;

      if (orgId !== TARGET_ORG) {
        await doc.ref.update({ orgId: TARGET_ORG });
        updated++;
      }
    }

    console.log(`✅ ${col}: ${updated} docs set to orgId="${TARGET_ORG}"`);
  }

  console.log("\n🎯 Org normalization complete.");
  process.exit(0);
}

normalize().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
