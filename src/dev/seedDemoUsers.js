import { db } from "../firebase/config";
import { setDoc, doc, serverTimestamp } from "firebase/firestore";

export const seedDemoUsers = async () => {
  const users = [
    { id: "ADMIN", displayName: "Admin User", email: "admin@test.com", role: "admin", orgId: "demo-org" },
    { id: "COACH1", displayName: "Coach One", email: "coach@test.com", role: "coach", orgId: "demo-org" },
    { id: "ATH1", displayName: "Athlete One", email: "athlete@test.com", role: "athlete", orgId: "demo-org" }
  ];

  for (const u of users) {
    await setDoc(doc(db, "users", u.id), {
      ...u,
      createdAt: serverTimestamp(),
    });
  }

  window.toast?.("✅ Demo users seeded", "success");
};
