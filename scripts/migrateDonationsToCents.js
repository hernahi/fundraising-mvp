import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccount = JSON.parse(
  fs.readFileSync(path.join(__dirname, "serviceAccountKey.json"), "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = getFirestore();

async function migrate() {
  const snap = await db.collection("donations").get();
  let updated = 0;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (typeof d.amount !== "number") continue;
    if (d.amount >= 1000) continue;

    const normalized = Math.round(d.amount * 100);

    await doc.ref.update({
      amount: normalized,
      legacyAmount: d.amount,
      legacyCurrencyUnit: "dollars",
      migratedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    updated++;
  }

  console.log(`✅ Migrated ${updated} donations`);
}

migrate().catch(console.error);
