/**
 * Phase 11B — Data cleanup
 *
 * FIXES:
 *  1) Delete users with role === "donor"
 *  2) Backfill users/{uid}.athleteId from athletes collection
 *
 * Default = DRY RUN
 *
 * Usage:
 *   node scripts/phase11_fix.js --projectId YOUR_PROJECT_ID --dryRun
 *
 * Apply changes:
 *   node scripts/phase11_fix.js --projectId YOUR_PROJECT_ID --apply
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const v = process.argv[idx + 1];
  return v && !v.startsWith("--") ? v : true;
}

async function main() {
  const projectId = arg("projectId");
  const apply = !!arg("apply", false);
  const dryRun = !apply;

  if (!projectId) {
    console.error("❌ Missing --projectId");
    process.exit(1);
  }

  if (!admin.apps.length) {
    const keyPath = path.join(__dirname, "serviceAccountKey.json");
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ projectId });
    } else if (fs.existsSync(keyPath)) {
      const serviceAccount = require(keyPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });
    } else {
      console.error(
        "❌ No Admin credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or add scripts/serviceAccountKey.json"
      );
      process.exit(1);
    }
  }

  const db = admin.firestore();

  console.log("\n=== Phase 11B Cleanup ===");
  console.log("Mode:", dryRun ? "DRY RUN (no writes)" : "APPLY (writes enabled)");
  console.log("Project:", projectId);

  // Load collections
  const [usersSnap, athletesSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("athletes").get(),
  ]);

  const users = new Map();
  usersSnap.forEach((d) => users.set(d.id, d.data()));

  const athleteByUser = new Map();
  athletesSnap.forEach((d) => {
    const a = d.data();
    if (a.userId) {
      athleteByUser.set(a.userId, d.id);
    }
  });

  let donorUsers = [];
  let athleteBackfills = [];

  // Analyze users
  for (const doc of usersSnap.docs) {
    const uid = doc.id;
    const u = doc.data();

    if (u.role === "donor") {
      donorUsers.push(uid);
    }

    if (u.role === "athlete" && !u.athleteId) {
      const athleteId = athleteByUser.get(uid);
      if (athleteId) {
        athleteBackfills.push({ uid, athleteId });
      }
    }
  }

  console.log("\n--- Planned Actions ---");
  console.log("Donor users to delete:", donorUsers.length);
  console.log("Athlete users to backfill athleteId:", athleteBackfills.length);

  if (dryRun) {
    console.log("\n(DRY RUN) No changes applied.");
    console.log("Sample donor UIDs:", donorUsers.slice(0, 5));
    console.log("Sample athlete backfills:", athleteBackfills.slice(0, 5));
    return;
  }

  // APPLY CHANGES
  const batch = db.batch();

  // Delete donor users
  for (const uid of donorUsers) {
    batch.delete(db.collection("users").doc(uid));
  }

  // Backfill athleteId
  for (const { uid, athleteId } of athleteBackfills) {
    batch.update(db.collection("users").doc(uid), { athleteId });
  }

  await batch.commit();

  console.log("\n✅ Cleanup complete.");
  console.log("Deleted donor users:", donorUsers.length);
  console.log("Backfilled athlete users:", athleteBackfills.length);
}

main().catch((err) => {
  console.error("❌ Cleanup failed:", err);
  process.exit(1);
});
