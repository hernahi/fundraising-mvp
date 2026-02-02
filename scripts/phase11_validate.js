/**
 * Phase 11B — Validate Firestore data for RBAC/Org isolation
 *
 * Usage:
 *   node scripts/phase11_validate.js --projectId YOUR_PROJECT_ID
 *
 * Optional:
 *   node scripts/phase11_validate.js --projectId YOUR_PROJECT_ID --writeReport
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

function isValidRole(role) {
  return ["super-admin", "admin", "coach", "athlete"].includes(role);
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

async function main() {
  const projectId = arg("projectId");
  const writeReport = !!arg("writeReport", false);

  if (!projectId) {
    console.error("Missing required --projectId");
    process.exit(1);
  }

  // Service account:
  // Option A: set GOOGLE_APPLICATION_CREDENTIALS=/path/serviceAccount.json
  // Option B: place serviceAccountKey.json next to this script
  if (!admin.apps.length) {
    const localKeyPath = path.join(__dirname, "serviceAccountKey.json");
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ projectId });
    } else if (fs.existsSync(localKeyPath)) {
      const serviceAccount = require(localKeyPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId,
      });
    } else {
      console.error(
        "No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS or put scripts/serviceAccountKey.json"
      );
      process.exit(1);
    }
  }

  const db = admin.firestore();

  const report = {
    meta: { projectId, generatedAt: new Date().toISOString() },
    counts: {},
    issues: {
      users: [],
      teams: [],
      athletes: [],
      invites: [],
      donations: [],
      cross: [],
    },
    stats: {
      usersMissingOrgId: 0,
      teamsMissingOrgId: 0,
      athletesMissingOrgId: 0,
      donationsMissingOrgId: 0,
      invalidRoles: 0,
      orphanAthletes: 0,
      orphanTeams: 0,
      teamCodeDupes: 0,
    },
  };

  // ---- Load collections into memory maps (fast enough for MVP scale)
  const [usersSnap, teamsSnap, athletesSnap, invitesSnap, donationsSnap] =
    await Promise.all([
      db.collection("users").get(),
      db.collection("teams").get(),
      db.collection("athletes").get(),
      db.collection("invites").get().catch(() => ({ docs: [] })), // if collection doesn't exist
      db.collection("donations").get().catch(() => ({ docs: [] })),
    ]);

  const users = new Map();
  const teams = new Map();
  const athletes = new Map();

  usersSnap.forEach((d) => users.set(d.id, d.data()));
  teamsSnap.forEach((d) => teams.set(d.id, d.data()));
  athletesSnap.forEach((d) => athletes.set(d.id, d.data()));

  report.counts = {
    users: usersSnap.size,
    teams: teamsSnap.size,
    athletes: athletesSnap.size,
    invites: invitesSnap.size || invitesSnap.docs.length,
    donations: donationsSnap.size || donationsSnap.docs.length,
  };

  // ---- USERS
  for (const doc of usersSnap.docs) {
    const u = doc.data();
    const uid = doc.id;

    const role = u.role || "";
    const orgId = u.orgId || null;

    if (!isValidRole(role)) {
      report.stats.invalidRoles++;
      report.issues.users.push({
        uid,
        code: "USER_INVALID_ROLE",
        detail: { role },
      });
    }

    if (role !== "super-admin" && !orgId) {
      report.stats.usersMissingOrgId++;
      report.issues.users.push({
        uid,
        code: "USER_MISSING_ORGID",
        detail: { role },
      });
    }

    if (role === "athlete") {
      // recommended link
      if (!u.athleteId) {
        report.issues.users.push({
          uid,
          code: "ATHLETE_USER_MISSING_ATHLETEID",
          detail: {},
        });
      }
    }
  }

  // ---- TEAMS + team code uniqueness per org
  const codeIndex = new Map(); // key: `${orgId}::${code}` => teamId

  for (const doc of teamsSnap.docs) {
    const t = doc.data();
    const teamId = doc.id;

    if (!t.orgId) {
      report.stats.teamsMissingOrgId++;
      report.issues.teams.push({
        teamId,
        code: "TEAM_MISSING_ORGID",
        detail: {},
      });
    }

    if (!t.name) {
      report.issues.teams.push({
        teamId,
        code: "TEAM_MISSING_NAME",
        detail: {},
      });
    }

    if (t.code && t.orgId) {
      const key = `${t.orgId}::${String(t.code).trim().toLowerCase()}`;
      if (codeIndex.has(key) && codeIndex.get(key) !== teamId) {
        report.stats.teamCodeDupes++;
        report.issues.teams.push({
          teamId,
          code: "TEAM_CODE_DUPLICATE_IN_ORG",
          detail: { orgId: t.orgId, code: t.code, otherTeamId: codeIndex.get(key) },
        });
      } else {
        codeIndex.set(key, teamId);
      }
    }

    // type checks (non-fatal)
    if (t.coachIds && !Array.isArray(t.coachIds)) {
      report.issues.teams.push({
        teamId,
        code: "TEAM_COACHIDS_NOT_ARRAY",
        detail: { coachIdsType: typeof t.coachIds },
      });
    }
    if (t.athleteIds && !Array.isArray(t.athleteIds)) {
      report.issues.teams.push({
        teamId,
        code: "TEAM_ATHLETEIDS_NOT_ARRAY",
        detail: { athleteIdsType: typeof t.athleteIds },
      });
    }
  }

  // ---- ATHLETES
  for (const doc of athletesSnap.docs) {
    const a = doc.data();
    const athleteId = doc.id;

    if (!a.orgId) {
      report.stats.athletesMissingOrgId++;
      report.issues.athletes.push({
        athleteId,
        code: "ATHLETE_MISSING_ORGID",
        detail: {},
      });
    }

    if (!a.teamId) {
      report.issues.athletes.push({
        athleteId,
        code: "ATHLETE_MISSING_TEAMID",
        detail: {},
      });
    } else if (!teams.has(a.teamId)) {
      report.stats.orphanAthletes++;
      report.issues.athletes.push({
        athleteId,
        code: "ATHLETE_TEAM_NOT_FOUND",
        detail: { teamId: a.teamId },
      });
    }

    if (!a.userId) {
      report.issues.athletes.push({
        athleteId,
        code: "ATHLETE_MISSING_USERID",
        detail: {},
      });
    } else if (!users.has(a.userId)) {
      report.stats.orphanAthletes++;
      report.issues.athletes.push({
        athleteId,
        code: "ATHLETE_USER_NOT_FOUND",
        detail: { userId: a.userId },
      });
    }

    // Cross-org mismatch check (critical)
    if (a.teamId && teams.has(a.teamId) && a.orgId) {
      const team = teams.get(a.teamId);
      if (team?.orgId && team.orgId !== a.orgId) {
        report.issues.cross.push({
          code: "ATHLETE_ORGID_MISMATCH_TEAM",
          detail: { athleteId, athleteOrgId: a.orgId, teamId: a.teamId, teamOrgId: team.orgId },
        });
      }
    }

    if (a.userId && users.has(a.userId) && a.orgId) {
      const u = users.get(a.userId);
      if (u?.orgId && u.orgId !== a.orgId && u.role !== "super-admin") {
        report.issues.cross.push({
          code: "ATHLETE_ORGID_MISMATCH_USER",
          detail: { athleteId, athleteOrgId: a.orgId, userId: a.userId, userOrgId: u.orgId },
        });
      }
    }

    // Recommended link check: user.athleteId -> athleteId
    if (a.userId && users.has(a.userId)) {
      const u = users.get(a.userId);
      if (u?.role === "athlete" && u.athleteId && u.athleteId !== athleteId) {
        report.issues.cross.push({
          code: "USER_ATHLETEID_POINTS_ELSEWHERE",
          detail: { userId: a.userId, userAthleteId: u.athleteId, athleteId },
        });
      }
    }
  }

  // ---- INVITES
  for (const doc of invitesSnap.docs || []) {
    const inv = doc.data();
    const inviteId = doc.id;

    if (!inv.orgId) {
      report.issues.invites.push({ inviteId, code: "INVITE_MISSING_ORGID", detail: {} });
    }
    if (!inv.email) {
      report.issues.invites.push({ inviteId, code: "INVITE_MISSING_EMAIL", detail: {} });
    }
    if (!inv.role || !isValidRole(inv.role)) {
      report.issues.invites.push({ inviteId, code: "INVITE_INVALID_ROLE", detail: { role: inv.role } });
    }
    if (!inv.status) {
      report.issues.invites.push({ inviteId, code: "INVITE_MISSING_STATUS", detail: {} });
    }
  }

  // ---- DONATIONS
  const donationDocs = donationsSnap.docs || [];
  for (const doc of donationDocs) {
    const d = doc.data();
    const donationId = doc.id;

    if (!d.orgId) {
      report.stats.donationsMissingOrgId++;
      report.issues.donations.push({ donationId, code: "DONATION_MISSING_ORGID", detail: {} });
    }
    if (!d.createdAt) {
      report.issues.donations.push({ donationId, code: "DONATION_MISSING_CREATEDAT", detail: {} });
    }
    if (d.amount == null && d.amountCents == null) {
      report.issues.donations.push({ donationId, code: "DONATION_MISSING_AMOUNT", detail: {} });
    }
  }

  // ---- Output
  const summary = {
    counts: report.counts,
    stats: report.stats,
    issueCounts: {
      users: report.issues.users.length,
      teams: report.issues.teams.length,
      athletes: report.issues.athletes.length,
      invites: report.issues.invites.length,
      donations: report.issues.donations.length,
      cross: report.issues.cross.length,
    },
  };

  console.log("\n=== Phase 11B Validation Summary ===");
  console.table(summary.issueCounts);
  console.log("Counts:", summary.counts);
  console.log("Stats:", summary.stats);

  if (writeReport) {
    const outDir = path.join(process.cwd(), "phase11_reports");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `phase11_report_${nowIso()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`\n✅ Wrote report: ${outPath}`);
  } else {
    console.log("\nTip: run with --writeReport to save a full JSON report.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
