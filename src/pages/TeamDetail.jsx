// src/pages/TeamDetail.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";

import { useAuth } from "../context/AuthContext";
import { safeImageURL } from "../utils/safeImage";

import AssignCoachToTeamModal from "../components/AssignCoachToTeamModal";
import AssignTeamAthletesModal from "../components/AssignTeamAthletesModal";

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

const INVITE_EMAIL_HTML = `
  <div style="font-family: system-ui, -apple-system, sans-serif;">
    <h2>You’ve been invited to join a team</h2>
    <p>You’ve been invited to join a team on <strong>Fundraising MVP</strong>.</p>
    <p>
      <a href="{{INVITE_LINK}}"
         style="display:inline-block;padding:10px 16px;background:#0f172a;color:white;text-decoration:none;border-radius:6px;font-weight:600">
        Accept Invite
      </a>
    </p>
    <p style="font-size: 12px; color: #64748b;">
      If you didn’t expect this invite, you can ignore this email.
    </p>
  </div>
`;

const INVITE_EMAIL_TEXT = `
You’ve been invited to join a team on Fundraising MVP.

Accept your invite here:
{{INVITE_LINK}}

If you didn’t expect this invite, you can ignore this email.
`;

export default function TeamDetail() {
  const { teamId } = useParams();
  const id = teamId;

  const { user, profile } = useAuth();

  const [team, setTeam] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [coachUser, setCoachUser] = useState(null);

  const [loading, setLoading] = useState(true);

  const [inviteEmails, setInviteEmails] = useState("");
  const [sendingInvites, setSendingInvites] = useState(false);
  const [inviteStatus, setInviteStatus] = useState(null);

  const [showAssignCoach, setShowAssignCoach] = useState(false);
  const [showManageAthletes, setShowManageAthletes] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const isAdmin = profile?.role === "admin" || profile?.role === "super-admin";
  const isCoach = profile?.role === "coach";

  const canManage = isAdmin; // keep strict for Phase 12.1

  const toDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value?.toDate) return value.toDate();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };

  useEffect(() => {
    let cancelled = false;

    async function loadTeam() {
      try {
        setLoading(true);

        const teamSnap = await getDoc(doc(db, "teams", id));
        if (!teamSnap.exists()) {
          if (!cancelled) setTeam(null);
          return;
        }

        const teamData = { id: teamSnap.id, ...teamSnap.data() };

        // Basic org guard (query-level isolation remains primary; this is a safe UI check)
        if (profile?.orgId && teamData.orgId && teamData.orgId !== profile.orgId && profile.role !== "super-admin") {
          if (!cancelled) setTeam(null);
          return;
        }

        if (!cancelled) setTeam(teamData);

        const orgId = teamData.orgId;

        const [athletesSnap, campaignsSnap, coachSnap] = await Promise.all([
          getDocs(query(collection(db, "athletes"), where("orgId", "==", orgId), where("teamId", "==", id))),
          getDocs(query(collection(db, "campaigns"), where("orgId", "==", orgId), where("teamId", "==", id))),
          teamData.coachId ? getDoc(doc(db, "users", teamData.coachId)) : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setAthletes(athletesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setCampaigns(campaignsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
          setCoachUser(coachSnap && coachSnap.exists && coachSnap.exists() ? { id: coachSnap.id, ...coachSnap.data() } : null);
        }
      } catch (err) {
        console.error("Error loading team detail:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (id && profile) loadTeam();
    return () => {
      cancelled = true;
    };
  }, [id, profile, reloadKey]);

  const joinLink = useMemo(() => {
    return team?.joinCode ? `${window.location.origin}/join?code=${team.joinCode}` : null;
  }, [team]);

  const activeCampaign = useMemo(() => {
    if (!campaigns.length) return null;
    const now = Date.now();
    return (
      campaigns.find((c) => {
        const startDate = toDateValue(c.startDate);
        const endDate = toDateValue(c.endDate);
        const start = startDate ? startDate.getTime() : null;
        const end = endDate ? endDate.getTime() : null;
        return (
          c.status === "active" ||
          c.isActive === true ||
          (start && end ? now >= start && now <= end : false)
        );
      }) || null
    );
  }, [campaigns]);

  const copyJoinLink = async () => {
    if (!joinLink) return;
    await navigator.clipboard.writeText(joinLink);
    alert("Join link copied!");
  };

  const resetJoinCode = async () => {
    if (!team) return;
    if (!confirm("Reset team join code? Old links will stop working.")) return;

    const newCode = generateJoinCode();
    await updateDoc(doc(db, "teams", team.id), {
      joinCode: newCode,
      joinEnabled: true,
      updatedAt: serverTimestamp(),
    });

    setTeam((prev) => ({ ...prev, joinCode: newCode, joinEnabled: true }));
  };

  const toggleJoinEnabled = async () => {
    if (!team) return;

    await updateDoc(doc(db, "teams", team.id), {
      joinEnabled: !team.joinEnabled,
      updatedAt: serverTimestamp(),
    });

    setTeam((prev) => ({ ...prev, joinEnabled: !prev.joinEnabled }));
  };

  const sendAthleteInvites = async () => {
    if (!team || !user) return;

    if (!inviteEmails.trim()) {
      alert("Enter at least one email.");
      return;
    }

    const emails = inviteEmails
      .split("\n")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const sent = [];
    const failed = [];
    const invalid = [];

    setSendingInvites(true);
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
            orgId: team.orgId,
            teamId: team.id,
            campaignId: activeCampaign?.id || null,
            status: "pending",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(), // 7 days
            createdByUid: user.uid,
          });

          const inviteLink = `${window.location.origin}/accept-invite?invite=${inviteRef.id}`;

          await addDoc(collection(db, "mail"), {
            to: email,
            message: {
              subject: "You’ve been invited to join a team",
              html: INVITE_EMAIL_HTML.replaceAll("{{INVITE_LINK}}", inviteLink),
              text: INVITE_EMAIL_TEXT.replaceAll("{{INVITE_LINK}}", inviteLink),
            },
          });

          sent.push(email);
        } catch (err) {
          console.error("Invite failed:", email, err);
          failed.push(email);
        }
      }
    } finally {
      setInviteStatus({ sent, failed, invalid });
      setInviteEmails("");
      setSendingInvites(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-600 text-lg">Loading team details...</div>;
  if (!team) return <div className="p-6 text-gray-600 text-lg">Team not found (or access restricted).</div>;

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{team.name}</h1>
          <p className="text-gray-500 mt-1">Organization: {team.orgId || "Unknown Org"}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2">
          {canManage && (
            <>
              <button
                onClick={() => setShowAssignCoach(true)}
                className="px-4 py-2 rounded-lg bg-yellow-400 text-slate-900 hover:bg-yellow-500 font-semibold text-sm"
              >
                Assign Coach
              </button>

              <button
                onClick={() => setShowManageAthletes(true)}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-sm"
              >
                Manage Athletes
              </button>
            </>
          )}

          <Link to={`/teams/${id}/edit`} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm text-center">
            Edit Team
          </Link>

          <Link to={`/athletes/new?teamId=${id}`} className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm text-center">
            Add Athlete
          </Link>
        </div>
      </div>

      {/* INVITE BLOCK (coach/admin) */}
      {(isAdmin || isCoach) && team?.joinCode && (
        <div className="mt-6 rounded-lg border border-slate-200 p-4 bg-slate-50">
          <h2 className="font-semibold mb-2">Invite Athletes</h2>

          <div className="mt-4 space-y-3">
            <label className="block text-sm font-medium text-slate-700">Invite athletes by email (one per line)</label>

            <textarea
              rows={4}
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder="athlete1@email.com&#10;athlete2@email.com"
              className="w-full rounded-md border border-slate-300 p-2 text-sm"
            />

            {activeCampaign ? (
              <p className="text-xs text-slate-600">
                Active campaign auto-assigned: {activeCampaign.name || activeCampaign.title || activeCampaign.id}
              </p>
            ) : (
              <p className="text-xs text-amber-600">
                No active campaign found. Invites will not set a campaign.
              </p>
            )}

            <button
              onClick={sendAthleteInvites}
              disabled={sendingInvites}
              className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50"
            >
              {sendingInvites ? "Sending…" : "Send Invites"}
            </button>
          </div>

          <p className="text-sm text-slate-600 mb-3 mt-4">Share this link or code with athletes so they can join the team.</p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-3">
            <div>
              <div className="text-xs text-slate-500">Team Code</div>
              <div className="font-mono text-lg">{team.joinCode}</div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button onClick={copyJoinLink} className="px-3 py-1 text-sm rounded bg-slate-900 text-white">
                Copy Link
              </button>

              {isAdmin && (
                <>
                  <button onClick={resetJoinCode} className="px-3 py-1 text-sm rounded bg-slate-200">
                    Reset Code
                  </button>

                  <button onClick={toggleJoinEnabled} className="px-3 py-1 text-sm rounded bg-slate-200">
                    {team.joinEnabled ? "Disable" : "Enable"}
                  </button>
                </>
              )}
            </div>
          </div>

          {inviteStatus && (
            <div className="mt-3 text-sm space-y-1">
              {inviteStatus.sent.length > 0 && <div className="text-green-600">✅ Invites sent: {inviteStatus.sent.length}</div>}
              {inviteStatus.failed.length > 0 && <div className="text-red-600">❌ Failed: {inviteStatus.failed.length}</div>}
              {inviteStatus.invalid.length > 0 && (
                <div className="text-amber-600">⚠️ Invalid emails skipped: {inviteStatus.invalid.length}</div>
              )}
            </div>
          )}

          {!team.joinEnabled && <p className="text-xs text-red-600 mt-2">Team joining is currently disabled.</p>}
        </div>
      )}

      {/* TEAM AVATAR */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <img
          src={safeImageURL(team.avatar)}
          alt="Team Avatar"
          className="w-28 h-28 rounded-full border object-cover bg-white shadow"
        />
        <div>
          <p className="text-gray-600">{team.description || "No team description added yet."}</p>
          <div className="mt-2 text-sm text-slate-600">
            <span className="font-medium">Coach:</span>{" "}
            {coachUser ? (coachUser.displayName || coachUser.email || coachUser.id) : <span className="text-slate-400">None assigned</span>}
          </div>
        </div>
      </div>

      {/* ATHLETES */}
      <section>
        <h2 className="text-2xl font-semibold mb-3">Athletes</h2>

        {athletes.length === 0 ? (
          <p className="text-gray-500">No athletes assigned to this team.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {athletes.map((athlete) => (
              <Link
                key={athlete.id}
                to={`/athletes/${athlete.id}`}
                className="p-4 rounded-lg bg-white shadow hover:shadow-md transition border"
              >
                <img
                  src={safeImageURL(athlete.avatar)}
                  alt={athlete.name}
                  className="w-20 h-20 rounded-full object-cover mx-auto"
                />
                <h3 className="text-center mt-3 font-medium">{athlete.name}</h3>
                <p className="text-center text-gray-500 text-sm">{athlete.position || ""}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* CAMPAIGNS */}
      <section>
        <h2 className="text-2xl font-semibold mb-3">Campaign History</h2>

        {campaigns.length === 0 ? (
          <p className="text-gray-500">No campaigns created for this team.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...campaigns]
              .sort((a, b) => {
                const aDate = a.endDate?.toDate?.() || a.createdAt?.toDate?.() || 0;
                const bDate = b.endDate?.toDate?.() || b.createdAt?.toDate?.() || 0;
                return bDate - aDate;
              })
              .map((c) => {
                const now = Date.now();
                const startDate = toDateValue(c.startDate);
                const endDate = toDateValue(c.endDate);
                const start = startDate ? startDate.getTime() : null;
                const end = endDate ? endDate.getTime() : null;
                const isActive =
                  c.status === "active" ||
                  c.isActive === true ||
                  (start && end ? now >= start && now <= end : false);
                const title = c.name || c.title || "Campaign";

                return (
                  <div
                    key={c.id}
                    className="p-4 rounded-lg bg-white shadow hover:shadow-md transition border flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-lg">{title}</h3>
                      {isActive && (
                        <span className="text-xs font-semibold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-1">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500 text-sm">
                      Goal: ${c.goalAmount?.toLocaleString() || "0"}
                    </p>
                    <p className="text-gray-500 text-sm">
                      Raised: $
                      {Math.round(
                        Number(c.publicTotalRaisedCents || 0) / 100
                      ).toLocaleString()}
                    </p>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <Link
                        to={`/campaigns/${c.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        View Campaign
                      </Link>
                      <Link
                        to={`/donate/${c.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        View Public Page
                      </Link>
                      {isActive && (
                        <Link
                          to={`/campaigns/${c.id}/overview`}
                          className="text-blue-600 hover:underline"
                        >
                          Active Overview
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* MODALS */}
      {showAssignCoach && (
        <AssignCoachToTeamModal
          teamId={team.id}
          orgId={team.orgId}
          currentCoachId={team.coachId || null}
          onClose={(changed) => {
            setShowAssignCoach(false);
            if (changed) {
              setReloadKey((value) => value + 1);
            }
          }}
        />
      )}

      {showManageAthletes && (
        <AssignTeamAthletesModal
          orgId={team.orgId}
          teamId={team.id}
          allowUnassign={true}
          onClose={(changed) => {
            setShowManageAthletes(false);
            if (changed) {
              setReloadKey((value) => value + 1);
            }
          }}
        />
      )}
    </div>
  );
}
