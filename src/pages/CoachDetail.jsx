import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import AvatarCircle from "../components/AvatarCircle";
import ListLoadingSpinner from "../components/ListLoadingSpinner";

export default function CoachDetail() {
  const { id } = useParams();
  const { profile, activeOrgId, loading: authLoading } = useAuth();
  const orgId = activeOrgId || profile?.orgId;
  const isAdmin = ["admin", "super-admin"].includes(profile?.role);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [coach, setCoach] = useState(null);
  const [user, setUser] = useState(null);
  const [teamOptions, setTeamOptions] = useState([]);
  const [athleteCount, setAthleteCount] = useState(0);
  const [form, setForm] = useState({
    name: "",
    email: "",
    teamId: "",
    teamName: "",
  });

  useEffect(() => {
    if (authLoading || !orgId || !id) return;

    async function load() {
      setLoading(true);
      try {
        const coachSnap = await getDoc(doc(db, "coaches", id));
        if (!coachSnap.exists()) {
          setCoach(null);
          setNoAccess(false);
          return;
        }

        const coachData = { id: coachSnap.id, ...coachSnap.data() };
        if (coachData.orgId !== orgId) {
          setNoAccess(true);
          setCoach(null);
          return;
        }

        const coachUid = coachData.uid || coachData.id;
        const userSnap = coachUid ? await getDoc(doc(db, "users", coachUid)) : null;
        const userData = userSnap?.exists?.() ? { id: userSnap.id, ...userSnap.data() } : null;

        const [teamSnap, athletesSnap] = await Promise.all([
          getDocs(query(collection(db, "teams"), where("orgId", "==", orgId))),
          coachData.teamId
            ? getDocs(
                query(
                  collection(db, "athletes"),
                  where("orgId", "==", orgId),
                  where("teamId", "==", coachData.teamId)
                )
              )
            : Promise.resolve({ size: 0 }),
        ]);

        const nextTeams = teamSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setTeamOptions(nextTeams);
        setAthleteCount(athletesSnap.size || 0);

        const resolvedName = userData?.displayName || coachData.name || "";
        const resolvedEmail = userData?.email || coachData.email || "";
        const resolvedTeamId = coachData.teamId || "";
        const resolvedTeamName =
          nextTeams.find((t) => t.id === resolvedTeamId)?.name ||
          coachData.team ||
          "";

        setCoach(coachData);
        setUser(userData);
        setNoAccess(false);
        setForm({
          name: resolvedName,
          email: resolvedEmail,
          teamId: resolvedTeamId,
          teamName: resolvedTeamName,
        });
      } catch (err) {
        console.error("Failed to load coach profile:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [authLoading, id, orgId]);

  const coachStatus = useMemo(() => {
    return String(user?.status || "active").toLowerCase();
  }, [user?.status]);

  const coachUid = useMemo(() => coach?.uid || coach?.id || "", [coach?.uid, coach?.id]);

  const coachedTeams = useMemo(() => {
    if (!coachUid) return [];
    const linked = teamOptions.filter((t) => t.coachId === coachUid);
    if (form.teamId && !linked.some((t) => t.id === form.teamId)) {
      const selected = teamOptions.find((t) => t.id === form.teamId);
      if (selected) return [...linked, selected];
    }
    return linked;
  }, [coachUid, teamOptions, form.teamId]);

  const createdLabel = useMemo(() => {
    const ts = coach?.createdAt?.toDate?.();
    return ts ? ts.toLocaleDateString() : "N/A";
  }, [coach?.createdAt]);

  async function saveProfile() {
    if (!isAdmin || !coach) return;
    setSaving(true);
    try {
      const selectedTeam = teamOptions.find((t) => t.id === form.teamId);
      const nextTeamName = selectedTeam?.name || "";
      const nextCoachUid = coach.uid || coach.id;
      const nextTeamId = form.teamId || null;

      await updateDoc(doc(db, "coaches", coach.id), {
        name: form.name.trim(),
        email: form.email.trim(),
        teamId: nextTeamId,
        team: nextTeamName || null,
        updatedAt: serverTimestamp(),
      });

      if (nextCoachUid && user?.id) {
        await updateDoc(doc(db, "users", nextCoachUid), {
          displayName: form.name.trim(),
          email: form.email.trim(),
          updatedAt: serverTimestamp(),
        });
      }

      if (nextCoachUid && nextTeamId) {
        await updateDoc(doc(db, "teams", nextTeamId), {
          coachId: nextCoachUid,
          updatedAt: serverTimestamp(),
        });
      }

      setCoach((prev) =>
        prev
          ? {
              ...prev,
              name: form.name.trim(),
              email: form.email.trim(),
              teamId: nextTeamId,
              team: nextTeamName || null,
            }
          : prev
      );
      setUser((prev) =>
        prev
          ? {
              ...prev,
              displayName: form.name.trim(),
              email: form.email.trim(),
            }
          : prev
      );
      if (nextTeamId && nextCoachUid) {
        setTeamOptions((prev) =>
          prev.map((t) =>
            t.id === nextTeamId
              ? { ...t, coachId: nextCoachUid, updatedAt: new Date() }
              : t
          )
        );
      }
    } catch (err) {
      console.error("Failed to update coach profile:", err);
    } finally {
      setSaving(false);
    }
  }

  async function setAccessStatus(nextStatus) {
    if (!isAdmin || !coach) return;
    const coachUid = coach.uid || coach.id;
    if (!coachUid) return;
    setSavingStatus(true);
    try {
      await updateDoc(doc(db, "users", coachUid), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      setUser((prev) => ({
        ...(prev || {}),
        status: nextStatus,
      }));
    } catch (err) {
      console.error("Failed to update coach access status:", err);
    } finally {
      setSavingStatus(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="p-6">
        <ListLoadingSpinner />
      </div>
    );
  }

  if (noAccess) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          You do not have access to this coach profile.
        </div>
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
          Coach not found.
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <Link
        to="/coaches"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800"
      >
        <FaArrowLeft /> Back to Coaches
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <AvatarCircle
              name={form.name || "Coach"}
              imgUrl={coach.imgUrl || coach.photoURL || user?.photoURL || ""}
              size="md"
              entity="coach"
            />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold text-slate-900 truncate">
                {form.name || "Coach"}
              </h1>
              <p className="text-sm text-slate-500 truncate">{form.email || "No email"}</p>
              <p className="text-xs text-slate-400 mt-1">Created: {createdLabel}</p>
            </div>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ${
              coachStatus === "inactive"
                ? "border-slate-300 bg-slate-100 text-slate-700"
                : "border-green-200 bg-green-50 text-green-700"
            }`}
          >
            {coachStatus}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Coach Profile</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                disabled={!isAdmin}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </label>

            <label className="text-sm">
              <span className="block text-slate-600 mb-1">Email</span>
              <input
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                disabled={!isAdmin}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </label>
          </div>

          <label className="text-sm block">
            <span className="block text-slate-600 mb-1">Assigned Team</span>
            <select
              value={form.teamId}
              onChange={(e) => {
                const nextTeam = teamOptions.find((t) => t.id === e.target.value);
                setForm((prev) => ({
                  ...prev,
                  teamId: e.target.value,
                  teamName: nextTeam?.name || "",
                }));
              }}
              disabled={!isAdmin}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50"
            >
              <option value="">No team assigned</option>
              {teamOptions.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name || team.teamName || team.id}
                </option>
              ))}
            </select>
          </label>

          {isAdmin && (
            <div className="pt-2">
              <button
                type="button"
                onClick={saveProfile}
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Profile"}
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-slate-800">Account Access</h2>
          <p className="text-sm text-slate-600">
            Set whether this coach can access the app.
          </p>
          <div className="text-sm text-slate-700">
            Current status: <span className="font-medium">{coachStatus}</span>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setAccessStatus(coachStatus === "inactive" ? "active" : "inactive")}
              disabled={savingStatus}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-60 ${
                coachStatus === "inactive"
                  ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                  : "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
              }`}
            >
              {savingStatus
                ? "Saving..."
                : coachStatus === "inactive"
                ? "Activate Coach Access"
                : "Deactivate Coach Access"}
            </button>
          )}

          <div className="pt-3 border-t border-slate-100 text-sm text-slate-600 space-y-1">
            <div>Coach ID: {coach.id}</div>
            <div>User UID: {coachUid}</div>
            <div>Athletes in assigned team: {athleteCount}</div>
            <div>Teams coached: {coachedTeams.length}</div>
            {coachedTeams.length > 0 && (
              <div className="pt-1">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                  Coached Team Names
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {coachedTeams.map((team) => (
                    <span
                      key={team.id}
                      className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                    >
                      {team.name || team.teamName || team.id}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
