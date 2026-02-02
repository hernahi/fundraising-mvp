/**
 * sanitize.athletes.js
 * ----------------------------------------------------------
 * Fixes:
 * - missing orgId
 * - missing teamId
 * - removes invalid references
 * - rebuilds campaignAthletes mapping
 */

const admin = require("firebase-admin");
const serviceAccount = require("../service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function sanitizeAthletes() {
  const athletes = await db.collection("athletes").get();

  for (const doc of athletes.docs) {
    const data = doc.data();
    const update = {};
    let dirty = false;

    if (!data.orgId) {
      console.log(`Fixing athlete ${doc.id}: missing orgId`);
      update.orgId = "demo-org";
      dirty = true;
    }

    if (!data.teamId) {
      console.log(`Fixing athlete ${doc.id}: missing teamId`);
      update.teamId = "UNASSIGNED";
      dirty = true;
    }

    if (dirty) {
      await doc.ref.update(update);
    }
  }
}

async function rebuildPivot() {
  console.log("— Rebuilding campaignAthletes pivot —");

  const pivotRef = db.collection("campaignAthletes");
  const pivot = await pivotRef.get();

  for (const doc of pivot.docs) {
    const data = doc.data();

    if (!data.athleteId || !data.campaignId) {
      console.log(`Deleting invalid pivot entry: ${doc.id}`);
      await doc.ref.delete();
    }
  }
}

async function main() {
  console.log("=== Running Athlete Sanitizer ===");
  await sanitizeAthletes();
  await rebuildPivot();
  console.log("=== Athlete Sanitization Complete ===");
}

main();
