import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

const INVITE_EMAIL_HTML = `
  <div style="font-family: system-ui, -apple-system, sans-serif;">
    <h2>You have been invited to join a team</h2>
    <p>You have been invited to join a team on <strong>Fundraising MVP</strong>.</p>
    <p>
      <a href="{{INVITE_LINK}}"
         style="display:inline-block;padding:10px 16px;background:#0f172a;color:white;text-decoration:none;border-radius:6px;font-weight:600">
        Accept Invite
      </a>
    </p>
    <p style="font-size: 12px; color: #64748b;">
      If you did not expect this invite, you can ignore this email.
    </p>
  </div>
`;

const INVITE_EMAIL_TEXT = `
You have been invited to join a team on Fundraising MVP.

Accept your invite here:
{{INVITE_LINK}}

If you did not expect this invite, you can ignore this email.
`;

export default function AthleteOnboardingPanel({
  orgId,
  defaultCampaignId = "",
  teamId = "",
  lockCampaign = false,
  compact = false,
  showLegacyLink = false,
  onSent = null,
}) {
  const { user } = useAuth();

  const [emailListText, setEmailListText] = useState("");
  const [campaignId, setCampaignId] = useState(defaultCampaignId || "");
  const [campaigns, setCampaigns] = useState([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setCampaignId(defaultCampaignId || "");
  }, [defaultCampaignId]);

  useEffect(() => {
    if (!orgId) return;

    async function loadCampaigns() {
      try {
        const q = query(collection(db, "campaigns"), where("orgId", "==", orgId));
        const snap = await getDocs(q);
        setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("Failed to load campaigns:", err);
      }
    }

    loadCampaigns();
  }, [orgId]);

  const helperText = useMemo(() => {
    if (teamId && campaignId) return "Invites will include both team and campaign context.";
    if (teamId) return "Invites will assign athletes to this team.";
    if (campaignId) return "Invites will include campaign context.";
    return "You can invite first, then assign team/campaign later if needed.";
  }, [teamId, campaignId]);

  const sendInvites = async () => {
    setError("");
    setResult(null);

    if (!orgId) {
      setError("Organization context is missing.");
      return;
    }

    const emails = emailListText
      .split("\n")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (emails.length === 0) {
      setError("Please enter at least one athlete email.");
      return;
    }

    const sent = [];
    const failed = [];
    const invalid = [];

    setSending(true);
    try {
      for (const email of emails) {
        if (!email.includes("@")) {
          invalid.push(email);
          continue;
        }

        try {
          const inviteRef = await addDoc(collection(db, "invites"), {
            email,
            role: "athlete",
            orgId,
            teamId: teamId || null,
            campaignId: campaignId || null,
            status: "pending",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdByUid: user?.uid || null,
          });

          const inviteLink = `${window.location.origin}/accept-invite?invite=${inviteRef.id}`;

          await addDoc(collection(db, "mail"), {
            to: email,
            message: {
              subject: "You have been invited to join a fundraising team",
              html: INVITE_EMAIL_HTML.replaceAll("{{INVITE_LINK}}", inviteLink),
              text: INVITE_EMAIL_TEXT.replaceAll("{{INVITE_LINK}}", inviteLink),
            },
            createdAt: serverTimestamp(),
          });

          sent.push(email);
        } catch (err) {
          console.error("Invite failed:", email, err);
          failed.push(email);
        }
      }
    } finally {
      const next = { sent, failed, invalid };
      setResult(next);
      setEmailListText("");
      setSending(false);
      if (typeof onSent === "function") onSent(next);
    }
  };

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div>
        <label className="block text-sm font-medium mb-1">Athlete Emails (one per line)</label>
        <textarea
          rows={compact ? 4 : 6}
          value={emailListText}
          onChange={(e) => setEmailListText(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder={"athlete1@email.com\nathlete2@email.com"}
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
          disabled={sending || lockCampaign}
        >
          <option value="">No campaign</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.title || c.id}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-slate-500">{helperText}</p>
      {lockCampaign && campaignId ? (
        <p className="text-xs text-slate-500">
          Campaign context is locked from the previous page.
        </p>
      ) : null}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && result.sent.length > 0 && (
        <p className="text-sm text-green-600">Invites sent: {result.sent.length}</p>
      )}
      {result && result.failed.length > 0 && (
        <p className="text-sm text-red-600">Failed: {result.failed.length}</p>
      )}
      {result && result.invalid.length > 0 && (
        <p className="text-sm text-amber-600">Invalid emails skipped: {result.invalid.length}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={sendInvites}
          disabled={sending}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50"
        >
          {sending ? "Sending..." : "Send Onboarding Invite"}
        </button>
        {showLegacyLink ? (
          <Link
            to="/athletes/new"
            className="text-sm text-slate-600 hover:text-slate-800 underline"
          >
            Use legacy manual add
          </Link>
        ) : null}
      </div>
    </div>
  );
}
