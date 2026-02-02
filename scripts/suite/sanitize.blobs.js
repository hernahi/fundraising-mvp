/**
 * sanitize.blobs.js
 * ---------------------------------------------
 * Removes all invalid blob: URLs across the database.
 * Safe, idempotent, can be run as many times as needed.
 */

const admin = require("firebase-admin");
const serviceAccount = require("../service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const COLLECTIONS_TO_SCAN = [
  "athletes",
  "donors",
  "coaches",
  "users",
  "campaigns",
  "campaignAthletes",
  "donations",
  "teams"
];

async function sanitizeCollection(collection) {
  console.log(`--- Scanning ${collection} ---`);

  const snap = await db.collection(collection).get();

  for (const doc of snap.docs) {
    const data = doc.data();
    let needsUpdate = false;
    const update = {};

    // Generic cleanup: remove blob URLs in any field
    for (const [field, value] of Object.entries(data)) {
      if (typeof value === "string" && value.startsWith("blob:")) {
        console.log(`Fixing ${collection}/${doc.id}: removing blob URL in field ${field}`);
        update[field] = admin.firestore.FieldValue.delete();
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await doc.ref.update(update);
    }
  }
}

async function main() {
  console.log("=== Running Blob Sanitizer ===");

  for (const col of COLLECTIONS_TO_SCAN) {
    try {
      await sanitizeCollection(col);
    } catch (err) {
      console.error(`Error sanitizing ${col}:`, err);
    }
  }

  console.log("=== Blob Sanitization Complete ===");
}

main();
