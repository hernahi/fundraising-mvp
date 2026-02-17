// src/pages/Athletes.jsx

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { safeImageURL } from "../utils/safeImage";

// ---------------------------------------------------
// ATHLETE STATUS HELPERS (Phase 12.3.3)
// ---------------------------------------------------
function getAthleteStatus(ath) {
  if (ath.status === "inactive") return "inactive";
  if (!ath.userId && ath.inviteId) return "invited";
  if (ath.userId) return "active";
  return "unknown";
}

function StatusBadge({ status }) {
  const styles = {
    active: "bg-green-100 text-green-800",
    invited: "bg-yellow-100 text-yellow-800",
    inactive: "bg-gray-200 text-gray-700",
    unknown: "bg-red-100 text-red-800",
  };

  const labels = {
    active: "Active",
    invited: "Invited",
    inactive: "Inactive",
    unknown: "Unknown",
  };

  return (
    <span
      className={`px-2 py-1 rounded-full text-xs font-medium ${
        styles[status] || styles.unknown
      }`}
    >
      {labels[status] || labels.unknown}
    </span>
  );
}

export default function Athletes() {
  const { profile } = useAuth();

  const [athletes, setAthletes] = useState([]);
  const [teams, setTeams] = useState([]);
  const [teamFilter, setTeamFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  // 🔹 Bulk selection
  const [selectedIds, setSelectedIds] = useState([]);
  const [assignTeamId, setAssignTeamId] = useState("");

  // ---------------------------------------------------
  // ACCESS CONTROL FLAGS
  // ---------------------------------------------------
  const isSuperAdmin = profile?.role === "super-admin";
  const isAdmin = profile?.role === "admin";
  const isCoach = profile?.role === "coach";

  // ---------------------------------------------------
  // LOAD ATHLETES + TEAMS
  // ---------------------------------------------------
  useEffect(() => {
    if (!profile?.orgId || (!isAdmin && !isCoach && !isSuperAdmin)) {
      setLoading(false);
      return;
    }

    async function loadData() {
      try {
        setLoading(true);

// -----------------------------
// LOAD TEAMS FIRST
// -----------------------------
let teamsQ = query(
  collection(db, "teams"),
  where("orgId", "==", profile.orgId)
);

if (isCoach && profile.uid) {
  teamsQ = query(
    collection(db, "teams"),
    where("orgId", "==", profile.orgId),
    where("coachId", "==", profile.uid)
  );
}

const teamsSnap = await getDocs(teamsQ);
const teamRows = teamsSnap.docs.map((d) => ({
  id: d.id,
  ...d.data(),
}));

setTeams(teamRows);

// -----------------------------
// LOAD ATHLETES (ROLE-SCOPED)
// -----------------------------
let athleteRows = [];

if (isCoach) {
  const coachTeamIds = teamRows.map((t) => t.id);

  if (coachTeamIds.length === 0) {
    athleteRows = [];
  } else if (coachTeamIds.length === 1) {
    const athletesQ = query(
      collection(db, "athletes"),
      where("orgId", "==", profile.orgId),
      where("teamId", "==", coachTeamIds[0])
    );
    const snap = await getDocs(athletesQ);
    athleteRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else if (coachTeamIds.length <= 10) {
    const athletesQ = query(
      collection(db, "athletes"),
      where("orgId", "==", profile.orgId),
      where("teamId", "in", coachTeamIds)
    );
    const snap = await getDocs(athletesQ);
    athleteRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    console.warn("Coach has >10 teams; athlete query requires batching.");
    athleteRows = [];
  }
} else {
  const athletesQ = query(
    collection(db, "athletes"),
    where("orgId", "==", profile.orgId)
  );
  const snap = await getDocs(athletesQ);
  athleteRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

setAthletes(athleteRows);

// Coach defaults
if (isCoach && teamRows.length > 0) {
  setTeamFilter(teamRows[0].id);
  setAssignTeamId(teamRows[0].id);
}

      } catch (err) {
        console.error("❌ Failed to load athletes/teams:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [profile?.orgId, isAdmin, isCoach, isSuperAdmin, profile?.uid]);

  // ---------------------------------------------------
  // FILTERED ATHLETES
  // ---------------------------------------------------
  const visibleAthletes = useMemo(() => {
    if (teamFilter === "all") return athletes;
    if (teamFilter === "unassigned") {
      return athletes.filter((a) => !a.teamId);
    }
    return athletes.filter((a) => a.teamId === teamFilter);
  }, [athletes, teamFilter]);

  // ---------------------------------------------------
  // BULK SELECTION HELPERS
  // ---------------------------------------------------
  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAllVisible = () => {
    setSelectedIds(visibleAthletes.map((a) => a.id));
  };

  const clearSelection = () => {
    setSelectedIds([]);
  };

  // ---------------------------------------------------
  // BULK ASSIGN
  // ---------------------------------------------------
  const bulkAssign = async () => {
    if (!assignTeamId || selectedIds.length === 0) return;

    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();

      selectedIds.forEach((athleteId) => {
        const ref = doc(db, "athletes", athleteId);
        batch.update(ref, {
          teamId: assignTeamId,
          updatedAt: now,
        });
      });

      await batch.commit();

      // Update local state
      setAthletes((prev) =>
        prev.map((a) =>
          selectedIds.includes(a.id)
            ? { ...a, teamId: assignTeamId }
            : a
        )
      );

      clearSelection();
    } catch (err) {
      console.error("❌ Bulk assign failed:", err);
      alert("Failed to assign athletes.");
    }
  };

  // ---------------------------------------------------
  // ACCESS CONTROL
  // ---------------------------------------------------
  if (!isSuperAdmin && !isAdmin && !isCoach) {
    return (
      <div className="p-4 md:p-8">
        <h1 className="text-2xl font-semibold text-red-600">
          Access Restricted
        </h1>
        <p className="mt-2 text-gray-600">
          Only coaches and administrators can view athletes.
        </p>
        <Link
          to="/"
          className="inline-block mt-4 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
        >
          Return Home
        </Link>
      </div>
    );
  }

  // ---------------------------------------------------
  // PAGE
  // ---------------------------------------------------
  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-8 md:space-y-10">
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 md:gap-5 lg:gap-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Athletes</h1>
          <p className="text-gray-500 mt-1">
            View and manage athletes in your organization.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            Tip: click the checkbox at the top-left of an athlete card to select
            it. Selecting athletes reveals the batch assignment bar so you can
            assign them to a team in one action.
          </p>
        </div>

        <div className="flex w-full lg:w-auto flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          {/* TEAM FILTER */}
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-white w-full sm:w-auto"
            disabled={isCoach}
          >
            <option value="all">All Teams</option>
            <option value="unassigned">Unassigned</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          {(isAdmin || isCoach) && (
            <Link
              to="/athletes/add"
              className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow text-center w-full sm:w-auto"
            >
              + Add Athlete
            </Link>
          )}
        </div>
      </div>

      {/* BULK ACTION BAR */}
      {selectedIds.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:items-center bg-yellow-50 border border-yellow-200 p-4 md:p-5 rounded-lg">
          <strong className="text-sm">{selectedIds.length} selected</strong>

          <button
            onClick={selectAllVisible}
            className="px-3 py-2 bg-white border rounded text-sm w-full sm:w-auto"
          >
            Select all
          </button>

          <select
            value={assignTeamId}
            onChange={(e) => setAssignTeamId(e.target.value)}
            className="border rounded px-2 py-2 text-sm w-full sm:w-auto"
          >
            <option value="">Assign to team…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <button
            onClick={bulkAssign}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm w-full sm:w-auto"
          >
            Assign
          </button>

          <button
            onClick={clearSelection}
            className="px-3 py-2 bg-gray-200 rounded text-sm w-full sm:w-auto"
          >
            Clear
          </button>
        </div>
      )}

      {/* LOADING */}
      {loading && <p className="text-gray-600">Loading athletes…</p>}

      {/* EMPTY */}
      {!loading && visibleAthletes.length === 0 && (
        <div className="p-10 bg-white border rounded-xl text-center shadow">
          <h2 className="text-xl font-semibold">No Athletes Found</h2>
          <p className="text-gray-500 mt-2">
            No athletes match the selected filter.
          </p>
        </div>
      )}

      {/* GRID */}
      {!loading && visibleAthletes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
          {visibleAthletes.map((ath) => {
            const teamName =
              teams.find((t) => t.id === ath.teamId)?.name ||
              "Unassigned";

            return (
              <div
                key={ath.id}
                className="border bg-white rounded-xl shadow hover:shadow-lg transition p-4 md:p-5 lg:p-6 flex flex-col items-center text-center"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(ath.id)}
                  onChange={() => toggleSelect(ath.id)}
                  className="self-start mb-2 h-4 w-4"
                />

                <img
                  src={safeImageURL(
                    ath.avatar,
                    `https://ui-avatars.com/api/?background=0f172a&color=fff&size=256&name=${encodeURIComponent(
                      ath.name || "Athlete"
                    )}`
                  )}
                  alt={ath.name}
                  className="w-24 h-24 rounded-full object-cover border shadow bg-gray-50"
                />

                <h3 className="text-xl font-semibold mt-4">
                  {ath.name || ath.displayName || "Unnamed Athlete"}
                </h3>

                <div className="mt-2 flex gap-2 justify-center items-center">
                  <StatusBadge status={getAthleteStatus(ath)} />

                  {!ath.teamId && (
                    <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                      Unassigned
                    </span>
                  )}
                </div>

                <p className="text-gray-500 mt-1 text-sm">
                  {teamName}
                </p>

                <div className="grid grid-cols-2 gap-3 mt-6 w-full">
                  <Link
                    to={`/athletes/${ath.id}`}
                    className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-center text-sm"
                  >
                    View
                  </Link>

                  {(isAdmin || isCoach) && (
                    <Link
                      to={`/athletes/${ath.id}/edit`}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-center text-sm"
                    >
                      Edit
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
