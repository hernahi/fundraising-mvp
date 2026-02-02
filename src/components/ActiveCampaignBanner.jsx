import React from "react";
import { Link } from "react-router-dom";
import { useCampaign } from "../context/CampaignContext";
import { useAuth } from "../context/AuthContext";

export default function ActiveCampaignBanner() {
  const { campaigns } = useCampaign();
  const { activeCampaignId } = useAuth();

  if (!activeCampaignId) return null;

  const active = campaigns.find((c) => c.id === activeCampaignId);
  if (!active) return null;

  return (
    <div className="w-full bg-blue-50 border-b border-blue-200 px-6 py-3 flex items-center justify-between">
      <div className="flex flex-col">
        <span className="font-semibold text-blue-700">{active.name}</span>
        <span className="text-xs text-blue-500">
          {active.startDate || "--"} → {active.endDate || "--"}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <Link
          to={`/campaigns/${active.id}/overview`}
          className="text-sm text-blue-700 underline hover:text-blue-900"
        >
          View Campaign
        </Link>
      </div>
    </div>
  );
}
