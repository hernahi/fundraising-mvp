import React, { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Link } from "react-router-dom";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function Campaigns() {
  const { user, profile, loading } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  const orgId = profile?.orgId || null;
  const role = (profile?.role || "").toLowerCase();

  useEffect(() => {
    async function load() {
      if (!user || !orgId) {
        setLoadingCampaigns(false);
        return;
      }

      try {
        setLoadingCampaigns(true);

        let campaignsQuery;

        if (role === "coach") {
          const teamsQ = query(
            collection(db, "teams"),
            where("orgId", "==", orgId),
            where("coachId", "==", profile.uid)
          );

          const teamsSnap = await getDocs(teamsQ);
          const coachTeamIds = teamsSnap.docs.map((d) => d.id);

          if (coachTeamIds.length === 0) {
            setCampaigns([]);
            return;
          }

          campaignsQuery = query(
            collection(db, "campaigns"),
            where("teamIds", "array-contains-any", coachTeamIds.slice(0, 10))
          );
        } else {
          campaignsQuery = query(
            collection(db, "campaigns"),
            where("orgId", "==", orgId)
          );
        }

        const snap = await getDocs(campaignsQuery);
        setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("Error loading campaigns:", err);
      } finally {
        setLoadingCampaigns(false);
      }
    }

    load();
  }, [user, orgId, role, profile?.uid]);

  if (loading || loadingCampaigns) {
    return <div className="p-4 md:p-6 text-base">Loading campaigns...</div>;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 md:gap-4 mb-5 md:mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-500">
            Open a campaign to assign teams, review performance, and launch fundraising activity.
          </p>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
          No campaigns found for this organization.
          <div className="mt-2 text-sm text-slate-500">
            Create the team structure first, then add campaigns for those teams.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
          {campaigns.map((c) => {
            const title = c.name || "Untitled Campaign";
            const goal = Number(c.goal || c.goalAmount || 0);
            const isPublic = c.isPublic === true;

            return (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                className="group block rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <article className="overflow-hidden rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md group-hover:border-slate-400">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-base font-semibold text-slate-900 line-clamp-2">
                        {title}
                      </h2>
                      <span className="shrink-0 text-[11px] font-medium text-slate-500 rounded-full border border-slate-300 px-2 py-0.5">
                        View details
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-slate-600 line-clamp-2">
                      {c.description || "No description available."}
                    </p>

                    <div className="mt-3 flex items-center gap-2 text-xs">
                      <span className="rounded-full border border-slate-300 px-2 py-0.5 text-slate-600">
                        {goal > 0 ? `Goal $${goal.toLocaleString()}` : "No goal"}
                      </span>
                      <span
                        className={[
                          "rounded-full px-2 py-0.5",
                          isPublic
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-200 text-slate-600",
                        ].join(" ")}
                      >
                        {isPublic ? "Public" : "Private"}
                      </span>
                    </div>
                  </div>
                </article>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
