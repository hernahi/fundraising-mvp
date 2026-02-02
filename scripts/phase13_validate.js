/**
 * Phase 13 - Donation integrity validator (read-only)
 *
 * Usage:
 *   node scripts/phase13_validate.js --projectId YOUR_PROJECT_ID
 *   node scripts/phase13_validate.js --projectId YOUR_PROJECT_ID --writeReport
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

function nowIso() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  return /\S+@\S+\.\S+/.test(email);
}

async function main() {
  const projectId = arg("projectId");
  const writeReport = !!arg("writeReport", false);

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

  const [campaignsSnap, athletesSnap, teamsSnap, usersSnap, donationsSnap] =
    await Promise.all([
      db.collection("campaigns").get(),
      db.collection("athletes").get(),
      db.collection("teams").get(),
      db.collection("users").get(),
      db.collection("donations").get(),
    ]);

  const campaigns = new Map();
  const athletes = new Map();
  const teams = new Map();
  const users = new Map();

  campaignsSnap.forEach((d) => campaigns.set(d.id, d.data()));
  athletesSnap.forEach((d) => athletes.set(d.id, d.data()));
  teamsSnap.forEach((d) => teams.set(d.id, d.data()));
  usersSnap.forEach((d) => users.set(d.id, d.data()));

  const report = {
    meta: { projectId, generatedAt: new Date().toISOString() },
    counts: {
      campaigns: campaignsSnap.size,
      athletes: athletesSnap.size,
      teams: teamsSnap.size,
      users: usersSnap.size,
      donations: donationsSnap.size,
    },
    issues: [],
    stats: {
      missingOrgId: 0,
      missingCampaignId: 0,
      missingAmount: 0,
      missingCreatedAt: 0,
      invalidEmail: 0,
      legacyEmailField: 0,
      orphanCampaign: 0,
      orphanAthlete: 0,
      orphanTeam: 0,
      orgMismatches: 0,
      likelyDollarAmounts: 0,
    },
  };

  for (const doc of donationsSnap.docs) {
    const d = doc.data() || {};
    const donationId = doc.id;

    const issues = [];

    if (!d.orgId) {
      report.stats.missingOrgId++;
      issues.push({ code: "DONATION_MISSING_ORGID" });
    }
    if (!d.campaignId) {
      report.stats.missingCampaignId++;
      issues.push({ code: "DONATION_MISSING_CAMPAIGNID" });
    }
    if (d.amount == null && d.amountCents == null) {
      report.stats.missingAmount++;
      issues.push({ code: "DONATION_MISSING_AMOUNT" });
    }
    if (!d.createdAt) {
      report.stats.missingCreatedAt++;
      issues.push({ code: "DONATION_MISSING_CREATEDAT" });
    }

    if (!d.donorEmail && d.email) {
      report.stats.legacyEmailField++;
      issues.push({ code: "DONATION_LEGACY_EMAIL_FIELD" });
    }

    if (d.donorEmail && !isValidEmail(d.donorEmail)) {
      report.stats.invalidEmail++;
      issues.push({ code: "DONATION_INVALID_DONOREMAIL", detail: { donorEmail: d.donorEmail } });
    }

    const amount = Number(d.amount);
    if (Number.isFinite(amount) && amount > 0 && amount < 100) {
      report.stats.likelyDollarAmounts++;
      issues.push({ code: "DONATION_AMOUNT_LIKELY_DOLLARS", detail: { amount } });
    }

    if (d.campaignId && !campaigns.has(d.campaignId)) {
      report.stats.orphanCampaign++;
      issues.push({ code: "DONATION_ORPHAN_CAMPAIGN", detail: { campaignId: d.campaignId } });
    }
    if (d.athleteId && !athletes.has(d.athleteId)) {
      report.stats.orphanAthlete++;
      issues.push({ code: "DONATION_ORPHAN_ATHLETE", detail: { athleteId: d.athleteId } });
    }
    if (d.teamId && !teams.has(d.teamId)) {
      report.stats.orphanTeam++;
      issues.push({ code: "DONATION_ORPHAN_TEAM", detail: { teamId: d.teamId } });
    }

    // Cross-org mismatches
    const orgId = d.orgId || null;
    if (orgId) {
      const c = d.campaignId ? campaigns.get(d.campaignId) : null;
      if (c?.orgId && c.orgId !== orgId) {
        report.stats.orgMismatches++;
        issues.push({
          code: "DONATION_ORG_MISMATCH_CAMPAIGN",
          detail: { donationOrgId: orgId, campaignOrgId: c.orgId },
        });
      }

      const a = d.athleteId ? athletes.get(d.athleteId) : null;
      if (a?.orgId && a.orgId !== orgId) {
        report.stats.orgMismatches++;
        issues.push({
          code: "DONATION_ORG_MISMATCH_ATHLETE",
          detail: { donationOrgId: orgId, athleteOrgId: a.orgId },
        });
      }

      const t = d.teamId ? teams.get(d.teamId) : null;
      if (t?.orgId && t.orgId !== orgId) {
        report.stats.orgMismatches++;
        issues.push({
          code: "DONATION_ORG_MISMATCH_TEAM",
          detail: { donationOrgId: orgId, teamOrgId: t.orgId },
        });
      }

      const u = d.userId ? users.get(d.userId) : null;
      if (u?.orgId && u.orgId !== orgId && u.role !== "super-admin") {
        report.stats.orgMismatches++;
        issues.push({
          code: "DONATION_ORG_MISMATCH_USER",
          detail: { donationOrgId: orgId, userOrgId: u.orgId },
        });
      }
    }

    if (issues.length) {
      report.issues.push({ donationId, issues });
    }
  }

  const summary = {
    counts: report.counts,
    issueCount: report.issues.length,
    stats: report.stats,
  };

  console.log("\n=== Phase 13 Donation Validation Summary ===");
  console.log("Counts:", summary.counts);
  console.log("Issue count:", summary.issueCount);
  console.log("Stats:", summary.stats);

  if (writeReport) {
    const outDir = path.join(process.cwd(), "phase13_reports");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `phase13_report_${nowIso()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\nWrote report: ${outPath}`);
  } else {
    console.log("\nTip: run with --writeReport to save a full JSON report.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
