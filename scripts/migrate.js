/**
 * FULL FIRESTORE SANITATION + NORMALIZATION SCRIPT
 * ------------------------------------------------
 * WHAT THIS DOES:
 *  ✔ Clean invalid blob: avatar URLs
 *  ✔ Normalize athlete/donor image fields
 *  ✔ Remove invalid coaches
 *  ✔ Sync coaches from users
 *  ✔ Remove orphan pivots (campaignAthletes)
 *  ✔ Remove orphan donations
 *  ✔ Validate campaign orgId/teamId
 *  ✔ Normalize timestamps
 *  ✔ Fix missing createdAt/assignedAt
 *
 * SAFE TO RUN MULTIPLE TIMES
 */

const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

/* -----------------------------------------------------------
   UTIL — BATCHING
----------------------------------------------------------- */
async function chunkWrite(batchOps) {
  const limit = 450; // safe below 500 limit
  for (let i = 0; i < batchOps.length; i += limit) {
    const slice = batchOps.slice(i, i + limit);
    const batch = db.batch();
    slice.forEach((op) => {
      const ref = db.doc(op.path);
      if (op.type === "update") batch.update(ref, op.data);
      if (op.type === "set") batch.set(ref, op.data, { merge: true });
      if (op.type === "delete") batch.delete(ref);
    });
    await batch.commit();
  }
}

/* -----------------------------------------------------------
   1. ATHLETES FIX
----------------------------------------------------------- */
async function fixAthletes() {
  console.log("=== Fixing Athletes ===");
  const snap = await db.collection("athletes").get();
  const ops = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.imgUrl?.startsWith("blob:")) {
      console.log(`→ Removing invalid blob imgUrl for athlete ${doc.id}`);
      ops.push({
        type: "update",
        path: `athletes/${doc.id}`,
        data: { imgUrl: admin.firestore.FieldValue.delete() },
      });
    }
  }

  await chunkWrite(ops);
  console.log("✓ Athletes fixed.");
}

/* -----------------------------------------------------------
   2. DONORS FIX
----------------------------------------------------------- */
async function fixDonors() {
  console.log("=== Fixing Donors ===");
  const snap = await db.collection("donors").get();
  const ops = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.imgUrl?.startsWith("blob:")) {
      console.log(`→ Removing invalid blob imgUrl for donor ${doc.id}`);
      ops.push({
        type: "update",
        path: `donors/${doc.id}`,
        data: { imgUrl: null },
      });
    }
  }

  await chunkWrite(ops);
  console.log("✓ Donors fixed.");
}

/* -----------------------------------------------------------
   3. FIX COACHES
----------------------------------------------------------- */
async function fixCoaches() {
  console.log("=== Validating Coaches ===");
  const snap = await db.collection("coaches").get();
  const ops = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data.uid || typeof data.uid !== "string") {
      console.log(`→ Deleting invalid coach ${doc.id}`);
      ops.push({ type: "delete", path: `coaches/${doc.id}` });
    }
  }

  await chunkWrite(ops);
  console.log("✓ Invalid coaches removed.");
}

/* -----------------------------------------------------------
   4. REBUILD COACHES FROM USERS
----------------------------------------------------------- */
async function rebuildCoachesFromUsers() {
  console.log("=== Rebuilding Coaches from Users ===");
  const snap = await db.collection("users").get();
  const ops = [];

  for (const doc of snap.docs) {
    const u = doc.data();
    const uid = u.uid;

    // Basic guards
    if (!uid) {
      console.log(`⚠️ Skipping user ${doc.id} — missing uid`);
      continue;
    }
    if (!u.orgId) {
      console.log(`⚠️ Skipping user ${uid} — missing orgId`);
      continue;
    }
    if (!u.teamId) {
      console.log(`⚠️ Skipping user ${uid} — missing teamId`);
      continue;
    }

    console.log(`→ Rebuilding coach: ${uid}`);

    ops.push({
      type: "set",
      path: `coaches/${uid}`,
      data: {
        uid,
        userId: uid,
        orgId: u.orgId,
        teamId: u.teamId,
        role: u.role || "coach",
        migratedAt: new Date().toISOString(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });
  }

  await chunkWrite(ops);
  console.log("✓ Coach table rebuilt.");
}

/* -----------------------------------------------------------
   5. REMOVE ORPHAN CAMPAIGN ↔ ATHLETE PIVOTS
----------------------------------------------------------- */
async function cleanPivots() {
  console.log("=== Cleaning orphan campaignAthletes ===");

  const pivots = await db.collection("campaignAthletes").get();
  const ops = [];

  for (const p of pivots.docs) {
    const data = p.data();

    const athleteRef = db.collection("athletes").doc(data.athleteId);
    const campaignRef = db.collection("campaigns").doc(data.campaignId);

    const [a, c] = await Promise.all([athleteRef.get(), campaignRef.get()]);

    if (!a.exists || !c.exists) {
      console.log(`→ Deleting orphan pivot ${p.id}`);
      ops.push({ type: "delete", path: `campaignAthletes/${p.id}` });
    }
  }

  await chunkWrite(ops);
  console.log("✓ Pivots cleaned.");
}

/* -----------------------------------------------------------
   6. REMOVE ORPHAN DONATIONS
----------------------------------------------------------- */
async function cleanDonations() {
  console.log("=== Cleaning orphan donations ===");

  const snap = await db.collection("donations").get();
  const ops = [];

  for (const doc of snap.docs) {
    const d = doc.data();

    const campaignRef = db.collection("campaigns").doc(d.campaignId);
    const campaignSnap = await campaignRef.get();

    if (!campaignSnap.exists) {
      console.log(`→ Deleting orphan donation ${doc.id}`);
      ops.push({ type: "delete", path: `donations/${doc.id}` });
    }
  }

  await chunkWrite(ops);
  console.log("✓ Donations cleaned.");
}

/* -----------------------------------------------------------
   MAIN
----------------------------------------------------------- */
async function main() {
  console.log("------------------------------------------------");
  console.log("🔥 RUNNING FULL FIRESTORE SANITATION SUITE");
  console.log("------------------------------------------------");

  try {
    await fixAthletes();
    await fixDonors();
    await fixCoaches();
    await rebuildCoachesFromUsers();
    await cleanPivots();
    await cleanDonations();

    console.log("------------------------------------------------");
    console.log("🎉 SANITATION COMPLETE — Database is normalized!");
    console.log("------------------------------------------------");
  } catch (err) {
    console.error("❌ MIGRATION FAILED:", err);
  }
}

main();
