/**
 * Phase 13 - Donation integrity fixer (safe, optional writes)
 *
 * Usage (dry run by default):
 *   node scripts/phase13_fix.js --projectId YOUR_PROJECT_ID
 *
 * Apply changes:
 *   node scripts/phase13_fix.js --projectId YOUR_PROJECT_ID --apply
 *
 * Optional:
 *   --convertLikelyDollars  Convert amounts < 100 to cents (heuristic)
 *   --backfillDonors        Backfill donorId/totalDonations/lastDonationAt
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

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  return /\S+@\S+\.\S+/.test(email);
}

function asString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function uniqueNonEmpty(values) {
  const set = new Set(values.filter((v) => v));
  return Array.from(set);
}

async function main() {
  const projectId = arg("projectId");
  const apply = !!arg("apply", false);
  const dryRun = !apply;
  const convertLikelyDollars = !!arg("convertLikelyDollars", false);
  const backfillDonors = !!arg("backfillDonors", false);

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

  console.log("\n=== Phase 13 Donation Fixer ===");
  console.log("Mode:", dryRun ? "DRY RUN (no writes)" : "APPLY (writes enabled)");
  console.log("Project:", projectId);
  console.log("convertLikelyDollars:", convertLikelyDollars ? "ON" : "OFF");
  console.log("backfillDonors:", backfillDonors ? "ON" : "OFF");

  const [campaignsSnap, athletesSnap, teamsSnap, usersSnap, donationsSnap, donorsSnap] =
    await Promise.all([
      db.collection("campaigns").get(),
      db.collection("athletes").get(),
      db.collection("teams").get(),
      db.collection("users").get(),
      db.collection("donations").get(),
      db.collection("donors").get(),
    ]);

  const campaigns = new Map();
  const athletes = new Map();
  const teams = new Map();
  const users = new Map();

  campaignsSnap.forEach((d) => campaigns.set(d.id, d.data()));
  athletesSnap.forEach((d) => athletes.set(d.id, d.data()));
  teamsSnap.forEach((d) => teams.set(d.id, d.data()));
  usersSnap.forEach((d) => users.set(d.id, d.data()));

  let scanned = 0;
  let updated = 0;
  const donorAgg = new Map();
  const changes = {
    donorEmail: 0,
    donorName: 0,
    createdAt: 0,
    orgId: 0,
    teamId: 0,
    amountFromAmountCents: 0,
    amountLikelyDollars: 0,
  };

  for (const doc of donationsSnap.docs) {
    scanned++;
    const d = doc.data() || {};
    const update = {};
    const donorKey = d.donorId || d.donor?.id || d.donor?.uid || null;
    const createdAt =
      d.createdAt?.toDate?.() ||
      (d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null);

    // donorEmail backfill
    if (!d.donorEmail) {
      const legacyEmail = asString(d.email) || asString(d.donor?.email);
      if (legacyEmail && isValidEmail(legacyEmail)) {
        update.donorEmail = legacyEmail.toLowerCase();
        changes.donorEmail++;
      }
    } else if (typeof d.donorEmail === "string") {
      const trimmed = d.donorEmail.trim();
      if (trimmed && trimmed !== d.donorEmail) {
        update.donorEmail = trimmed;
        changes.donorEmail++;
      }
    }

    // donorName backfill
    if (!d.donorName) {
      const legacyName =
        asString(d.donorFullName) || asString(d.donor?.name) || asString(d.donor?.fullName);
      if (legacyName) {
        update.donorName = legacyName;
        changes.donorName++;
      }
    } else if (typeof d.donorName === "string") {
      const trimmed = d.donorName.trim();
      if (trimmed && trimmed !== d.donorName) {
        update.donorName = trimmed;
        changes.donorName++;
      }
    }

    // createdAt backfill
    if (!d.createdAt && doc.createTime) {
      update.createdAt = doc.createTime;
      changes.createdAt++;
    }

    // amount backfill from amountCents
    if (d.amount == null && d.amountCents != null) {
      const cents = Number(d.amountCents);
      if (Number.isFinite(cents) && cents >= 0) {
        update.amount = cents;
        changes.amountFromAmountCents++;
      }
    }

    // optional dollars -> cents conversion
    if (convertLikelyDollars && d.amount != null) {
      const amount = Number(d.amount);
      if (Number.isFinite(amount) && amount > 0 && amount < 100) {
        update.amount = Math.round(amount * 100);
        changes.amountLikelyDollars++;
      }
    }

    // orgId inference
    if (!d.orgId) {
      const orgCandidates = [];

      if (d.campaignId && campaigns.has(d.campaignId)) {
        orgCandidates.push(campaigns.get(d.campaignId).orgId);
      }
      if (d.athleteId && athletes.has(d.athleteId)) {
        orgCandidates.push(athletes.get(d.athleteId).orgId);
      }
      if (d.teamId && teams.has(d.teamId)) {
        orgCandidates.push(teams.get(d.teamId).orgId);
      }
      if (d.userId && users.has(d.userId)) {
        orgCandidates.push(users.get(d.userId).orgId);
      }

      const unique = uniqueNonEmpty(orgCandidates);
      if (unique.length === 1) {
        update.orgId = unique[0];
        changes.orgId++;
      }
    }

    // teamId inference
    if (!d.teamId) {
      if (d.athleteId && athletes.has(d.athleteId)) {
        const a = athletes.get(d.athleteId);
        if (a?.teamId) {
          update.teamId = a.teamId;
          changes.teamId++;
        }
      } else if (d.campaignId && campaigns.has(d.campaignId)) {
        const c = campaigns.get(d.campaignId);
        if (c?.teamId) {
          update.teamId = c.teamId;
          changes.teamId++;
        } else if (Array.isArray(c?.teamIds) && c.teamIds.length === 1) {
          update.teamId = c.teamIds[0];
          changes.teamId++;
        }
      }
    }

    if (Object.keys(update).length) {
      updated++;
      console.log(`Update donations/${doc.id} ->`, update);
      if (!dryRun) {
        await doc.ref.set(update, { merge: true });
      }
    }

    if (donorKey) {
      const current = donorAgg.get(donorKey) || {
        total: 0,
        lastDonationAt: null,
        count: 0,
      };
      current.total += Number(d.amount || 0);
      current.count += 1;
      if (createdAt && (!current.lastDonationAt || createdAt > current.lastDonationAt)) {
        current.lastDonationAt = createdAt;
      }
      donorAgg.set(donorKey, current);
    }
  }

  let donorScanned = 0;
  let donorUpdated = 0;
  const donorChanges = {
    donorId: 0,
    totalDonations: 0,
    lastDonationAt: 0,
  };

  if (backfillDonors) {
    for (const donorDoc of donorsSnap.docs) {
      donorScanned++;
      const d = donorDoc.data() || {};
      const update = {};
      const donorId = donorDoc.id;
      const agg = donorAgg.get(donorId);

      if (!d.donorId || d.donorId !== donorId) {
        update.donorId = donorId;
        donorChanges.donorId++;
      }

      if (agg) {
        const nextTotal = Number(agg.total || 0);
        if (Number(d.totalDonations || 0) !== nextTotal) {
          update.totalDonations = nextTotal;
          donorChanges.totalDonations++;
        }

        if (agg.lastDonationAt) {
          const existingLast =
            d.lastDonationAt?.toDate?.() ||
            (d.lastDonationAt?.seconds ? new Date(d.lastDonationAt.seconds * 1000) : null) ||
            (d.lastDonationDate ? new Date(d.lastDonationDate) : null);
          if (!existingLast || agg.lastDonationAt > existingLast) {
            update.lastDonationAt = admin.firestore.Timestamp.fromDate(agg.lastDonationAt);
            donorChanges.lastDonationAt++;
          }
        }
      }

      if (Object.keys(update).length) {
        donorUpdated++;
        console.log(`Update donors/${donorId} ->`, update);
        if (!dryRun) {
          await donorDoc.ref.set(update, { merge: true });
        }
      }
    }
  }

  console.log("\n=== Fixer Summary ===");
  console.log("Donations scanned:", scanned);
  console.log("Donations updated:", updated);
  console.log("Changes:", changes);
  if (backfillDonors) {
    console.log("\n=== Donor Backfill Summary ===");
    console.log("Donors scanned:", donorScanned);
    console.log("Donors updated:", donorUpdated);
    console.log("Donor changes:", donorChanges);
  }
  console.log(dryRun ? "(dry run) no writes applied" : "writes applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
