import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import safeImageURL from "../utils/safeImage";
import { FaArrowLeft, FaEdit, FaShareAlt } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";
import AssignTeamsToCampaignModal from "../components/AssignTeamsToCampaignModal";
import AnalyticsCard from "../components/AnalyticsCard";
import { normalizeDonationAmount } from "../utils/normalizeDonation";
import { avatarFallback } from "../utils/avatarFallback";

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

function getTeamImageUrl(team = {}) {
  return String(team.avatar || team.photoURL || team.imgUrl || team.logo || "").trim();
}

export default function CampaignDetail() {
  const { campaignId } = useParams();

  const [campaign, setCampaign] = useState(null);
  const [teams, setTeams] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fundsRaised, setFundsRaised] = useState(0);
  const [giftCount, setGiftCount] = useState(0);
  const [showAssignTeams, setShowAssignTeams] = useState(false);
  const { profile } = useAuth();
  const navigate = useNavigate();
  const role = String(profile?.role || "").toLowerCase();
  const canManageCampaign = role === "admin" || role === "super-admin" || role === "coach";
  const isAthlete = role === "athlete";
  const athleteBackTo =
    profile?.uid
      ? `/athletes/${profile.uid}`
      : teams[0]?.id
        ? `/teams/${teams[0].id}`
        : "/";
  const backTo = isAthlete ? athleteBackTo : "/campaigns";
  const backLabel = isAthlete ? "Back to My Athlete Page" : "Back to Campaigns";
  const canEditTeams =
    role === "admin" || role === "super-admin";
  const primaryActionClass =
    "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-flex items-center justify-center gap-2 text-sm";
  const secondaryActionClass =
    "px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 inline-flex items-center justify-center gap-2 text-sm";
    // ---------------------------------------------------
    // Phase 12.4.3 — Derived campaign totals
    // ---------------------------------------------------
  const teamCount = teams.length;
  const athleteCount = athletes.length;

  useEffect(() => {
    async function loadData() {
      try {
        // Load campaign document
        const campaignRef = doc(db, "campaigns", campaignId);
        const campaignSnap = await getDoc(campaignRef);
        
        if (!campaignSnap.exists()) {
          setCampaign(null);
          setLoading(false);
          return;
        }

        const campaignData = { id: campaignSnap.id, ...campaignSnap.data() };
        setCampaign(campaignData);

        // Normalize campaign team IDs (Phase 12.4.1A)
          const normalizedTeamIds =
            campaignData.teamIds?.length
              ? campaignData.teamIds
              : campaignData.teamId
              ? [campaignData.teamId]
              : [];

          setCampaign((prev) => ({
            ...prev,
            teamIds: normalizedTeamIds,
          }));

        // Load participating teams (Phase 12.4.1A)
        let teamRows = [];

        if (normalizedTeamIds.length > 0) {
          if (normalizedTeamIds.length === 1) {
            const teamRef = doc(db, "teams", normalizedTeamIds[0]);
            const snap = await getDoc(teamRef);
            if (snap.exists()) {
              teamRows = [{ id: snap.id, ...snap.data() }];
            }
          } else {
            const teamsQ = query(
              collection(db, "teams"),
              where("__name__", "in", normalizedTeamIds.slice(0, 10))
            );
            const snap = await getDocs(teamsQ);
            teamRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          }
        }

        setTeams(teamRows);

        // Load athletes assigned to campaign teams
        let athleteRows = [];

        if (normalizedTeamIds.length === 1) {
          const athleteConstraints = [where("teamId", "==", normalizedTeamIds[0])];
          if (campaignData.orgId) {
            athleteConstraints.unshift(where("orgId", "==", campaignData.orgId));
          }
          const athletesQ = query(collection(db, "athletes"), ...athleteConstraints);
          const snap = await getDocs(athletesQ);
          athleteRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } else if (normalizedTeamIds.length > 1) {
          const athleteConstraints = [where("teamId", "in", normalizedTeamIds.slice(0, 10))];
          if (campaignData.orgId) {
            athleteConstraints.unshift(where("orgId", "==", campaignData.orgId));
          }
          const athletesQ = query(collection(db, "athletes"), ...athleteConstraints);
          const snap = await getDocs(athletesQ);
          athleteRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }

        setAthletes(athleteRows);

        // Load campaign donation totals (match dashboard logic)
        let donationTotal = 0;
        let donationCount = 0;
        const donationConstraints = [where("campaignId", "==", campaignId)];
        if (campaignData.orgId) {
          donationConstraints.push(where("orgId", "==", campaignData.orgId));
        }
        const donationsQ = query(collection(db, "donations"), ...donationConstraints);
        const donationsSnap = await getDocs(donationsQ);
        donationsSnap.forEach((d) => {
          const donation = d.data() || {};
          if (donation.status && donation.status !== "paid") return;
          donationTotal += normalizeDonationAmount(donation.amount);
          donationCount += 1;
        });
        setFundsRaised(donationTotal);
        setGiftCount(donationCount);

        setLoading(false);
      } catch (err) {
        console.error("Error loading campaign:", err);
        setFundsRaised(0);
        setGiftCount(0);
        setLoading(false);
      }
    }

    loadData();
  }, [campaignId]);

    // ---------------------------------------------------
    // Phase 12.4.2 — Defensive campaign visibility guard
    // ---------------------------------------------------
    // ---------------------------------------------------
