/**
 * Global Firestore Data Sanitation Suite
 * - removes invalid blob URLs
 * - cleans bad coach entries
 * - removes orphaned pivots
 * - normalizes campaign/athlete/donor structure
 */

const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function cleanAthletes() {
  console.log("=== Cleaning athletes ===");
  const snap = await db.collection("athletes").get();

  for (const doc of snap.docs) {
    const d = doc.data();

    if (d.imgUrl && d.imgUrl.startsWith("blob:")) {
      console.log("Fixing bad imgUrl for athlete:", doc.id);
      await doc.ref.update({ imgUrl: null });
    }

    if (!d.orgId || !d.teamId) {
      console.log("Removing incomplete athlete:", doc.id);
      await doc.ref.delete();
    }
  }
}

async function cleanCoaches() {
  console.log("=== Cleaning coaches ===");
  const snap = await db.collection("coaches").get();

  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.uid || !d.orgId) {
      console.log("Deleting invalid coach:", doc.id);
      await doc.ref.delete();
    }
  }
}

async function removeOrphanedPivots() {
  console.log("=== Cleaning campaignAthletes pivots ===");

  const aSnap = await db.collection("athletes").get();
  const validAthletes = new Set(aSnap.docs.map(x => x.id));

  const pSnap = await db.collection("campaignAthletes").get();

  for (const doc of pSnap.docs) {
    const d = doc.data();

    if (!validAthletes.has(d.athleteId)) {
      console.log("Removing orphan pivot:", doc.id);
      await doc.ref.delete();
    }
  }
}

async function main() {
  console.log("=== Running sanitation suite ===");

  await cleanAthletes();
  await cleanCoaches();
  await removeOrphanedPivots();

  console.log("=== Sanitation suite complete ===");
}

main();
