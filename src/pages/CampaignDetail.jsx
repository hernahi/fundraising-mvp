import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import safeImageURL from "../utils/safeImage";
import { FaEdit, FaShareAlt } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";
import AssignTeamsToCampaignModal from "../components/AssignTeamsToCampaignModal";

export default function CampaignDetail() {
  const { campaignId } = useParams();

  const [campaign, setCampaign] = useState(null);
  const [teams, setTeams] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAssignTeams, setShowAssignTeams] = useState(false);
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canEditTeams =
    profile?.role === "admin" || profile?.role === "super-admin";
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
          const athletesQ = query(
            collection(db, "athletes"),
            where("teamId", "==", normalizedTeamIds[0])
          );
          const snap = await getDocs(athletesQ);
          athleteRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } else if (normalizedTeamIds.length > 1) {
          const athletesQ = query(
            collection(db, "athletes"),
            where("teamId", "in", normalizedTeamIds.slice(0, 10))
          );
          const snap = await getDocs(athletesQ);
          athleteRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }

        setAthletes(athleteRows);

        setLoading(false);
      } catch (err) {
        console.error("Error loading campaign:", err);
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

  async function validateCoachAccess() {
    try {
      const teamsQ = query(
        collection(db, "teams"),
        where("orgId", "==", campaign.orgId),
        where("coachId", "==", profile.uid)
      );

      const snap = await getDocs(teamsQ);
      const coachTeamIds = snap.docs.map((d) => d.id);

      const hasAccess = campaign.teamIds.some((id) =>
        coachTeamIds.includes(id)
      );

      if (!hasAccess) {
        navigate("/campaigns");
      }
    } catch (err) {
      console.error("Campaign access check failed:", err);
      navigate("/campaigns");
    }
  }

  validateCoachAccess();
}, [profile?.role, profile?.uid, campaign?.teamIds, campaign?.orgId, navigate]);

  if (loading) return <div className="p-4 md:p-6 text-gray-600">Loading campaign...</div>;
  if (!campaign) return <div className="p-4 md:p-6 text-red-600">Campaign not found.</div>;

    return (
    <>
      {/* ===============================
          Campaign Detail Page
         =============================== */}
      <div className="space-y-6 md:space-y-8">
        {/* Header */}
        <div className="bg-white rounded-xl shadow p-4 md:p-6 lg:p-7 flex flex-col md:flex-row gap-4 md:gap-6">
          <img
            src={safeImageURL(campaign.imageURL)}
            alt="Campaign"
            className="w-full md:w-64 h-40 md:h-44 object-cover rounded-lg"
          />

          <div className="flex-1 min-w-0">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap gap-2 md:gap-3 mt-6">
              <Link
                to={`/campaigns/${campaign.id}/edit`}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-flex items-center justify-center gap-2 text-sm"
              >
                <FaEdit /> Edit Campaign
              </Link>

              <button
                onClick={() =>
                  navigator.clipboard.writeText(
                    `${window.location.origin}/donate/${campaign.id}`
                  )
                }
                className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 inline-flex items-center justify-center gap-2 text-sm"
              >
                <FaShareAlt /> Copy Share Link
              </button>

              {canEditTeams && (
                <button
                  onClick={() => setShowAssignTeams(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
                >
                  Assign Teams
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
          {/* Teams */}
          <div className="bg-white rounded-xl shadow p-4 md:p-6">
            <div className="text-sm text-gray-500">Participating Teams</div>
            <div className="text-3xl font-bold text-gray-800 mt-2">
              {teamCount}
            </div>
          </div>

          {/* Athletes */}
          <div className="bg-white rounded-xl shadow p-4 md:p-6">
            <div className="text-sm text-gray-500">Participating Athletes</div>
            <div className="text-3xl font-bold text-gray-800 mt-2">
              {athleteCount}
            </div>
          </div>

          {/* Placeholder for Phase 13 */}
          <div className="bg-white rounded-xl shadow p-4 md:p-6 opacity-60">
            <div className="text-sm text-gray-500">Funds Raised</div>
            <div className="text-3xl font-bold text-gray-400 mt-2">
              $0
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Coming soon
            </div>
          </div>
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