// Phase 12.4.2 — Defensive campaign visibility guard
// ---------------------------------------------------
useEffect(() => {
  if (profile?.role !== "coach") return;
  if (!campaign?.teamIds?.length) return;

  const coachTeamIds = getCoachScopedTeamIds(profile);
  const hasAccess = campaign.teamIds.some((id) =>
    coachTeamIds.includes(String(id || "").trim())
  );

  if (!hasAccess) {
    navigate("/campaigns");
  }
}, [
  profile?.role,
  profile?.teamId,
  JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || []),
  campaign?.teamIds,
  navigate,
]);

  if (loading) return <div className="p-4 md:p-6 text-gray-600">Loading campaign...</div>;
  if (!campaign) return <div className="p-4 md:p-6 text-red-600">Campaign not found.</div>;

  const primaryTeam = teams[0] || {};
  const campaignImageURL =
    String(campaign.imageURL || "").trim() || getTeamImageUrl(primaryTeam);
  const campaignImageFallback = avatarFallback({
    label: primaryTeam.name || primaryTeam.teamName || campaign.teamName || campaign.name || "Team",
    type: "team",
    size: 256,
  });

  return (
    <>
      {/* ===============================
          Campaign Detail Page
         =============================== */}
      <div className="space-y-6 md:space-y-8">
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800"
        >
          <FaArrowLeft /> {backLabel}
        </Link>

        {/* Header */}
        <div className="bg-white rounded-xl shadow p-4 md:p-6 lg:p-7">
          <div className="grid grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)] gap-4 md:gap-6">
            <img
              src={safeImageURL(campaignImageURL, campaignImageFallback)}
              alt="Campaign"
              className="w-full sm:w-56 md:w-56 h-32 md:h-36 object-contain bg-slate-100 rounded-lg shrink-0 p-1"
            />

            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-800 break-words">
                {campaign.name}
              </h1>

              <div className="text-gray-600 mt-2">
                <div className="font-medium">Participating Teams:</div>

                {teams.length === 0 && (
                  <div className="text-gray-500">No teams assigned yet.</div>
                )}

                <ul className="mt-1 space-y-1">
                  {teams.map((t) => (
                    <li key={t.id}>
                      <Link
                        to={`/teams/${t.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {t.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="mt-4 text-gray-700 max-w-2xl">
                {campaign.description}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div className="font-medium text-slate-800">Public welcome line</div>
            <div className="mt-1">
              {campaign.showDefaultWelcomeMessage !== false
                ? `${teams[0]?.name || campaign.teamName || "This team"} family, friends, and fans - Thank you so much for taking the time to view our fundraiser page.`
                : "Off"}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 md:gap-3 mt-6">
              {canManageCampaign && (
                <Link
                  to={`/campaigns/${campaign.id}/edit`}
                  className={primaryActionClass}
                >
                  <FaEdit /> Edit Campaign
                </Link>
              )}

              {canEditTeams && (
                <button
                  onClick={() => setShowAssignTeams(true)}
                  className={secondaryActionClass}
                >
                  Assign Teams
                </button>
              )}

              {canManageCampaign && (
                <Link
                  to={`/coach/invite?campaignId=${encodeURIComponent(campaign.id)}&lockCampaign=1`}
                  className={secondaryActionClass}
                >
                  Add Athletes to Campaign
                </Link>
              )}

              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    `${window.location.origin}/donate/${campaign.id}`
                  )
                }
                className={secondaryActionClass}
              >
                <FaShareAlt /> Copy Share Link
              </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
          <AnalyticsCard
            title="Participating Teams"
            value={teamCount}
            subtext="Assigned to this campaign"
          />

          <AnalyticsCard
            title="Participating Athletes"
            value={athleteCount}
            subtext="Across assigned teams"
          />

          <AnalyticsCard
            title="Funds Raised"
            value={`$${Number(fundsRaised || 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`}
            subtext={`${giftCount} paid donation${giftCount === 1 ? "" : "s"}`}
          />
        </div>
      </div>

      {/* ===============================
          Phase 12.4.1B — Assign Teams Modal
          (MUST be outside page container)
         =============================== */}
      {showAssignTeams && (
        <AssignTeamsToCampaignModal
          campaign={campaign}
          orgId={campaign.orgId}
          onClose={() => setShowAssignTeams(false)}
          onSaved={(newTeamIds) => {
            setCampaign((prev) => ({
              ...prev,
              teamIds: newTeamIds,
            }));
          }}
        />
      )}
    </>
  );
}
