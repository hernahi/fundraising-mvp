import { Link, useSearchParams } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";

export default function AddAthlete() {
  const [searchParams] = useSearchParams();

  const teamId = searchParams.get("teamId") || "";
  const campaignId = searchParams.get("campaignId") || "";

  const onboardingParams = new URLSearchParams();
  if (teamId) onboardingParams.set("teamId", teamId);
  if (campaignId) {
    onboardingParams.set("campaignId", campaignId);
    onboardingParams.set("lockCampaign", "1");
  }

  const onboardingPath = `/coach/invite${
    onboardingParams.toString() ? `?${onboardingParams.toString()}` : ""
  }`;

  return (
    <div className="p-6 max-w-2xl">
      <Link
        to="/athletes"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-3"
      >
        <FaArrowLeft /> Back to Athletes
      </Link>

      <h1 className="text-2xl font-bold text-slate-800 border-b-2 border-slate-300 pb-1">
        Legacy Route
      </h1>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
        <p className="text-sm text-slate-700">
          Athlete creation has moved to the unified onboarding flow for consistency.
        </p>
        <p className="text-xs text-slate-500">
          This legacy page is now a redirect helper and does not create athletes directly.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            to={onboardingPath}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
          >
            Continue to Athlete Onboarding
          </Link>
          <Link
            to="/athletes"
            className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm hover:bg-slate-50"
          >
            Cancel
          </Link>
        </div>
      </div>
    </div>
  );
}

