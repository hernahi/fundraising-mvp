import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
  getCountFromServer,
} from "firebase/firestore";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

async function fetchTeamCounts(orgId, teamId) {
  const athletesQ = query(
    collection(db, "athletes"),
    where("orgId", "==", orgId),
    where("teamId", "==", teamId)
  );
  const campaignsQ = query(
    collection(db, "campaigns"),
    where("orgId", "==", orgId),
    where("teamId", "==", teamId)
  );

  const [a, c] = await Promise.all([getCountFromServer(athletesQ), getCountFromServer(campaignsQ)]);
  return { athletes: a.data().count || 0, campaigns: c.data().count || 0 };
}

export default function Teams() {
  const { profile, activeOrgId, activeOrgName } = useAuth();

  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [countsByTeam, setCountsByTeam] = useState({});
  const [coachMap, setCoachMap] = useState({});
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");

  const role = profile?.role || "";
  const isSuperAdmin = role === "super-admin";
  const isAdmin = role === "admin" || isSuperAdmin;
  const isCoach = role === "coach";

  const resolvedOrgId = useMemo(() => {
    if (!profile) return null;
    if (isSuperAdmin) return activeOrgId || null;
    return profile.orgId || null;
  }, [profile, isSuperAdmin, activeOrgId]);

  const resolvedUid = useMemo(() => {
    return profile?.uid || profile?.id || profile?.userId || null;
  }, [profile]);
  const orgDisplayName = isSuperAdmin
    ? activeOrgName || resolvedOrgId || "-"
    : profile?.orgName || resolvedOrgId || "-";

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
      setError("");
      setLoading(true);
      setCountsByTeam({});
      setCoachMap({});

      try {
        if (!resolvedOrgId) {
          if (!cancelled) {
            setTeams([]);
            setLoading(false);
          }
          return;
        }

        const teamsRef = collection(db, "teams");

        // Coach scoping: query-level isolation
        const qParts = [
          where("orgId", "==", resolvedOrgId),
          orderBy("createdAt", "desc"),
        ];

        if (isCoach && resolvedUid) {
          qParts.unshift(where("coachId", "==", resolvedUid));
        }

        const q = query(teamsRef, ...qParts);

        const snap = await getDocs(q);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (!cancelled) {
          setTeams(rows);
          setLoading(false);
        }

        const uniqueCoachIds = Array.from(
          new Set(rows.map((t) => t.coachId).filter(Boolean))
        );
        if (uniqueCoachIds.length > 0) {
          const nextCoachMap = {};
          await Promise.all(
            uniqueCoachIds.map(async (coachId) => {
              try {
                const snap = await getDoc(doc(db, "users", coachId));
                if (snap.exists()) {
                  const data = snap.data();
                  nextCoachMap[coachId] =
                    data.displayName || data.name || data.email || coachId;
                } else {
                  nextCoachMap[coachId] = coachId;
                }
              } catch {
                nextCoachMap[coachId] = coachId;
              }
            })
          );
          if (!cancelled) setCoachMap(nextCoachMap);
        }

        // Load counts in background (still within this effect)
        const next = {};
        await Promise.all(
          rows.map(async (t) => {
            try {
              const counts = await fetchTeamCounts(resolvedOrgId, t.id);
              next[t.id] = counts;
            } catch (e) {
              next[t.id] = { athletes: 0, campaigns: 0 };
            }
          })
        );

        if (!cancelled) setCountsByTeam(next);
      } catch (e) {
        console.error("❌ Teams query failed:", e);
        if (!cancelled) {
          setError(e?.message || "Failed to load teams.");
          setLoading(false);
        }
      }
    }

    loadTeams();
    return () => {
      cancelled = true;
    };
  }, [resolvedOrgId, isCoach, resolvedUid]);

  const visibleTeams = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    let rows = teams;

    if (assignmentFilter === "assigned") {
      rows = rows.filter((t) => !!t.coachId);
    } else if (assignmentFilter === "unassigned") {
      rows = rows.filter((t) => !t.coachId);
    }

    if (q) {
      rows = rows.filter((t) => {
        const name = (t.name || "").toLowerCase();
        const code = (t.code || "").toLowerCase();
        const coachName = (coachMap[t.coachId] || "").toLowerCase();
        return name.includes(q) || code.includes(q) || coachName.includes(q);
      });
    }

    return [...rows].sort((a, b) => {
      if (sortBy === "athletes") {
        const aCount = countsByTeam[a.id]?.athletes || 0;
        const bCount = countsByTeam[b.id]?.athletes || 0;
        return bCount - aCount;
      }
      if (sortBy === "campaigns") {
        const aCount = countsByTeam[a.id]?.campaigns || 0;
        const bCount = countsByTeam[b.id]?.campaigns || 0;
        return bCount - aCount;
      }
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }, [teams, search, assignmentFilter, sortBy, countsByTeam, coachMap]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Teams</h1>
          <p className="text-sm text-gray-500">
            {isSuperAdmin ? (
              <>
                Viewing teams for selected organization{" "}
                <span className="font-medium">{orgDisplayName}</span>
              </>
            ) : (
              <>
                Viewing teams for your organization{" "}
                <span className="font-medium">{orgDisplayName}</span>
              </>
            )}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {isCoach
              ? "Open a team to onboard athletes, share join tools, and review campaign history."
              : "Create the team first, then manage coach assignment, athlete onboarding, and campaign history from the team detail page."}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teams (name, code, coach)…"
            className="w-full sm:w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-yellow-200"
          />
          <select
            value={assignmentFilter}
            onChange={(e) => setAssignmentFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="all">All teams</option>
            <option value="assigned">Coach assigned</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="name">Sort: Name</option>
            <option value="athletes">Sort: Athletes</option>
            <option value="campaigns">Sort: Campaigns</option>
          </select>

          {isAdmin && (
            <Link
              to="/teams/new"
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 shadow-sm"
            >
              + New Team
            </Link>
          )}
        </div>
      </div>

      {isSuperAdmin && !resolvedOrgId && (
        <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
          <div className="font-medium">Select an organization to view teams.</div>
          <div className="mt-1 text-yellow-800">
            Your super-admin account uses <span className="font-mono">activeOrgId</span> to scope data views.
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="text-sm text-gray-500">Loading teams…</div>
        ) : !resolvedOrgId ? (
          <div className="text-sm text-gray-500">No organization selected.</div>
        ) : visibleTeams.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="text-base font-medium">No Teams Found</div>
            <div className="mt-1 text-sm text-gray-500">
              Start by creating a team for your organization.
            </div>

            {isAdmin && (
              <div className="mt-4">
                <Link
                  to="/teams/new"
                  className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                >
                  + Create your first team
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleTeams.map((t) => {
              const counts = countsByTeam[t.id] || { athletes: 0, campaigns: 0 };

              return (
                <Link
                  key={t.id}
                  to={`/teams/${t.id}`}
                  className={classNames(
                    "rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md hover:border-slate-400",
                    "focus:outline-none focus:ring-2 focus:ring-yellow-200"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold">{t.name || "Untitled Team"}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        Team ID: <span className="font-mono">{t.id}</span>
                      </div>
                    </div>

                    {t.code ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-mono">
                        {t.code}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center gap-3 text-sm text-gray-600">
                    <span>{counts.athletes} athlete{counts.athletes === 1 ? "" : "s"}</span>
                    <span className="text-gray-300">•</span>
                    <span>{counts.campaigns} campaign{counts.campaigns === 1 ? "" : "s"}</span>
                  </div>

                  <div className="mt-2 text-xs text-gray-500">
                    Coach:{" "}
                    {t.coachId ? (
                      <span>{coachMap[t.coachId] || t.coachId}</span>
                    ) : (
                      <span className="text-gray-400">None</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
