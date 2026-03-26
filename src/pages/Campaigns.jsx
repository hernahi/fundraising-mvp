import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Link } from "react-router-dom";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

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

async function fetchCoachCampaignsByTeamIds(orgId, teamIds) {
  const uniqueTeamIds = Array.from(
    new Set((teamIds || []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (!orgId || uniqueTeamIds.length === 0) return [];

  const snaps = await Promise.all(
    uniqueTeamIds.map(async (teamId) => {
      try {
        return await getDocs(
          query(
            collection(db, "campaigns"),
            where("orgId", "==", orgId),
            where("teamId", "==", teamId)
          )
        );
      } catch {
        return null;
      }
    })
  );

  const merged = new Map();
  snaps.forEach((snap) => {
    if (!snap) return;
    snap.docs.forEach((entry) => {
      merged.set(entry.id, { id: entry.id, ...entry.data() });
    });
  });

  return Array.from(merged.values());
}

export default function Campaigns() {
  const { user, profile, loading, activeOrgId, activeOrgName, isSuperAdmin } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  const role = String(profile?.role || "").toLowerCase();
  const resolvedOrgId = isSuperAdmin ? activeOrgId || "" : profile?.orgId || "";
  const orgDisplayName = isSuperAdmin
    ? activeOrgName || resolvedOrgId || "the selected organization"
    : profile?.orgName || resolvedOrgId || "your organization";
  const coachTeamIds = useMemo(
    () => getCoachScopedTeamIds(profile),
    [profile?.role, profile?.teamId, JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || [])]
  );

  useEffect(() => {
    async function load() {
      if (!user || !resolvedOrgId) {
        setCampaigns([]);
        setLoadingCampaigns(false);
        return;
      }

      try {
        setLoadingCampaigns(true);

        let campaignRows = [];

        if (role === "coach") {
          if (coachTeamIds.length === 0) {
            setCampaigns([]);
            return;
          }
          campaignRows = await fetchCoachCampaignsByTeamIds(
            resolvedOrgId,
            coachTeamIds
          );
        } else {
          const snap = await getDocs(
            query(collection(db, "campaigns"), where("orgId", "==", resolvedOrgId))
          );
          campaignRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }

        campaignRows.sort((left, right) => {
          const leftTime =
            left.createdAt?.toDate?.()?.getTime?.() ||
            (left.createdAt?.seconds ? left.createdAt.seconds * 1000 : 0);
          const rightTime =
            right.createdAt?.toDate?.()?.getTime?.() ||
            (right.createdAt?.seconds ? right.createdAt.seconds * 1000 : 0);
          return rightTime - leftTime;
        });

        setCampaigns(campaignRows);
      } catch (err) {
        console.error("Failed to load campaigns:", err);
      } finally {
        setLoadingCampaigns(false);
      }
    }

    load();
  }, [user, resolvedOrgId, role, JSON.stringify(coachTeamIds)]);

  if (loading || loadingCampaigns) {
    return <div className="p-4 md:p-6 text-base">Loading campaigns...</div>;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 md:gap-4 mb-5 md:mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isSuperAdmin
              ? `Viewing campaigns for ${orgDisplayName}.`
              : "Open a campaign to assign teams, review performance, and launch fundraising activity."}
          </p>
        </div>
        {(role === "admin" || role === "super-admin" || role === "coach") && resolvedOrgId ? (
          <Link
            to="/campaigns/new"
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            + New Campaign
          </Link>
        ) : null}
      </div>

      {isSuperAdmin && !resolvedOrgId ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
          Select an organization to view campaigns.
        </div>
      ) : campaigns.length === 0 ? (
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
