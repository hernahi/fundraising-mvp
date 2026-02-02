/**
 * sanitize.donations.js
 * ----------------------------------------------------------------
 * Repairs donation references:
 * - Ensures campaignId exists
 * - Ensures orgId exists
 * - Ensures athleteId exists (or leaves null if anonymous)
 */

const admin = require("firebase-admin");
const serviceAccount = require("../service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function sanitizeDonations() {
  const snap = await db.collection("donations").get();

  for (const doc of snap.docs) {
    const data = doc.data();
    const update = {};
    let dirty = false;

    if (!data.campaignId) {
      console.log(`Donation ${doc.id}: missing campaignId`);
      update.campaignId = "UNKNOWN";
      dirty = true;
    }

    if (!data.orgId) {
      console.log(`Donation ${doc.id}: missing orgId`);
      update.orgId = "demo-org";
      dirty = true;
    }

    // ORPHAN ATHLETE FIX
    if (data.athleteId) {
      const a = await db.collection("athletes").doc(data.athleteId).get();
      if (!a.exists) {
        console.log(`Donation ${doc.id}: orphan athleteId ${data.athleteId}`);
        update.athleteId = null;
        dirty = true;
      }
    }

    if (dirty) await doc.ref.update(update);
  }
}

async function main() {
  console.log("=== Running Donations Sanitizer ===");
  await sanitizeDonations();
  console.log("=== Donation Sanitization Complete ===");
}

main();
