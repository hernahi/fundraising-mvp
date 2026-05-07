import { useEffect, useState } from "react";
import {
  collection,
  addDoc,
  Timestamp,
  serverTimestamp,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

const INVITE_EXPIRY_DAYS = 14;

export default function InviteCoachModal({ onClose }) {
  const { profile, user, activeOrgId, isSuperAdmin } = useAuth();
  const [email, setEmail] = useState("");
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inviteOrgId = (activeOrgId || profile?.orgId || "").trim();

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
      if (!inviteOrgId) {
        setTeams([]);
        setSelectedTeamId("");
        setTeamsLoading(false);
        return;
      }

      setTeamsLoading(true);
      try {
        const snap = await getDocs(
          query(collection(db, "teams"), where("orgId", "==", inviteOrgId))
        );
        const rows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
          .sort((a, b) =>
            String(a.name || a.teamName || a.id).localeCompare(
              String(b.name || b.teamName || b.id)
            )
          );

        if (!cancelled) {
          setTeams(rows);
          setSelectedTeamId((current) =>
            current && rows.some((team) => team.id === current)
              ? current
              : rows[0]?.id || ""
          );
        }
      } catch (err) {
        console.error("Failed to load coach invite teams:", err);
        if (!cancelled) {
          setTeams([]);
          setSelectedTeamId("");
          setError("Unable to load teams for this organization.");
        }
      } finally {
        if (!cancelled) setTeamsLoading(false);
      }
    }

    loadTeams();

    return () => {
      cancelled = true;
    };
  }, [inviteOrgId]);

  // Guard: profile not ready
  if (!inviteOrgId || !user?.uid) {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
        <div className="bg-white p-6 rounded w-96">
          <p className="text-red-600 text-sm">
            Unable to resolve organization. Select an organization and try again.
          </p>
          <button
            className="mt-4 px-4 py-2 border rounded"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  async function sendInvite() {
    if (!email) return;

    const selectedTeam = teams.find((team) => team.id === selectedTeamId) || null;
    if (!selectedTeam) {
      setError("Select a team before inviting a coach.");
      return;
    }

    if (!user) {
      setError("You must be signed in to send invites.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const appUrl =
        import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin;

      // Create invite document
      const inviteRef = await addDoc(collection(db, "invites"), {
        email: email.toLowerCase().trim(),
        role: "coach",
        orgId: inviteOrgId,
        orgName: profile?.orgName || "",
        teamId: selectedTeam.id,
        teamName: selectedTeam.name || selectedTeam.teamName || selectedTeam.id,
        teamIds: [selectedTeam.id],
        status: "pending",
        expiresAt: Timestamp.fromDate(
          new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
        ),
        invitedBy: user.uid,
        createdAt: serverTimestamp(),
      });

      // Call Mailgun-backed Cloud Function
      const sendInviteEmail = httpsCallable(functions, "sendInviteEmail");

      await sendInviteEmail({
        toEmail: email,
        inviteId: inviteRef.id,
        appUrl,
        mode: "initial",
      });

      onClose();
    } catch (err) {
      console.error("Invite coach failed:", err);
      const message =
        err?.message ||
        "Failed to send invite. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
      <div className="bg-white p-6 rounded w-96 space-y-4">
        <h2 className="text-lg font-semibold">Invite Coach</h2>

        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="text-xs text-slate-500">
          Coach will be onboarded under org: <span className="font-medium">{inviteOrgId}</span>
          {isSuperAdmin ? " (from active org selection)" : ""}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">Assigned Team</span>
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            disabled={teamsLoading || loading || teams.length === 0}
            className="w-full rounded border p-2"
          >
            {teamsLoading ? (
              <option value="">Loading teams...</option>
            ) : teams.length === 0 ? (
              <option value="">No teams available</option>
            ) : (
              teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name || team.teamName || team.id}
                </option>
              ))
            )}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Coach access is scoped to the selected team and its campaigns.
          </span>
        </label>

        <input
          type="email"
          placeholder="coach@email.com"
          className="w-full border p-2 rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            onClick={sendInvite}
            disabled={loading || teamsLoading || teams.length === 0}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            {loading ? "Sending..." : "Send Invite"}
          </button>
        </div>
      </div>
    </div>
  );
}
