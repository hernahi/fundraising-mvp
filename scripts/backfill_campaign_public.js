/**
 * Backfill campaigns.isPublic to true (safe, optional writes).
 *
 * Usage (dry run by default):
 *   node scripts/backfill_campaign_public.js --projectId YOUR_PROJECT_ID
 *
 * Apply changes:
 *   node scripts/backfill_campaign_public.js --projectId YOUR_PROJECT_ID --apply
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
    console.error("Missing required --projectId");
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
        "No Admin credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or add scripts/serviceAccountKey.json"
      );
      process.exit(1);
    }
  }

  const db = admin.firestore();

  console.log("\n=== Campaign Public Backfill ===");
  console.log("Mode:", dryRun ? "DRY RUN (no writes)" : "APPLY (writes enabled)");
  console.log("Project:", projectId);

  const snap = await db.collection("campaigns").get();
  let scanned = 0;
  let updated = 0;

  for (const doc of snap.docs) {
    scanned++;
    const data = doc.data() || {};
    if (data.isPublic === true) continue;

    updated++;
    console.log(`Update campaigns/${doc.id} -> { isPublic: true }`);
    if (!dryRun) {
      await doc.ref.set({ isPublic: true }, { merge: true });
    }
  }

  console.log("\n=== Backfill Summary ===");
  console.log("Campaigns scanned:", scanned);
  console.log("Campaigns updated:", updated);
  console.log(dryRun ? "(dry run) no writes applied" : "writes applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
