/**
 * Backfill campaigns/{campaignId}/public_donors from paid donations.
 *
 * Usage (dry run by default):
 *   node scripts/backfill_public_donors.js --projectId YOUR_PROJECT_ID
 *
 * Apply changes:
 *   node scripts/backfill_public_donors.js --projectId YOUR_PROJECT_ID --apply
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

  console.log("\n=== Public Donors Backfill ===");
  console.log("Mode:", dryRun ? "DRY RUN (no writes)" : "APPLY (writes enabled)");
  console.log("Project:", projectId);

  const donationsSnap = await db.collection("donations").get();
  let scanned = 0;
  let eligible = 0;
  let created = 0;
  let skipped = 0;

  for (const doc of donationsSnap.docs) {
    scanned++;
    const donation = doc.data() || {};

    if (donation.status !== "paid") continue;
    if (!donation.campaignId) continue;

    const amountCents = Number(donation.amount || 0);
    if (!Number.isFinite(amountCents) || amountCents < 0) continue;

    eligible++;

    const donorName =
      (typeof donation.donorName === "string" && donation.donorName.trim()) ||
      "Anonymous";
    const createdAt =
      donation.createdAt ||
      doc.createTime ||
      admin.firestore.FieldValue.serverTimestamp();

    const donorsRef = db
      .collection("campaigns")
      .doc(donation.campaignId)
      .collection("public_donors")
      .doc(doc.id);

    if (dryRun) {
      console.log(
        `Would create public_donors/${doc.id} (campaign ${donation.campaignId})`
      );
      continue;
    }

    try {
      await donorsRef.create({
        displayName: donorName,
        amountCents,
        createdAt,
        isAnonymous: false,
        athleteId: donation.athleteId || null,
      });
      created++;
    } catch (err) {
      if (err?.code === 6) {
        skipped++;
        continue;
      }
      throw err;
    }
  }

  console.log("\n=== Backfill Summary ===");
  console.log("Donations scanned:", scanned);
  console.log("Eligible donations:", eligible);
  console.log("Public donors created:", created);
  console.log("Public donors skipped (exists):", skipped);
  console.log(dryRun ? "(dry run) no writes applied" : "writes applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
