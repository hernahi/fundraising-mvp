import React, { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Link } from "react-router-dom";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import safeImageURL from "../utils/safeImage";

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
        <h1 className="text-2xl font-semibold">Campaigns</h1>
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
          No campaigns found for this organization.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
          {campaigns.map((c) => {
            const image = safeImageURL(c.imageURL || c.image);
            const title = c.name || "Untitled Campaign";

            return (
              <article
                key={c.id}
                className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm flex flex-col"
              >
                {image ? (
                  <img
                    src={image}
                    alt={title}
                    className="w-full h-40 md:h-44 object-cover bg-slate-100"
                  />
                ) : (
                  <div className="w-full h-40 md:h-44 bg-slate-100 flex items-center justify-center text-slate-500 text-sm">
                    No Image
                  </div>
                )}

                <div className="p-4 md:p-5 flex-1 flex flex-col">
                  <h2 className="text-lg font-semibold text-slate-900 line-clamp-2">
                    {title}
                  </h2>

                  <p className="mt-2 text-sm text-slate-600 line-clamp-3">
                    {c.description || "No description available."}
                  </p>

                  <div className="mt-4">
                    <Link
                      to={`/campaigns/${c.id}`}
                      className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 w-full sm:w-auto"
                    >
                      View Details
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
