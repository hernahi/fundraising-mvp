import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  documentId,
  query,
  where,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { buildCoachTotals } from "../utils/coachAttribution";
import InviteCoachModal from "../components/InviteCoachModal";

function centsToDollars(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function resolveCoachStatus(userData, coachData) {
  return String(userData?.status || coachData?.status || "active").toLowerCase();
}

function resolveCoachRole(userData, coachData) {
  return String(userData?.role || coachData?.role || "").toLowerCase();
}

function getCoachScopedTeamIds(profile) {
  if (!profile) return [];
  const role = String(profile.role || "").toLowerCase();
  if (role !== "coach") return [];
  const fromArray = Array.isArray(profile.teamIds)
    ? profile.teamIds
    : Array.isArray(profile.assignedTeamIds)
      ? profile.assignedTeamIds
      : [];
  const normalized = fromArray
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const single = String(profile.teamId || "").trim();
  if (single) normalized.push(single);
  return Array.from(new Set(normalized));
}

export default function Coaches() {
  const { profile, activeOrgId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState([]);
  const [rollups, setRollups] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [teams, setTeams] = useState([]);
  const [usersByUid, setUsersByUid] = useState({});
  const [showInvite, setShowInvite] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  const orgId = activeOrgId || profile?.orgId;
  const isAdmin = ["admin", "super-admin"].includes(profile?.role);
  const isCoach = String(profile?.role || "").toLowerCase() === "coach";
  const coachTeamIds = getCoachScopedTeamIds(profile);

  useEffect(() => {
    if (!orgId) return;

    async function load() {
      setLoading(true);
      try {
        const coachesSnap = await getDocs(
          query(collection(db, "coaches"), where("orgId", "==", orgId))
        );

        const coachRows = coachesSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        const coachUids = coachRows.map((c) => c.uid).filter(Boolean);
        const usersMap = {};
        await Promise.all(
          coachUids.slice(0, 100).map(async (uid) => {
            try {
              const userSnap = await getDoc(doc(db, "users", uid));
              if (userSnap.exists()) {
                usersMap[uid] = userSnap.data();
              }
            } catch (_) {
              // Skip unreadable user docs so one record does not block page load.
            }
          })
        );

        const [rollupsSnap, campaignsSnap, teamsSnap] = await Promise.all([
          isAdmin
            ? getDocs(
                query(collection(db, "donation_rollups"), where("orgId", "==", orgId))
              )
            : Promise.resolve({ docs: [] }),
          (async () => {
            if (!isCoach) {
              return getDocs(
                query(collection(db, "campaigns"), where("orgId", "==", orgId))
              );
            }
            if (coachTeamIds.length === 0) return { docs: [] };
            const chunks = [];
            for (let i = 0; i < coachTeamIds.length; i += 10) {
              chunks.push(coachTeamIds.slice(i, i + 10));
            }
            const snaps = await Promise.all(
              chunks.map((chunk) => {
                const teamConstraint =
                  chunk.length === 1
                    ? where("teamId", "==", chunk[0])
                    : where("teamId", "in", chunk);
                return getDocs(
                  query(
                    collection(db, "campaigns"),
                    where("orgId", "==", orgId),
                    teamConstraint
                  )
                );
              })
            );
            const dedupe = new Map();
            snaps.forEach((snap) =>
              snap.docs.forEach((entry) => dedupe.set(entry.id, entry))
            );
            return { docs: Array.from(dedupe.values()) };
          })(),
          (async () => {
            if (!isCoach) {
              return getDocs(query(collection(db, "teams"), where("orgId", "==", orgId)));
            }
            if (coachTeamIds.length === 0) return { docs: [] };
            const chunks = [];
            for (let i = 0; i < coachTeamIds.length; i += 10) {
              chunks.push(coachTeamIds.slice(i, i + 10));
            }
            const snaps = await Promise.all(
              chunks.map((chunk) =>
                getDocs(
                  query(
                    collection(db, "teams"),
                    where("orgId", "==", orgId),
                    where(documentId(), "in", chunk)
                  )
                )
              )
            );
            const dedupe = new Map();
            snaps.forEach((snap) =>
              snap.docs.forEach((entry) => dedupe.set(entry.id, entry))
            );
            return { docs: Array.from(dedupe.values()) };
          })(),
        ]);

        setUsersByUid(usersMap);
        setCoaches(coachRows);
        setRollups(rollupsSnap.docs.map((d) => d.data()));
        setCampaigns(
          campaignsSnap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        );
        setTeams(
          teamsSnap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        );
      } catch (err) {
        console.error("Failed to load coaches page data:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [orgId, isAdmin, isCoach, JSON.stringify(coachTeamIds)]);

  const coachTotals = buildCoachTotals({
    rollups,
    campaigns,
    teams,
  });

  const withDisplayData = useMemo(() => {
    return coaches.map((c) => {
      const user = usersByUid[c.uid] || {};
      const role = resolveCoachRole(user, c);
      const status = resolveCoachStatus(user, c);
      const assignedTeamIds = new Set(
        teams.filter((t) => t.coachId === c.uid).map((t) => t.id)
      );
      if (c.teamId && teams.some((t) => t.id === c.teamId)) {
        assignedTeamIds.add(c.teamId);
      }
      const teamsCount = assignedTeamIds.size;
      const raisedCents = Number((coachTotals[c.uid] || { amount: 0 }).amount || 0);
      const name = user.displayName || c.name || "Coach";
      const email = user.email || c.email || "-";

      return {
        coach: c,
        user,
        role,
        status,
        teamsCount,
        raisedCents,
        name,
        email,
      };
    });
  }, [coaches, usersByUid, teams, coachTotals]);

  const hiddenNonCoachCount = useMemo(
    () => withDisplayData.filter((row) => row.role && row.role !== "coach").length,
    [withDisplayData]
  );

  const rows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filtered = withDisplayData
      .filter((row) => row.role === "coach")
      .filter((row) => {
        const statusMatch = statusFilter === "all" || row.status === statusFilter;
        const searchMatch =
          !normalizedSearch ||
          row.name.toLowerCase().includes(normalizedSearch) ||
          row.email.toLowerCase().includes(normalizedSearch);
        return statusMatch && searchMatch;
      });

    return [...filtered].sort((a, b) => {
      let left;
      let right;

      if (sortBy === "teams") {
        left = a.teamsCount;
        right = b.teamsCount;
      } else if (sortBy === "raised") {
        left = a.raisedCents;
        right = b.raisedCents;
      } else if (sortBy === "status") {
        left = a.status;
        right = b.status;
      } else {
        left = a.name.toLowerCase();
        right = b.name.toLowerCase();
      }

      if (left < right) return sortDir === "asc" ? -1 : 1;
      if (left > right) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [withDisplayData, searchTerm, statusFilter, sortBy, sortDir]);

  function SortableHeader({ label, value, className = "" }) {
    const isActive = sortBy === value;
    const indicator = isActive ? (sortDir === "asc" ? "^" : "v") : "";
    return (
      <th className={`p-2 text-left ${className}`}>
        <button
          type="button"
          onClick={() => {
            if (sortBy === value) {
              setSortDir((d) => (d === "asc" ? "desc" : "asc"));
            } else {
              setSortBy(value);
              setSortDir("asc");
            }
          }}
          className="inline-flex items-center gap-1 hover:text-blue-700"
        >
          <span>{label}</span>
          <span className="text-xs">{indicator}</span>
        </button>
      </th>
    );
  }

  if (!["admin", "super-admin", "coach"].includes(profile?.role)) {
    return <div>Access Restricted</div>;
  }

  if (loading) return <div>Loading coaches...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Coaches</h1>

        {isAdmin && (
          <>
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded"
              onClick={() => setShowInvite(true)}
            >
              Invite Coach
            </button>

            {showInvite && (
              <InviteCoachModal onClose={() => setShowInvite(false)} />
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search coach or email..."
          className="border rounded px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-3 py-2 text-sm bg-white"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <div className="text-sm text-gray-600 flex items-center md:justify-end">
          Showing {rows.length} of {coaches.length}
        </div>
      </div>

      {hiddenNonCoachCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Hidden {hiddenNonCoachCount} non-coach records due to role mismatch.
        </div>
      )}

      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-100">
            <SortableHeader label="Coach" value="name" />
            <th className="p-2 text-left">Email</th>
            <SortableHeader label="Teams" value="teams" className="text-right" />
            <SortableHeader label="Funds Raised" value="raised" className="text-right" />
            <SortableHeader label="Status" value="status" className="text-center" />
            <th className="p-2 text-center">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const c = row.coach;

            return (
              <tr key={c.id} className="border-t">
                <td className="p-2">{row.name}</td>
                <td className="p-2">{row.email}</td>
                <td className="p-2 text-right">{row.teamsCount}</td>
                <td className="p-2 text-right">{centsToDollars(row.raisedCents)}</td>
                <td className="p-2 text-center">
                  <StatusBadge status={row.status || "active"} />
                </td>
                <td className="p-2 text-center">
                  <Link
                    to={`/coaches/${c.id}`}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    View Profile
                  </Link>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr className="border-t">
              <td className="p-4 text-center text-gray-500" colSpan={6}>
                No coaches match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "").toLowerCase();
  const color =
    normalized === "active"
      ? "bg-green-100 text-green-700"
      : "bg-gray-200 text-gray-600";

  return (
    <span className={`px-2 py-1 rounded text-xs ${color}`}>
      {normalized || "unknown"}
    </span>
  );
}
