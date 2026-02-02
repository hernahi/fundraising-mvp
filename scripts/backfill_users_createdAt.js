/**
 * One-time backfill for users.createdAt
 *
 * Usage:
 *   node scripts/backfill_users_createdAt.js --projectId YOUR_PROJECT_ID
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function main() {
  const projectId = arg("projectId");
  if (!projectId) {
    console.error("❌ Missing --projectId");
    process.exit(1);
  }

  if (!admin.apps.length) {
    const keyPath = path.join(__dirname, "serviceAccountKey.json");
    if (fs.existsSync(keyPath)) {
      admin.initializeApp({
        credential: admin.credential.cert(require(keyPath)),
        projectId,
      });
    } else {
      admin.initializeApp({ projectId });
    }
  }

  const db = admin.firestore();
  const auth = admin.auth();

  const usersSnap = await db.collection("users").get();

  let updated = 0;
  const batch = db.batch();

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    if (data.createdAt) continue;

    let createdAt = admin.firestore.FieldValue.serverTimestamp();

    try {
      const authUser = await auth.getUser(doc.id);
      if (authUser?.metadata?.creationTime) {
        createdAt = admin.firestore.Timestamp.fromDate(
          new Date(authUser.metadata.creationTime)
        );
      }
    } catch {
      // user may not exist in Auth — fallback is fine
    }

    batch.update(doc.ref, { createdAt });
    updated++;
  }

  if (updated > 0) {
    await batch.commit();
  }

  console.log(`✅ Backfill complete. Users updated: ${updated}`);
}

main().catch(console.error);
