import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import AthleteOnboardingPanel from "../components/AthleteOnboardingPanel";
import { FaArrowLeft } from "react-icons/fa";

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

export default function CoachInviteAthlete() {
  const { profile, activeOrgId, activeOrgName, isSuperAdmin } = useAuth();
  const [searchParams] = useSearchParams();

  const prefillCampaignId = searchParams.get("campaignId") || "";
  const prefillTeamId = searchParams.get("teamId") || "";
  const lockCampaign = searchParams.get("lockCampaign") === "1";
  const role = String(profile?.role || "").toLowerCase();
  const isCoach = role === "coach";
  const resolvedOrgId = isSuperAdmin
    ? String(activeOrgId || "").trim()
    : String(profile?.orgId || "").trim();
  const resolvedOrgName = isSuperAdmin
    ? String(activeOrgName || "").trim()
    : String(profile?.orgName || "").trim();
  const coachTeamIds = useMemo(
    () => getCoachScopedTeamIds(profile),
    [
      profile?.role,
      profile?.teamId,
      JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || []),
    ]
  );
  const [teamOptions, setTeamOptions] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [teamOptionsLoading, setTeamOptionsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCoachTeams() {
      if (!isCoach || prefillTeamId) {
        setTeamOptions([]);
        setSelectedTeamId("");
        return;
      }

      if (coachTeamIds.length === 0) {
        setTeamOptions([]);
        setSelectedTeamId("");
        return;
      }

      setTeamOptionsLoading(true);
      try {
        const rows = await Promise.all(
          coachTeamIds.map(async (teamId) => {
            try {
              const snap = await getDoc(doc(db, "teams", teamId));
              return snap.exists() ? { id: snap.id, ...(snap.data() || {}) } : null;
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;

        const scopedRows = rows
          .filter(Boolean)
          .filter((team) => !resolvedOrgId || String(team?.orgId || "").trim() === resolvedOrgId);
        setTeamOptions(scopedRows);
        setSelectedTeamId((current) => {
          if (current && scopedRows.some((team) => team.id === current)) return current;
          return scopedRows[0]?.id || "";
        });
      } finally {
        if (!cancelled) setTeamOptionsLoading(false);
      }
    }

    loadCoachTeams();
    return () => {
      cancelled = true;
    };
  }, [coachTeamIds, isCoach, prefillTeamId, resolvedOrgId]);

  const effectiveTeamId = prefillTeamId || selectedTeamId;
  const selectedTeam = teamOptions.find((team) => team.id === effectiveTeamId);
  const effectiveTeamName =
    String(searchParams.get("teamName") || "").trim() ||
    String(selectedTeam?.name || selectedTeam?.teamName || "").trim();

  const pageHint = useMemo(() => {
    if (effectiveTeamId && prefillCampaignId) {
      return "Team and campaign context detected. You can adjust campaign before sending.";
    }
    if (effectiveTeamId) {
      return "Team context detected. Invites will include this team.";
    }
    if (prefillCampaignId) {
      return "Campaign context detected. Invites will include this campaign.";
    }
    return "Use this as your primary athlete onboarding flow.";
  }, [effectiveTeamId, prefillCampaignId]);

  return (
    <div className="page-container max-w-xl">
      <Link
        to="/teams"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-3"
      >
        <FaArrowLeft /> Back to Teams
      </Link>

      <div className="mb-4">
        <h1 className="page-title">Athlete Onboarding</h1>
        <p className="text-sm text-slate-600">
          Invite athletes by email and optionally assign campaign context at invite time.
        </p>
        <p className="text-xs text-slate-500 mt-2">{pageHint}</p>
      </div>

      {isCoach && !prefillTeamId && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
          <label className="block text-sm font-medium mb-1">Invite to Team</label>
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={teamOptionsLoading || teamOptions.length <= 1}
          >
            {teamOptionsLoading ? <option value="">Loading teams...</option> : null}
            {!teamOptionsLoading && teamOptions.length === 0 ? (
              <option value="">No assigned team found</option>
            ) : null}
            {teamOptions.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name || team.teamName || team.id}
              </option>
            ))}
          </select>
          {teamOptions.length === 0 && !teamOptionsLoading ? (
            <p className="mt-2 text-xs text-amber-700">
              A coach must be assigned to a team before athlete invites can be campaign-scoped.
            </p>
          ) : null}
        </div>
      )}

      <AthleteOnboardingPanel
        orgId={resolvedOrgId}
        orgName={resolvedOrgName}
        defaultCampaignId={prefillCampaignId}
        teamId={effectiveTeamId}
        teamName={effectiveTeamName}
        lockCampaign={lockCampaign}
      />
    </div>
  );
}
