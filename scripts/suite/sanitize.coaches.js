/**
 * sanitize.coaches.js
 * -----------------------------------------------------
 * Deletes invalid coaches
 * Rebuilds valid coaches from users
 */

const admin = require("firebase-admin");
const serviceAccount = require("../service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function wipeInvalidCoaches() {
  const snap = await db.collection("coaches").get();

  for (const doc of snap.docs) {
    const c = doc.data();

    if (!c.uid || typeof c.uid !== "string") {
      console.log(`Deleting invalid coach ${doc.id}`);
      await doc.ref.delete();
    }
  }
}

async function rebuildCoaches() {
  const users = await db.collection("users").get();

  for (const doc of users.docs) {
    const u = doc.data();

    if (u.role !== "coach") continue;

    if (!u.teamId || !u.orgId) {
      console.log(`Skipping user ${doc.id} — missing team/org`);
      continue;
    }

    await db.collection("coaches").doc(doc.id).set(
      {
        uid: doc.id,
        userId: doc.id,
        orgId: u.orgId,
        teamId: u.teamId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        role: "coach"
      },
      { merge: true }
    );

    console.log(`Rebuilt coach: ${doc.id}`);
  }
}

async function main() {
  console.log("=== Running Coach Sanitizer ===");
  await wipeInvalidCoaches();
  await rebuildCoaches();
  console.log("=== Coach Sanitization Complete ===");
}

main();
