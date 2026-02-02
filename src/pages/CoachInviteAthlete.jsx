import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function CoachInviteAthlete() {
  const { profile } = useAuth();

  const [email, setEmail] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile?.orgId) return;

    const loadCampaigns = async () => {
      try {
        const q = query(
          collection(db, "campaigns"),
          where("orgId", "==", profile.orgId)
        );
        const snap = await getDocs(q);
        setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("Failed to load campaigns:", err);
      }
    };

    loadCampaigns();
  }, [profile?.orgId]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (!email) {
      setError("Please enter an email address.");
      return;
    }

    if (!profile?.orgId) {
      setError("Your organization could not be determined.");
      return;
    }

    setSending(true);

    try {
      const inviteRef = await addDoc(collection(db, "invites"), {
        email: email.toLowerCase(),
        role: "athlete",
        orgId: profile.orgId,
        campaignId: campaignId || null,
        status: "pending",
        createdAt: serverTimestamp(),
      });

      const inviteLink = `${window.location.origin}/accept-invite?invite=${inviteRef.id}`;

      await addDoc(collection(db, "mail"), {
        to: email,
        message: {
          subject: "You have been invited to join a fundraising team",
          html: `
            <p>You have been invited to join a fundraising team as an athlete.</p>
            <p>Click the link below to accept your invitation:</p>
            <p>
              <a href="${inviteLink}">
                Accept Invitation
              </a>
            </p>
            <p>If you were not expecting this invite, you can safely ignore this email.</p>
          `,
          text: `
You have been invited to join a fundraising team as an athlete.

Accept your invitation:
${inviteLink}

If you were not expecting this invite, you can safely ignore this email.
          `,
        },
      });

      setEmail("");
      setCampaignId("");
      setSuccess(true);
    } catch (err) {
      console.error("Failed to send athlete invite:", err);
      setError("Failed to send invite. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page-container max-w-xl">
      <h1 className="page-title">Invite Athlete</h1>

      <p className="text-sm text-slate-600 mb-6">
        Invite an athlete to join your fundraising team. Athletes will receive
        an email with instructions to accept.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Athlete Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
            placeholder="athlete@email.com"
            disabled={sending}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Assign Campaign (optional)
          </label>
          <select
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={sending}
          >
            <option value="">No campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.title || c.id}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && (
          <p className="text-sm text-green-600">
            Invite sent successfully.
          </p>
        )}

        <button
          type="submit"
          disabled={sending}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send Athlete Invite"}
        </button>
      </form>
    </div>
  );
}
