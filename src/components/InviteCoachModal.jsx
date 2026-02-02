import { useState } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function InviteCoachModal({ onClose }) {
  const { profile, user } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Guard: profile not ready
  if (!profile?.orgId || !profile?.uid) {
    return (
      <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
        <div className="bg-white p-6 rounded w-96">
          <p className="text-red-600 text-sm">
            Unable to load profile. Please try again.
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
        orgId: profile.orgId,
        status: "pending",
        invitedBy: user.uid,
        createdAt: serverTimestamp(),
      });

      // Call Mailgun-backed Cloud Function
      const sendInviteEmail = httpsCallable(functions, "sendInviteEmail");

      await sendInviteEmail({
        toEmail: email,
        inviteId: inviteRef.id,
        appUrl,
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
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            {loading ? "Sending..." : "Send Invite"}
          </button>
        </div>
      </div>
    </div>
  );
}
