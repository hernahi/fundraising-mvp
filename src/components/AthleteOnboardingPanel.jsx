import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function AthleteOnboardingPanel({
  orgId,
  orgName = "",
  defaultCampaignId = "",
  teamId = "",
  teamName = "",
  lockCampaign = false,
  compact = false,
  showLegacyLink = false,
  onSent = null,
}) {
  const { user, profile } = useAuth();
  const INVITE_EXPIRY_DAYS = 14;

  const [emailListText, setEmailListText] = useState("");
  const [campaignId, setCampaignId] = useState(defaultCampaignId || "");
  const [campaigns, setCampaigns] = useState([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [resolvedOrgName, setResolvedOrgName] = useState(
    String(orgName || profile?.orgName || "").trim()
  );
  const [resolvedTeamName, setResolvedTeamName] = useState(String(teamName || "").trim());

  function withTimeout(promise, timeoutMs, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  }

  function isAuthConfigurationError(err) {
    const text = String(err?.message || err || "").toLowerCase();
    const code = String(err?.code || "").toLowerCase();
    return (
      code.includes("auth/") ||
      code.includes("functions/unauthenticated") ||
      text.includes("api key") ||
      text.includes("securetoken") ||
      text.includes("identitytoolkit") ||
      text.includes("permission_denied") ||
      text.includes("permission denied")
    );
  }

  useEffect(() => {
    setCampaignId(defaultCampaignId || "");
  }, [defaultCampaignId]);

  useEffect(() => {
    setResolvedOrgName(String(orgName || profile?.orgName || "").trim());
  }, [orgName, profile?.orgName]);

  useEffect(() => {
    setResolvedTeamName(String(teamName || "").trim());
  }, [teamName]);

  useEffect(() => {
    let cancelled = false;

    async function resolveScopeNames() {
      try {
        if (orgId && !String(orgName || "").trim() && !String(profile?.orgName || "").trim()) {
          const orgSnap = await getDoc(doc(db, "organizations", orgId));
          if (!cancelled && orgSnap.exists()) {
            setResolvedOrgName(String(orgSnap.data()?.name || orgId).trim());
          }
        }

        if (teamId && !String(teamName || "").trim()) {
          const teamSnap = await getDoc(doc(db, "teams", teamId));
          if (!cancelled && teamSnap.exists()) {
            setResolvedTeamName(
              String(teamSnap.data()?.name || teamSnap.data()?.teamName || teamId).trim()
            );
          }
        }
      } catch (err) {
        console.warn("Invite scope name resolution skipped:", err?.message || err);
      }
    }

    resolveScopeNames();
    return () => {
      cancelled = true;
    };
  }, [orgId, orgName, profile?.orgName, teamId, teamName]);

  useEffect(() => {
    if (!orgId) return;

    async function loadCampaigns() {
      try {
        const maybeAddDefaultCampaign = async (rowsById) => {
          const normalizedDefaultCampaignId = String(defaultCampaignId || "").trim();
          if (!normalizedDefaultCampaignId || rowsById.has(normalizedDefaultCampaignId)) return;

          try {
            const campaignSnap = await getDoc(doc(db, "campaigns", normalizedDefaultCampaignId));
            if (!campaignSnap.exists()) return;

            const campaign = { id: campaignSnap.id, ...(campaignSnap.data() || {}) };
            const campaignOrgId = String(campaign.orgId || "").trim();
            const directTeamId = String(campaign.teamId || "").trim();
            const multiTeamIds = Array.isArray(campaign.teamIds)
              ? campaign.teamIds.map((id) => String(id || "").trim()).filter(Boolean)
              : [];
            const belongsToOrg = !orgId || campaignOrgId === orgId;
            const belongsToTeam = !teamId || directTeamId === teamId || multiTeamIds.includes(teamId);

            if (belongsToOrg && belongsToTeam) {
              rowsById.set(campaign.id, campaign);
            }
          } catch (err) {
            console.warn("Default invite campaign lookup skipped:", err?.message || err);
          }
        };

        if (teamId) {
          const [directResult, multiTeamResult] = await Promise.allSettled([
            getDocs(
              query(
                collection(db, "campaigns"),
                where("orgId", "==", orgId),
                where("teamId", "==", teamId)
              )
            ),
            getDocs(
              query(
                collection(db, "campaigns"),
                where("orgId", "==", orgId),
                where("teamIds", "array-contains", teamId)
              )
            ),
          ]);
          const directSnap = directResult.status === "fulfilled" ? directResult.value : null;
          const multiTeamSnap =
            multiTeamResult.status === "fulfilled" ? multiTeamResult.value : null;

          if (directResult.status === "rejected") {
            console.warn("Direct team campaign query skipped:", directResult.reason?.message || directResult.reason);
          }
          if (multiTeamResult.status === "rejected") {
            console.warn(
              "Multi-team campaign query skipped:",
              multiTeamResult.reason?.message || multiTeamResult.reason
            );
          }

          const rowsById = new Map();
          (directSnap?.docs || []).forEach((d) => {
            rowsById.set(d.id, { id: d.id, ...d.data() });
          });
          (multiTeamSnap?.docs || []).forEach((d) => {
            rowsById.set(d.id, { id: d.id, ...d.data() });
          });
          await maybeAddDefaultCampaign(rowsById);
          const scopedRows = Array.from(rowsById.values()).filter((entry) => {
            if (String(entry?.orgId || "").trim() !== orgId) return false;
            const directTeamId = String(entry?.teamId || "").trim();
            const multiTeamIds = Array.isArray(entry?.teamIds)
              ? entry.teamIds.map((id) => String(id || "").trim()).filter(Boolean)
              : [];
            return directTeamId === teamId || multiTeamIds.includes(teamId);
          });
          setCampaigns(scopedRows);
          return;
        }

        const isCoach = String(profile?.role || "").toLowerCase() === "coach";
        if (isCoach) {
          setCampaigns([]);
          return;
        }
        const q = query(collection(db, "campaigns"), where("orgId", "==", orgId));
        const snap = await getDocs(q);
        const rowsById = new Map();
        snap.docs.forEach((d) => rowsById.set(d.id, { id: d.id, ...d.data() }));
        await maybeAddDefaultCampaign(rowsById);
        setCampaigns(Array.from(rowsById.values()));
      } catch (err) {
        console.error("Failed to load campaigns:", err);
      }
    }

    loadCampaigns();
  }, [orgId, profile?.role, teamId, defaultCampaignId]);

  useEffect(() => {
    if (!campaignId) return;
    if (campaigns.some((campaign) => campaign.id === campaignId)) return;
    if (lockCampaign && defaultCampaignId && campaignId === defaultCampaignId) return;
    setCampaignId("");
  }, [campaignId, campaigns, defaultCampaignId, lockCampaign]);

  useEffect(() => {
    if (campaignId || !teamId || campaigns.length !== 1) return;
    setCampaignId(campaigns[0].id);
  }, [campaignId, campaigns, teamId]);

  const effectiveInviteCampaignId =
    String(campaignId || "").trim() ||
    (teamId && campaigns.length === 1 ? String(campaigns[0].id || "").trim() : "");

  const helperText = useMemo(() => {
    if (teamId && effectiveInviteCampaignId) return "Invites will include both team and campaign context.";
    if (teamId) return "Invites will assign athletes to this team.";
    if (effectiveInviteCampaignId) return "Invites will include campaign context.";
    return "You can invite first, then assign team/campaign later if needed.";
  }, [teamId, effectiveInviteCampaignId]);

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
      const appUrl = import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin;
      const sendInviteEmail = httpsCallable(functions, "sendInviteEmail");
      let inviteOrgName = resolvedOrgName || orgId;
      let inviteTeamName = resolvedTeamName || "";

      if (!inviteOrgName && orgId) {
        try {
          const orgSnap = await getDoc(doc(db, "organizations", orgId));
          if (orgSnap.exists()) {
            inviteOrgName = String(orgSnap.data()?.name || orgId).trim();
          }
        } catch (err) {
          console.warn("Invite org name resolution skipped:", err?.message || err);
        }
      }

      if (teamId && !inviteTeamName) {
        try {
          const teamSnap = await getDoc(doc(db, "teams", teamId));
          if (teamSnap.exists()) {
            inviteTeamName = String(
              teamSnap.data()?.name || teamSnap.data()?.teamName || teamId
            ).trim();
          }
        } catch (err) {
          console.warn("Invite team name resolution skipped:", err?.message || err);
        }
      }

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
            orgName: inviteOrgName || orgId,
            teamId: teamId || null,
            teamName: inviteTeamName || "",
	            campaignId: effectiveInviteCampaignId || null,
            status: "pending",
            expiresAt: Timestamp.fromDate(
              new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
            ),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdByUid: user?.uid || null,
          });

          await withTimeout(
            sendInviteEmail({
              toEmail: email,
              inviteId: inviteRef.id,
              appUrl,
              mode: "initial",
            }),
            15000,
            "Invite send timed out."
          );

          sent.push(email);
        } catch (err) {
          console.error("Invite failed:", email, err);
          failed.push(email);
          if (isAuthConfigurationError(err)) {
            setError(
              "Invite sending stopped because Firebase auth/API key restrictions blocked the request. Update the web API key restrictions, then retry."
            );
            break;
          }
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
      {(resolvedOrgName || resolvedTeamName) && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-medium text-slate-700">Current scope:</span>{" "}
          {resolvedOrgName ? `Org: ${resolvedOrgName}` : `Org ID: ${orgId}`}
          {resolvedTeamName ? ` · Team: ${resolvedTeamName}` : ""}
        </div>
      )}
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
