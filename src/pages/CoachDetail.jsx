// src/pages/CoachDetail.jsx
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import ListLoadingSpinner from "../components/ListLoadingSpinner";
import AvatarCircle from "../components/AvatarCircle";
import CardStatBadge from "../components/CardStatBadge";

import { db } from "../firebase/config";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
} from "../firebase/firestore";

export default function CoachDetail() {
  const { id } = useParams();
  const { profile, loading: authLoading } = useAuth();

  const [coach, setCoach] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noAccess, setNoAccess] = useState(false);

  const [teamInfo, setTeamInfo] = useState(null);
  const [athletes, setAthletes] = useState([]);

  /* -------------------------------------------------------------
     Load coach
  ------------------------------------------------------------- */
  useEffect(() => {
    if (authLoading || !profile) return;

    const ref = doc(db, "coaches", id);

    const unsub = onSnapshot(
      ref,
      snap => {
        if (!snap.exists()) {
          setCoach(null);
          setNoAccess(false);
          setLoading(false);
          return;
        }

        const data = { id: snap.id, ...snap.data() };

        if (data.orgId !== profile.orgId) {
          console.warn("🚫 Coach belongs to another org");
          setNoAccess(true);
          setCoach(null);
        } else {
          setCoach(data);
          setNoAccess(false);
        }

        setLoading(false);
      },
      err => {
        console.error("❌ Coach listener error:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [authLoading, profile, id]);

  /* -------------------------------------------------------------
     Load team + athletes
  ------------------------------------------------------------- */
  useEffect(() => {
    if (!coach || !coach.teamId) return;

    const load = async () => {
      try {
        const teamRef = doc(db, "teams", coach.teamId);
        const teamSnap = await getDocs(query(
          collection(db, "teams"),
          where("__name__", "==", coach.teamId)
        ));

        setTeamInfo(teamSnap.docs[0] ? { id: coach.teamId, ...teamSnap.docs[0].data() } : null);

        const athQ = query(
          collection(db, "athletes"),
          where("teamId", "==", coach.teamId),
          where("orgId", "==", coach.orgId)
        );

        const athSnap = await getDocs(athQ);
        setAthletes(athSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("❌ Failed loading team/athletes:", err);
      }
    };

    load();
  }, [coach]);

  /* -------------------------------------------------------------
     States
  ------------------------------------------------------------- */
  if (authLoading || loading) {
    return (
      <div className="p-6">
        <ListLoadingSpinner />
      </div>
    );
  }

  if (noAccess) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4">
          You don’t have access to view this coach.
        </div>
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-2xl p-4">
          Coach not found.
        </div>
      </div>
    );
  }

  const created = coach.createdAt?.toDate
    ? coach.createdAt.toDate().toLocaleDateString()
    : "—";

  // ⭐ Phase D: Avatar fallback
  const avatarUrl =
    coach.imgUrl ||
    coach.photoURL ||
    null;

  /* -------------------------------------------------------------
     UI
  ------------------------------------------------------------- */
  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* HEADER */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-center gap-5">
          <AvatarCircle name={coach.name} imgUrl={avatarUrl} size="xl" />

          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900 truncate">
              {coach.name}
            </h1>
            <p className="text-sm text-slate-600 truncate">
              {coach.role || "Coach"} 
              {coach.teamId && (
                <span className="text-slate-400"> · Team {coach.team}</span>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Coach profile · Created {created}
            </p>
          </div>

          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
            Coach
          </span>
        </div>

        {/* GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* LEFT */}
          <div className="lg:col-span-2 space-y-6">

            {/* SUMMARY */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-4">
                Summary
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <CardStatBadge label="Team" value={coach.team || "—"} />
                <CardStatBadge label="Role" value={coach.role || "Coach"} />
                <CardStatBadge label="Athletes" value={athletes.length} />
              </div>
            </div>

            {/* ATHLETES LIST */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-semibold text-slate-800 mb-4">
                Assigned Athletes
              </h2>

              {athletes.length === 0 ? (
                <p className="text-sm text-slate-500">No assigned athletes.</p>
              ) : (
                <ul className="divide-y">
                  {athletes.map(a => {
                    // ⭐ Phase D fallback
                    const aAvatar =
                      a.imgUrl ||
                      a.photoURL ||
                      null;

                    return (
                      <li key={a.id} className="py-3 flex items-center justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">{a.name}</p>
                          <p className="text-xs text-slate-500 truncate">
                            #{a.jersey || "—"} · {a.position || "Position N/A"}
                          </p>
                        </div>
                        <Link
                          to={`/athletes/${a.id}`}
                          className="text-xs text-yellow-600 underline hover:text-yellow-500"
                        >
                          View →
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

          </div>

          {/* RIGHT */}
          <div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">
                Details
              </h3>

              <dl className="space-y-2 text-sm">
                <Detail label="Name" value={coach.name} />
                <Detail label="Role" value={coach.role} />
                <Detail label="Email" value={coach.email} />
                <Detail label="Team" value={coach.team} />
                <Detail label="Org" value={coach.orgId} />
                <Detail label="Created" value={created} />
              </dl>

              <div className="mt-4">
                <Link
                  to="/coaches"
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition"
                >
                  ← Back to Coaches
                </Link>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 text-right">{value || "—"}</dd>
    </div>
  );
}
