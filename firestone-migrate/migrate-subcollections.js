/**
 * migrate-subcollections.js
 * -----------------------------------------------------
 * Flatten nested campaign subcollections (athletes, coaches)
 * into top-level collections.
 * -----------------------------------------------------
 */

import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Resolve local path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Load service account JSON manually (no import attribute needed)
const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "serviceAccountKey.json"), "utf8")
);

// ✅ Initialize Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = getFirestore();

async function migrateSubcollections() {
  console.log("🚀 Starting migration of nested athletes & coaches...");

  const campaignsSnap = await db.collection("campaigns").get();

  for (const campaignDoc of campaignsSnap.docs) {
    const campaignId = campaignDoc.id;
    const campaignData = campaignDoc.data();
    console.log(`\n📦 Processing campaign: ${campaignData.name || campaignId}`);

    // --- Migrate athletes subcollection ---
    const athletesRef = campaignDoc.ref.collection("athletes");
    const athletesSnap = await athletesRef.get();

    if (!athletesSnap.empty) {
      console.log(`  🏃 Found ${athletesSnap.size} athletes under campaign ${campaignId}`);
      for (const athleteDoc of athletesSnap.docs) {
        const athleteData = athleteDoc.data();
        const newAthlete = {
          ...athleteData,
          campaignId, // reference for traceability
          orgId: athleteData.orgId || campaignData.orgId,
          teamId: athleteData.teamId || campaignData.teamId,
          migratedFrom: `/campaigns/${campaignId}/athletes/${athleteDoc.id}`,
          migratedAt: new Date().toISOString(),
        };

        await db.collection("athletes").doc(athleteDoc.id).set(newAthlete, { merge: true });
        console.log(`    ✅ Migrated athlete: ${athleteDoc.id}`);
      }
    } else {
      console.log("  ⚪ No nested athletes found.");
    }

    // --- Migrate coaches subcollection ---
    const coachesRef = campaignDoc.ref.collection("coaches");
    const coachesSnap = await coachesRef.get();

    if (!coachesSnap.empty) {
      console.log(`  🧢 Found ${coachesSnap.size} coaches under campaign ${campaignId}`);
      for (const coachDoc of coachesSnap.docs) {
        const coachData = coachDoc.data();
        const newCoach = {
          ...coachData,
          campaignId,
          orgId: coachData.orgId || campaignData.orgId,
          teamId: coachData.teamId || campaignData.teamId,
          migratedFrom: `/campaigns/${campaignId}/coaches/${coachDoc.id}`,
          migratedAt: new Date().toISOString(),
        };

        await db.collection("coaches").doc(coachDoc.id).set(newCoach, { merge: true });
        console.log(`    ✅ Migrated coach: ${coachDoc.id}`);
      }
    } else {
      console.log("  ⚪ No nested coaches found.");
    }
  }

  console.log("\n🎉 Migration complete! Verify data in root collections before deleting nested ones.");
}

migrateSubcollections().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
