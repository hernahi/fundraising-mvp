/**
 * sanitize.users.js
 * ------------------------------------------------
 * Normalizes all user records:
 * - Ensures uid exists
 * - Ensures role exists ("athlete" | "coach" | "admin")
 * - Ensures orgId exists
 * - Ensures teamId exists (assigns "UNASSIGNED")
 */

const admin = require("firebase-admin");
const serviceAccount = require("../service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function sanitizeUsers() {
  const snap = await db.collection("users").get();

  for (const doc of snap.docs) {
    const data = doc.data();
    const update = {};
    let dirty = false;

    if (!data.uid) {
      console.log(`Fixing user ${doc.id}: missing uid`);
      update.uid = doc.id;
      dirty = true;
    }

    if (!data.role) {
      console.log(`Fixing user ${doc.id}: missing role`);
      update.role = "athlete";
      dirty = true;
    }

    if (!data.orgId) {
      console.log(`Fixing user ${doc.id}: missing orgId`);
      update.orgId = "demo-org"; // fallback
      dirty = true;
    }

    if (!data.teamId) {
      console.log(`Fixing user ${doc.id}: missing teamId`);
      update.teamId = "UNASSIGNED";
      dirty = true;
    }

    if (dirty) {
      await doc.ref.update(update);
    }
  }
}

async function main() {
  console.log("=== Running User Sanitizer ===");
  await sanitizeUsers();
  console.log("=== User Sanitization Complete ===");
}

main();
