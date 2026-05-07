import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, addDoc, doc, getDoc, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import { FaArrowLeft } from "react-icons/fa";

import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { db } from "../firebase/config";

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

async function fetchTeamsByIds(ids) {
  const uniqueIds = Array.from(
    new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) return [];

  const teamRows = await Promise.all(
    uniqueIds.map(async (teamId) => {
      try {
        const snap = await getDoc(doc(db, "teams", teamId));
        return snap.exists() ? { id: snap.id, ...(snap.data() || {}) } : null;
      } catch {
        return null;
      }
    })
  );

  return teamRows.filter(Boolean);
}

function getTeamImageUrl(team = {}) {
  return String(team.avatar || team.photoURL || team.imgUrl || team.logo || "").trim();
}

export default function AddCampaign() {
  const navigate = useNavigate();
  const { push } = useToast();
  const { profile, activeOrgId, activeOrgName, isSuperAdmin } = useAuth();

  const role = String(profile?.role || "").toLowerCase();
  const isCoach = role === "coach";
  const isAdmin = role === "admin" || role === "super-admin";
  const resolvedOrgId = String(
    isSuperAdmin ? activeOrgId || "" : profile?.orgId || ""
  ).trim();
  const orgDisplayName = isSuperAdmin
    ? activeOrgName || resolvedOrgId || "the selected organization"
    : profile?.orgName || resolvedOrgId || "your organization";
  const coachTeamIds = useMemo(
    () => getCoachScopedTeamIds(profile),
    [profile?.role, profile?.teamId, JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || [])]
  );

  const [teamOptions, setTeamOptions] = useState([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    teamId: "",
    description: "",
    goal: "",
    startDate: "",
    endDate: "",
    videoUrl: "",
    imageURL: "",
    isPublic: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadTeams() {
      if (!resolvedOrgId || (!isAdmin && !isCoach)) {
        if (!cancelled) {
          setTeamOptions([]);
          setLoadingTeams(false);
        }
        return;
      }

      try {
        setLoadingTeams(true);
        let rows = [];

        if (isCoach) {
          rows = (await fetchTeamsByIds(coachTeamIds)).filter(
            (team) => String(team?.orgId || "").trim() === resolvedOrgId
          );
        } else {
          const snap = await getDocs(
            query(collection(db, "teams"), where("orgId", "==", resolvedOrgId))
          );
          rows = snap.docs.map((entry) => ({ id: entry.id, ...(entry.data() || {}) }));
        }

        rows.sort((a, b) =>
          String(a.name || a.teamName || a.id).localeCompare(
            String(b.name || b.teamName || b.id)
          )
        );

        if (!cancelled) {
          setTeamOptions(rows);
          setForm((prev) => ({
            ...prev,
            teamId:
              prev.teamId && rows.some((team) => team.id === prev.teamId)
                ? prev.teamId
                : rows[0]?.id || "",
          }));
        }
      } catch (err) {
        console.error("Failed to load campaign team options:", err);
        if (!cancelled) {
          setTeamOptions([]);
        }
      } finally {
        if (!cancelled) setLoadingTeams(false);
      }
    }

    loadTeams();
    return () => {
      cancelled = true;
    };
  }, [resolvedOrgId, isAdmin, isCoach, JSON.stringify(coachTeamIds)]);

  if (!isAdmin && !isCoach) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          Access restricted.
        </div>
      </div>
    );
  }

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();

    if (!resolvedOrgId) {
      push("Select an organization before creating a campaign.", "warning");
      return;
    }
    if (!form.name.trim()) {
      push("Campaign name required", "warning");
      return;
    }
    if (!form.teamId.trim()) {
      push("Assigned team required", "warning");
      return;
    }

    setLoading(true);
    try {
      const selectedTeam = teamOptions.find((team) => team.id === form.teamId);
      const resolvedImageURL = form.imageURL.trim() || getTeamImageUrl(selectedTeam);
      const ref = await addDoc(collection(db, "campaigns"), {
        name: form.name.trim(),
        orgId: resolvedOrgId,
        orgName: String(profile?.orgName || resolvedOrgId).trim(),
        teamId: form.teamId,
        teamName: String(
          selectedTeam?.name || selectedTeam?.teamName || form.teamId
        ).trim(),
        description: form.description.trim(),
        goal: Number(form.goal) || 0,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        videoUrl: form.videoUrl.trim(),
        imageURL: resolvedImageURL,
        isPublic: Boolean(form.isPublic),
        donations: 0,
        status: "draft",
        createdByUid: String(profile?.uid || "").trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      push("Campaign created successfully.", "success");
      navigate(`/campaigns/${ref.id}`);
    } catch (err) {
      console.error("Failed to create campaign:", err);
      push("Failed to create campaign", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <Link
        to="/campaigns"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-3"
      >
        <FaArrowLeft /> Back to Campaigns
      </Link>

      <div className="mb-4">
        <h1 className="text-3xl font-bold text-slate-800">New Campaign</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a campaign for {orgDisplayName}.
        </p>
      </div>

      <form onSubmit={submit} className="max-w-2xl space-y-4 rounded-xl bg-white p-6 shadow">
        <div>
          <label className="text-sm text-slate-600">Campaign Name</label>
          <input
            name="name"
            value={form.name}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            placeholder="2026 Spring Campaign"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Assigned Team</label>
          <select
            name="teamId"
            value={form.teamId}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            disabled={loadingTeams || loading || teamOptions.length === 0}
          >
            <option value="">Select a team</option>
            {teamOptions.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name || team.teamName || team.id}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {isCoach
              ? "You can create campaigns only for your assigned team."
              : "Choose the team this campaign belongs to."}
          </p>
        </div>

        <div>
          <label className="text-sm text-slate-600">Goal</label>
          <input
            name="goal"
            value={form.goal}
            onChange={onChange}
            type="number"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            placeholder="10000"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm text-slate-600">Start Date</label>
            <input
              name="startDate"
              value={form.startDate}
              onChange={onChange}
              type="date"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">End Date</label>
            <input
              name="endDate"
              value={form.endDate}
              onChange={onChange}
              type="date"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-600">Story / Description</label>
          <textarea
            name="description"
            value={form.description}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 h-28 focus:ring-2 focus:ring-blue-200"
            placeholder="Help support our season..."
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">YouTube Video URL</label>
          <input
            name="videoUrl"
            value={form.videoUrl}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            placeholder="https://youtu.be/VIDEO_ID"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Campaign Image URL</label>
          <input
            name="imageURL"
            value={form.imageURL}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            placeholder="https://..."
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="isPublic"
            checked={form.isPublic}
            onChange={onChange}
            className="h-4 w-4 rounded border-slate-300"
          />
          Make this campaign public
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <Link
            to="/campaigns"
            className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 text-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading || loadingTeams || !resolvedOrgId || teamOptions.length === 0}
            className="px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create Campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
