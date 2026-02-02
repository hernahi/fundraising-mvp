// migrate-users.cjs
const admin = require("firebase-admin");
const fs = require("fs");

// ---- 1. Load Firebase service account ----
const credPath = "./serviceAccountKey.json";
if (!fs.existsSync(credPath)) {
  console.error("\n❌ Missing serviceAccountKey.json\n");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(credPath)),
});
const db = admin.firestore();

console.log("🚀 Starting user migration...\n");

async function migrate() {
  const usersRef = db.collection("users");
  const snapshot = await usersRef.get();

  let migrated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const id = doc.id;
    const data = doc.data();

    // ------------------------------------------------------------
    // ✅ CASE 1 — Your real doc: 8r0XL...
    // ------------------------------------------------------------
    if (id === "8r0XLV1NfpZ2TgV0xd5NC6V2d1b2") {
      console.log(`✅ Updating your user doc → ${id}`);

      await usersRef.doc(id).update({
        uid: id, // matches Firebase Auth UID
      });

      migrated++;
      continue;
    }

    // ------------------------------------------------------------
    // ✅ CASE 2 — Demo users (ADMIN, ATH1, COACH1)
    // Must create real Firebase Auth users.
    // ------------------------------------------------------------
    if (["ADMIN", "ATH1", "COACH1"].includes(id)) {
      console.log(`🔄 Migrating demo user → ${id}`);

      // Convert demo user into Auth user
      const newUser = await admin.auth().createUser({
        email: data.email,
        displayName: data.displayName,
      });

      // Create new Firestore doc under new UID
      await usersRef.doc(newUser.uid).set({
        ...data,
        uid: newUser.uid,
        migratedFrom: id,
      });

      // Delete the old demo doc
      await usersRef.doc(id).delete();

      console.log(`✅ Created new user with UID ${newUser.uid}`);

      migrated++;
      continue;
    }

    // Unknown document
    console.log(`⚠️ SKIP: Unrecognized document → ${id}`);
    skipped++;
  }

  console.log("\n✅ Migration complete!");
  console.log(`Migrated: ${migrated}`);
  console.log(`Skipped:   ${skipped}\n`);
}

migrate();
