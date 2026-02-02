/**
 * Firestore Data Consistency Validator for fundraising-mvp
 * Phase 4.1 → Phase 4.2 Migration
 *
 * SAFE: Read-only. Reports issues but does NOT modify data.
 *
 * Requirements:
 *   npm install firebase-admin
 *
 * Usage:
 *   node validateFirestoreData.js
 */

const admin = require("firebase-admin");

// Load your service account key
admin.initializeApp({
  credential: admin.credential.cert("./serviceAccountKey.json")
});

const db = admin.firestore();

/* ===============================
   Helpers
   =============================== */

function logSection(title) {
  console.log("\n=========================================");
  console.log(title);
  console.log("=========================================\n");
}

function validateField(doc, field) {
  return doc[field] !== undefined && doc[field] !== null && doc[field] !== "";
}

function getField(doc, field) {
  return doc[field] !== undefined ? doc[field] : null;
}

async function scanCollection(collectionName, validators) {
  const snapshot = await db.collection(collectionName).get();
  const issues = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const docIssues = [];

    // Run each validation rule
    for (const v of validators) {
      const ok = v.check(data);
      if (!ok) {
        docIssues.push(v.message);
      }
    }

    if (docIssues.length > 0) {
      issues.push({
        id: doc.id,
        issues: docIssues
      });
    }
  });

  return issues;
}

/* ===============================
   VALIDATION RULES
   =============================== */

const requireOrgId = {
  check: (d) => validateField(d, "orgId"),
  message: "Missing orgId"
};

const requireUserId = {
  check: (d) => validateField(d, "userId"),
  message: "Missing userId"
};

const requireTeamId = {
  check: (d) => validateField(d, "teamId"),
  message: "Missing teamId"
};

const requireCampaignId = {
  check: (d) => validateField(d, "campaignId"),
  message: "Missing campaignId"
};

const requireRole = {
  check: (d) =>
    validateField(d, "role") &&
    ["admin", "coach", "athlete", "donor"].includes(d.role),
  message: "Missing or invalid role"
};

/* ===============================
   MASTER VALIDATION RUNNER
   =============================== */

async function runValidation() {
  logSection("RUNNING FIRESTORE DATA VALIDATION");

  /* USERS */
  logSection("Checking USERS...");
  const userIssues = await scanCollection("users", [requireOrgId, requireRole]);
  console.log(JSON.stringify(userIssues, null, 2));

  /* CAMPAIGNS */
  logSection("Checking CAMPAIGNS...");
  const campaignIssues = await scanCollection("campaigns", [requireOrgId]);
  console.log(JSON.stringify(campaignIssues, null, 2));

  /* TEAMS */
  logSection("Checking TEAMS...");
  const teamIssues = await scanCollection("teams", [requireOrgId]);
  console.log(JSON.stringify(teamIssues, null, 2));

  /* ATHLETES */
  logSection("Checking ATHLETES...");
  const athleteIssues = await scanCollection("athletes", [requireOrgId, requireUserId, requireTeamId]);
  console.log(JSON.stringify(athleteIssues, null, 2));

  /* COACHES */
  logSection("Checking COACHES...");
  const coachIssues = await scanCollection("coaches", [requireOrgId, requireUserId]);
  console.log(JSON.stringify(coachIssues, null, 2));

  /* DONORS */
  logSection("Checking DONORS...");
  const donorIssues = await scanCollection("donors", [requireOrgId, requireUserId]);
  console.log(JSON.stringify(donorIssues, null, 2));

  /* DONATIONS */
  logSection("Checking DONATIONS...");
  const donationIssues = await scanCollection("donations", [requireOrgId, requireUserId, requireCampaignId]);
  console.log(JSON.stringify(donationIssues, null, 2));

  /* CAMPAIGN-ATHLETES */
  logSection("Checking CAMPAIGN-ATHLETE LINKS...");
  const linkIssues = await scanCollection("campaignAthletes", [requireOrgId, requireUserId, requireCampaignId]);
  console.log(JSON.stringify(linkIssues, null, 2));

  logSection("VALIDATION COMPLETE");
}

runValidation().catch(err => {
  console.error("VALIDATION FAILED:", err);
});
