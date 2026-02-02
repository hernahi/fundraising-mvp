import { db } from "../firebase/config";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export async function seedDemoUsers() {
  const users = [
    // Admin
    { id: "ADMIN_UID_HERE", role: "admin", displayName: "Admin User", email: "admin@test.com" },

    // Coach
    { id: "COACH_UID_HERE", role: "coach", orgId: "org1", displayName: "Coach Smith", email: "coach@test.com" },

    // Athletes
    { id: "ATH1_UID", role: "athlete", orgId: "org1", teamId: "team1", displayName: "John Runner", email: "john@test.com" },
    { id: "ATH2_UID", role: "athlete", orgId: "org1", teamId: "team1", displayName: "Ava Sprinter", email: "ava@test.com" },
  ];

  for (const u of users) {
    await setDoc(doc(db, "users", u.id), {
      ...u,
      createdAt: serverTimestamp()
    });
  }

  alert("✅ Demo users seeded!");
}
