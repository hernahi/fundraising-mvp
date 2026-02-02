import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function JoinTeam() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, signInWithGoogle } = useAuth();

  const [code, setCode] = useState(params.get("code") || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const join = async () => {
    if (!code.trim()) {
      setError("Enter a team code.");
      return;
    }

    if (!user) return;

    if (user.role && user.role !== "athlete") {
        setError("Only athletes can join a team.");
        setLoading(false);
        return;
    }

    setLoading(true);
    setError("");

    try {
  const normalizedCode = code
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "");

  const q = query(
    collection(db, "teams"),
    where("joinCode", "==", normalizedCode),
    where("joinEnabled", "==", true),
    limit(1)
    );

      const snap = await getDocs(q);

      if (snap.empty) {
        setError("Invalid or disabled team code.");
        setLoading(false);
        return;
      }

      const team = snap.docs[0];
      const teamData = team.data();

      // 🔒 Duplicate join protection
const existingJoinQuery = query(
  collection(db, "teamAthletes"),
  where("athleteId", "==", user.uid),
  where("teamId", "==", team.id)
);

const existingJoinSnap = await getDocs(existingJoinQuery);

if (!existingJoinSnap.empty) {
  setError("You are already a member of this team.");
  setLoading(false);
  return;
}
      const joinId = `${team.id}_${user.uid}`;

await setDoc(doc(db, "teamAthletes", joinId), {
  athleteId: user.uid,
  teamId: team.id,
  orgId: teamData.orgId,
  joinedAt: serverTimestamp(),
});

      navigate(`/teams/${team.id}`);
    } catch (err) {
      console.error(err);
      setError("Failed to join team.");
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <button
          onClick={signInWithGoogle}
          className="px-6 py-3 rounded-lg bg-slate-900 text-white font-medium"
        >
          Sign in to join team
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-20 p-6 border rounded-xl">
      <h2 className="text-xl font-semibold mb-4">Join a Team</h2>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Enter team code"
        className="w-full px-3 py-2 border rounded-lg mb-3"
      />

      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}

      <button
        onClick={join}
        disabled={loading}
        className="w-full px-4 py-2 rounded-lg bg-slate-900 text-white"
      >
        {loading ? "Joining..." : "Join Team"}
      </button>
    </div>
  );
}
