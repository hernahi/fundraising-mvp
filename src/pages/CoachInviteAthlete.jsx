import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import AthleteOnboardingPanel from "../components/AthleteOnboardingPanel";
import { FaArrowLeft } from "react-icons/fa";

export default function CoachInviteAthlete() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();

  const prefillCampaignId = searchParams.get("campaignId") || "";
  const prefillTeamId = searchParams.get("teamId") || "";

  const pageHint = useMemo(() => {
    if (prefillTeamId && prefillCampaignId) {
      return "Team and campaign context detected. You can adjust campaign before sending.";
    }
    if (prefillTeamId) {
      return "Team context detected. Invites will include this team.";
    }
    if (prefillCampaignId) {
      return "Campaign context detected. Invites will include this campaign.";
    }
    return "Use this as your primary athlete onboarding flow.";
  }, [prefillCampaignId, prefillTeamId]);

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

      <AthleteOnboardingPanel
        orgId={profile?.orgId || ""}
        defaultCampaignId={prefillCampaignId}
        teamId={prefillTeamId}
        showLegacyLink
      />
    </div>
  );
}
