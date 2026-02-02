import { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { buildCoachTotals } from "../utils/coachAttribution";
import InviteCoachModal from "../components/InviteCoachModal";

function centsToDollars(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

export default function Coaches() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState([]);
  const [rollups, setRollups] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [teams, setTeams] = useState([]);
  const [usersByUid, setUsersByUid] = useState({});
  const [showInvite, setShowInvite] = useState(false);

  const isAdmin = ["admin", "super-admin"].includes(profile?.role);

  useEffect(() => {
    if (!profile?.orgId) return;

    async function load() {
      setLoading(true);

      // 1️⃣ Load coaches
      const coachesSnap = await getDocs(
        query(
          collection(db, "coaches"),
          where("orgId", "==", profile.orgId)
        )
      );

      const coachRows = coachesSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      }));

      // 1️⃣ Load user profiles for coaches (JOIN by uid)
      const coachUids = coachRows.map(c => c.uid).filter(Boolean);

      // Firestore "in" queries are limited to 10 items (OK for MVP)
      let usersMap = {};
      if (coachUids.length > 0) {
        const usersSnap = await getDocs(
          query(
            collection(db, "users"),
            where("uid", "in", coachUids.slice(0, 10))
          )
        );

        usersSnap.docs.forEach(d => {
          usersMap[d.data().uid] = d.data();
        });
      }

      setUsersByUid(usersMap);

      // 2️⃣ Load rollups (for performance summary)
      const rollupsSnap = await getDocs(
        query(
          collection(db, "donation_rollups"),
          where("orgId", "==", profile.orgId)
        )
      );

      const rollupRows = rollupsSnap.docs.map(d => d.data());

      // 3️⃣ Load campaigns (for attribution)
      const campaignsSnap = await getDocs(
        query(
          collection(db, "campaigns"),
          where("orgId", "==", profile.orgId)
        )
      );

      const campaignRows = campaignsSnap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      }));

      // 4️⃣ Load teams (for attribution)
      const teamsSnap = await getDocs(
        query(
          collection(db, "teams"),
          where("orgId", "==", profile.orgId)
        )
      );

const teamRows = teamsSnap.docs.map(d => ({
  id: d.id,
  ...d.data(),
}));

      setCoaches(coachRows);
      setRollups(rollupRows);
      setCampaigns(campaignRows);
      setTeams(teamRows);
      setLoading(false);
    }

    load();
  
  }, [profile?.orgId]);

  if (!["admin", "super-admin", "coach"].includes(profile?.role)) {
    return <div>Access Restricted</div>;
  }

  if (loading) return <div>Loading coaches…</div>;

  const coachTotals = buildCoachTotals({
  rollups,
  campaigns,
  teams,
});

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

      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-100">
            <th className="p-2 text-left">Coach</th>
            <th className="p-2 text-left">Email</th>
            <th className="p-2 text-right">Teams</th>
            <th className="p-2 text-right">Funds Raised</th>
            <th className="p-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {coaches.map(c => {
    const totals = coachTotals[c.uid] || { amount: 0, count: 0 };
    const user = usersByUid[c.uid] || {};

            return (
              <tr key={c.id} className="border-t">
              {/* Coach */}
              <td className="p-2">{user.displayName || "Coach"}</td>

              {/* Email */}
              <td className="p-2">{user.email || "-"}</td>

              {/* Teams (computed from teams collection) */}
              <td className="p-2 text-right">
                {teams.filter(t => t.coachId === c.uid).length}
              </td>

              {/* Funds Raised */}
              <td className="p-2 text-right">
                {centsToDollars(totals.amount)}
              </td>

              {/* Status (from users collection) */}
              <td className="p-2 text-center">
                <StatusBadge status={user.status || "active"} />
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }) {
  const color =
    status === "active"
      ? "bg-green-100 text-green-700"
      : "bg-gray-200 text-gray-600";

  return (
    <span className={`px-2 py-1 rounded text-xs ${color}`}>
      {status || "unknown"}
    </span>
  );
}

