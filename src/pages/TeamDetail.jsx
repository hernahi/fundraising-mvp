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
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";

import { useAuth } from "../context/AuthContext";
import { safeImageURL } from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";
import { FaArrowLeft } from "react-icons/fa";

import AssignCoachToTeamModal from "../components/AssignCoachToTeamModal";
import AssignTeamAthletesModal from "../components/AssignTeamAthletesModal";
import AthleteOnboardingPanel from "../components/AthleteOnboardingPanel";

function generateJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

export default function TeamDetail() {
  const { teamId } = useParams();
  const id = teamId;

  const { profile, activeOrgId, isSuperAdmin } = useAuth();

  const [team, setTeam] = useState(null);
  const [athletes, setAthletes] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [coachUser, setCoachUser] = useState(null);

  const [loading, setLoading] = useState(true);

  const [showAssignCoach, setShowAssignCoach] = useState(false);
  const [showManageAthletes, setShowManageAthletes] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const isAdmin = profile?.role === "admin" || profile?.role === "super-admin";
  const isCoach = profile?.role === "coach";
  const isAthlete = profile?.role === "athlete";
  const primaryActionClass =
    "px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-sm text-center shadow-sm";
  const secondaryActionClass =
    "px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-sm text-center";

  const canManage = isAdmin; // keep strict for Phase 12.1

  const toDateValue = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value?.toDate) return value.toDate();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };

  const profileBackTo = isAthlete && profile?.uid ? `/athletes/${profile.uid}` : "/teams";
  const profileBackLabel = isAthlete ? "Back to My Athlete Page" : "Back to Teams";

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
        const selectedOrgId = String(activeOrgId || "").trim();
        if (
          isSuperAdmin &&
          selectedOrgId &&
          teamData.orgId &&
          teamData.orgId !== selectedOrgId
        ) {
          if (!cancelled) setTeam(null);
          return;
        }

        if (profile?.orgId && teamData.orgId && teamData.orgId !== profile.orgId && profile.role !== "super-admin") {
          if (!cancelled) setTeam(null);
          return;
        }

        if (!cancelled) setTeam(teamData);

        const orgId = teamData.orgId;

        const athletesQuery =
          orgId
            ? query(collection(db, "athletes"), where("orgId", "==", orgId), where("teamId", "==", id))
            : query(collection(db, "athletes"), where("teamId", "==", id));

        const [athletesSnap, campaignsSnapByTeamId, campaignsSnapByTeamIds, coachSnap] = await Promise.all([
          getDocs(athletesQuery),
          orgId
            ? getDocs(
                query(collection(db, "campaigns"), where("orgId", "==", orgId), where("teamId", "==", id))
              )
            : getDocs(query(collection(db, "campaigns"), where("teamId", "==", id))),
          orgId
            ? getDocs(
                query(
                  collection(db, "campaigns"),
                  where("orgId", "==", orgId),
                  where("teamIds", "array-contains", id)
                )
              )
            : Promise.resolve({ docs: [] }),
          teamData.coachId ? getDoc(doc(db, "users", teamData.coachId)) : Promise.resolve(null),
        ]);

        let athleteRows = athletesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (!athleteRows.length && profile?.uid && isAthlete) {
          try {
            const selfAthleteSnap = await getDoc(doc(db, "athletes", profile.uid));
            if (selfAthleteSnap.exists()) {
              const selfAthlete = { id: selfAthleteSnap.id, ...selfAthleteSnap.data() };
              if (String(selfAthlete.teamId || "").trim() === id) {
                athleteRows = [selfAthlete];
              }
            }
          } catch (selfErr) {
            console.warn("Athlete self fallback skipped:", selfErr?.message || selfErr);
          }
        }

        const campaignRowsById = new Map();
        campaignsSnapByTeamId.docs.forEach((entry) => {
          campaignRowsById.set(entry.id, { id: entry.id, ...entry.data() });
        });
        campaignsSnapByTeamIds.docs.forEach((entry) => {
          campaignRowsById.set(entry.id, { id: entry.id, ...entry.data() });
        });

        let resolvedCoachUser =
          coachSnap && coachSnap.exists && coachSnap.exists()
            ? { id: coachSnap.id, ...coachSnap.data() }
            : null;

        if (!resolvedCoachUser) {
          const fallbackCoachName = String(teamData.coachName || teamData.coach || "").trim();
          if (fallbackCoachName) {
            resolvedCoachUser = { id: "", displayName: fallbackCoachName };
          }
        }

	        if (!resolvedCoachUser && (isAdmin || isCoach) && orgId) {
	          try {
	            const usersSnap = await getDocs(
              query(
                collection(db, "users"),
                where("orgId", "==", orgId),
                where("role", "==", "coach")
              )
            );
            const matchedCoach = usersSnap.docs
              .map((entry) => ({ id: entry.id, ...entry.data() }))
	              .find((entry) => {
	                const singleTeamId = String(entry.teamId || "").trim();
	                const teamName = String(teamData.name || "").trim();
	                const multiTeamIds = Array.isArray(entry.teamIds)
	                  ? entry.teamIds
	                  : Array.isArray(entry.assignedTeamIds)
	                    ? entry.assignedTeamIds
	                    : [];
	                const normalizedMultiTeamIds = multiTeamIds
	                  .map((teamId) => String(teamId || "").trim())
	                  .filter(Boolean);
	                return (
	                  singleTeamId === id ||
	                  singleTeamId === teamName ||
	                  normalizedMultiTeamIds.includes(id) ||
	                  normalizedMultiTeamIds.includes(teamName)
	                );
	              });
            if (matchedCoach) {
              resolvedCoachUser = matchedCoach;
            }
          } catch (coachErr) {
            console.warn("Coach fallback lookup skipped:", coachErr?.message || coachErr);
          }
        }

        if (!cancelled) {
          setAthletes(athleteRows);
          setCampaigns(Array.from(campaignRowsById.values()));
          setCoachUser(resolvedCoachUser);
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
  }, [id, profile, reloadKey, activeOrgId, isSuperAdmin]);

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
  if (loading) return <div className="p-4 md:p-6 text-gray-600 text-lg">Loading team details...</div>;
  if (!team) return <div className="p-4 md:p-6 text-gray-600 text-lg">Team not found (or access restricted).</div>;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto space-y-6 md:space-y-8">
      <Link
        to={profileBackTo}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800"
      >
        <FaArrowLeft /> {profileBackLabel}
      </Link>

      {/* HEADER */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{team.name}</h1>
          <p className="text-gray-500 mt-1">Organization: {team.orgId || "Unknown Org"}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 md:gap-3">
          {canManage && (
            <>
              <button
                onClick={() => setShowAssignCoach(true)}
                className={secondaryActionClass}
              >
                Assign Coach
              </button>

              <button
                onClick={() => setShowManageAthletes(true)}
                className={secondaryActionClass}
              >
                Manage Athletes
              </button>
            </>
          )}

          <Link to={`/teams/${id}/edit`} className={primaryActionClass}>
            Edit Team
          </Link>

          <Link
            to={`/coach/invite?teamId=${encodeURIComponent(id)}&campaignId=${encodeURIComponent(activeCampaign?.id || "")}&lockCampaign=1`}
            className={secondaryActionClass}
          >
            Onboard Athlete
          </Link>
        </div>
      </div>

      {/* INVITE BLOCK (coach/admin) */}
      {(isAdmin || isCoach) && team?.joinCode && (
        <div className="mt-6 rounded-2xl border border-slate-200 p-4 md:p-5 bg-white shadow-sm">
          <h2 className="font-semibold mb-2">Athlete Onboarding</h2>
          <p className="text-xs text-slate-500">
            Preferred flow: use Athlete Onboarding for new athletes. Team invite tools remain available here.
          </p>

          <div className="mt-4">
            <AthleteOnboardingPanel
              orgId={team.orgId}
              defaultCampaignId={activeCampaign?.id || ""}
              teamId={team.id}
              lockCampaign={Boolean(activeCampaign?.id)}
              compact
            />
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
                  <button onClick={resetJoinCode} className="px-3 py-1 text-sm rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                    Reset Code
                  </button>

                  <button onClick={toggleJoinEnabled} className="px-3 py-1 text-sm rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
                    {team.joinEnabled ? "Disable" : "Enable"}
                  </button>
                </>
              )}
            </div>
          </div>

          {!team.joinEnabled && <p className="text-xs text-red-600 mt-2">Team joining is currently disabled.</p>}
        </div>
      )}

      {/* TEAM AVATAR */}
	        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4 md:gap-6">
	          <img
	            src={safeImageURL(
	            team.avatar || team.photoURL || team.imgUrl || team.logo,
	            avatarFallback({ label: team.name || "Team", type: "team", size: 192 })
	          )}
	          onError={(e) => {
	            e.currentTarget.src = avatarFallback({
	              label: team.name || "Team",
	              type: "team",
	              size: 192,
	            });
	          }}
	          alt="Team Avatar"
	          className="w-20 h-20 rounded-full border bg-white p-1 object-contain shadow"
	        />
        <div>
          <p className="text-gray-600">{team.description || "No team description added yet."}</p>
          <div className="mt-2 text-sm text-slate-600">
            <span className="font-medium">Coach:</span>{" "}
            {coachUser ? (coachUser.displayName || coachUser.email || coachUser.id) : <span className="text-slate-400">None assigned</span>}
          </div>
        </div>
      </div>

      {/* TEAM CONTACT & NOTES */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Team Contact & Notes</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-slate-500">Address</div>
            <div className="text-slate-800">{team.address || "Not provided"}</div>
          </div>
          <div>
            <div className="text-slate-500">Phone</div>
            <div className="text-slate-800">{team.phone || "Not provided"}</div>
          </div>
        </div>

        <div className="mt-4">
          <div className="text-slate-500 text-sm">Notes</div>
          <div className="text-slate-800 text-sm whitespace-pre-wrap">
            {team.notes || "No notes added."}
          </div>
        </div>
      </section>

      {/* ATHLETES */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
        <h2 className="text-2xl font-semibold mb-3">Athletes</h2>

        {athletes.length === 0 ? (
          <p className="text-gray-500">No athletes assigned to this team.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 md:gap-5">
            {athletes.map((athlete) => (
              <Link
                key={athlete.id}
                to={`/athletes/${athlete.id}`}
                className="p-4 rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md hover:border-slate-400"
              >
                <img
                  src={safeImageURL(
                    athlete.avatar,
                    avatarFallback({ label: athlete.name || "Athlete", type: "athlete", size: 128 })
                  )}
                  alt={athlete.name}
                  className="w-16 h-16 rounded-full object-cover mx-auto"
                />
                <h3 className="text-center mt-3 font-medium">{athlete.name}</h3>
                <p className="text-center text-gray-500 text-sm">{athlete.position || ""}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* CAMPAIGNS */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
        <h2 className="text-2xl font-semibold mb-3">Campaign History</h2>

        {campaigns.length === 0 ? (
          <p className="text-gray-500">No campaigns created for this team.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
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
                    className="p-4 rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md hover:border-slate-400 flex flex-col gap-3"
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


