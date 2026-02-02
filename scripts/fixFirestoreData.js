/**
 * Firestore Data Repair Script for fundraising-mvp (Option A - Auto-fill)
 *
 * - Auto-fills missing userId, teamId, orgId, campaignId for test data
 * - Creates placeholder users / team / campaign as needed
 * - Logs everything it changes
 *
 * SAFETY:
 *   - Set DRY_RUN = true to see what it WOULD change (no writes)
 *   - Set DRY_RUN = false to actually apply fixes
 *
 * Usage:
 *   cd fundraising-mvp/scripts
 *   node fixFirestoreData.js
 */

const admin = require("firebase-admin");

// ---------- CONFIG ----------
const DRY_RUN = false; // 🚨 set to false to APPLY changes
const DEFAULT_ORG_ID = "demo-org";
const DEFAULT_TEAM_ID = "unassigned-team";
const DEFAULT_CAMPAIGN_ID = "unknown-campaign";

admin.initializeApp({
  credential: admin.credential.cert("./serviceAccountKey.json"),
});

const db = admin.firestore();

// ---------- UTILITIES ----------
function logSection(title) {
  console.log("\n=========================================");
  console.log(title);
  console.log("=========================================\n");
}

async function ensureDocExists(collectionName, docId, defaultData) {
  const ref = db.collection(collectionName).doc(docId);
  const snap = await ref.get();

  if (!snap.exists) {
    console.log(
      `  [CREATE] ${collectionName}/${docId} (placeholder for linking)`
    );
    if (!DRY_RUN) {
      await ref.set(defaultData, { merge: true });
    }
    return { created: true, ref };
  } else {
    return { created: false, ref, data: snap.data() };
  }
}

async function createPlaceholderUser(role, note) {
  const ref = db.collection("users").doc();
  const uid = ref.id;

  const data = {
    orgId: DEFAULT_ORG_ID,
    role,
    displayName: `Test ${role} (${uid.slice(0, 6)})`,
    createdAt: new Date().toISOString(),
    note: note || "Auto-created by fixFirestoreData.js",
  };

  console.log(`  [CREATE USER] users/${uid} (role=${role})`);
  if (!DRY_RUN) {
    await ref.set(data, { merge: true });
  }

  return uid;
}

// ---------- REPAIR FUNCTIONS ----------

async function repairAthletes() {
  logSection("Repairing ATHLETES...");

  const snapshot = await db.collection("athletes").get();
  let fixed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    // orgId
    if (!data.orgId) {
      updates.orgId = DEFAULT_ORG_ID;
    }

    // userId
    if (!data.userId) {
      const uid = await createPlaceholderUser(
        "athlete",
        `Placeholder for athlete ${doc.id}`
      );
      updates.userId = uid;
    }

    // teamId
    if (!data.teamId) {
      // Ensure DEFAULT_TEAM_ID doc exists
      await ensureDocExists("teams", DEFAULT_TEAM_ID, {
        orgId: DEFAULT_ORG_ID,
        name: "Unassigned Team (Auto)",
        createdAt: new Date().toISOString(),
      });
      updates.teamId = DEFAULT_TEAM_ID;
    }

    if (Object.keys(updates).length > 0) {
      fixed++;
      console.log(`  [UPDATE] athletes/${doc.id} ->`, updates);
      if (!DRY_RUN) {
        await doc.ref.set(updates, { merge: true });
      }
    }
  }

  console.log(`ATHLETES fixed: ${fixed}`);
}

async function repairCoaches() {
  logSection("Repairing COACHES...");

  const snapshot = await db.collection("coaches").get();
  let fixed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    if (!data.orgId) {
      updates.orgId = DEFAULT_ORG_ID;
    }

    if (!data.userId) {
      const uid = await createPlaceholderUser(
        "coach",
        `Placeholder for coach ${doc.id}`
      );
      updates.userId = uid;
    }

    if (Object.keys(updates).length > 0) {
      fixed++;
      console.log(`  [UPDATE] coaches/${doc.id} ->`, updates);
      if (!DRY_RUN) {
        await doc.ref.set(updates, { merge: true });
      }
    }
  }

  console.log(`COACHES fixed: ${fixed}`);
}

async function repairDonors() {
  logSection("Repairing DONORS...");

  const snapshot = await db.collection("donors").get();
  let fixed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    if (!data.orgId) {
      updates.orgId = DEFAULT_ORG_ID;
    }

    if (!data.userId) {
      const uid = await createPlaceholderUser(
        "donor",
        `Placeholder for donor ${doc.id}`
      );
      updates.userId = uid;
    }

    if (Object.keys(updates).length > 0) {
      fixed++;
      console.log(`  [UPDATE] donors/${doc.id} ->`, updates);
      if (!DRY_RUN) {
        await doc.ref.set(updates, { merge: true });
      }
    }
  }

  console.log(`DONORS fixed: ${fixed}`);
}

async function repairDonations() {
  logSection("Repairing DONATIONS...");

  const snapshot = await db.collection("donations").get();
  let fixed = 0;

  // Ensure default campaign exists (for missing campaignId)
  await ensureDocExists("campaigns", DEFAULT_CAMPAIGN_ID, {
    orgId: DEFAULT_ORG_ID,
    name: "Unknown Campaign (Auto)",
    createdAt: new Date().toISOString(),
  });

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    if (!data.orgId) {
      updates.orgId = DEFAULT_ORG_ID;
    }

    if (!data.userId) {
      const uid = await createPlaceholderUser(
        "donor",
        `Placeholder for donation ${doc.id}`
      );
      updates.userId = uid;
    }

    if (!data.campaignId) {
      updates.campaignId = DEFAULT_CAMPAIGN_ID;
    }

    if (Object.keys(updates).length > 0) {
      fixed++;
      console.log(`  [UPDATE] donations/${doc.id} ->`, updates);
      if (!DRY_RUN) {
        await doc.ref.set(updates, { merge: true });
      }
    }
  }

  console.log(`DONATIONS fixed: ${fixed}`);
}

async function repairCampaignAthletes() {
  logSection("Repairing CAMPAIGN-ATHLETE LINKS...");

  const snapshot = await db.collection("campaignAthletes").get();
  let fixed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    if (!data.orgId) {
      updates.orgId = DEFAULT_ORG_ID;
    }

    if (!data.userId) {
      const uid = await createPlaceholderUser(
        "athlete",
        `Placeholder for campaignAthletes link ${doc.id}`
      );
      updates.userId = uid;
    }

    if (!data.campaignId) {
      updates.campaignId = DEFAULT_CAMPAIGN_ID;
    }

    if (Object.keys(updates).length > 0) {
      fixed++;
      console.log(`  [UPDATE] campaignAthletes/${doc.id} ->`, updates);
      if (!DRY_RUN) {
        await doc.ref.set(updates, { merge: true });
      }
    }
  }

  console.log(`CAMPAIGN-ATHLETE LINKS fixed: ${fixed}`);
}

// ---------- MASTER RUNNER ----------
async function run() {
  logSection("STARTING FIRESTORE DATA REPAIR (Option A - Auto-fill)");

  await repairAthletes();
  await repairCoaches();
  await repairDonors();
  await repairDonations();
  await repairCampaignAthletes();

  logSection(
    DRY_RUN
      ? "DRY RUN COMPLETE (no changes written)"
      : "DATA REPAIR COMPLETE (changes applied)"
  );
}

run().catch((err) => {
  console.error("DATA REPAIR FAILED:", err);
});
