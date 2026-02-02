// src/pages/AddCoach.jsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

import { db } from "../firebase/config";
import { collection, addDoc, serverTimestamp } from "../firebase/firestore";

export default function AddCoach() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [teamId, setTeamId] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!profile?.orgId) return;

    await addDoc(collection(db, "coaches"), {
      name,
      teamId,
      orgId: profile.orgId,
      createdAt: serverTimestamp(),
    });

    navigate("/coaches");
  }

  return (
    <div className="p-6 max-w-lg">
      <h1 className="text-2xl font-semibold mb-6">Add Coach</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-medium mb-1">Name</label>
          <input
            className="w-full border p-2 rounded-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block font-medium mb-1">Team ID</label>
          <input
            className="w-full border p-2 rounded-lg"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          className="px-4 py-2 bg-yellow-400 text-slate-900 rounded-lg hover:bg-yellow-300 font-medium"
        >
          Save Coach
        </button>
      </form>
    </div>
  );
}
