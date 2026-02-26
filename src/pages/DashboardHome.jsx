import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  startAfter,
} from "firebase/firestore";
import { db } from "../firebase/config";

import { useAuth } from "../context/AuthContext";
import { useCampaign } from "../context/CampaignContext";
import AnalyticsCard from "../components/AnalyticsCard";
import { normalizeDonationAmount } from "../utils/normalizeDonation";

const PAGE_SIZE = 10;

/* ==============================
   CSV Export helpers (C5)
   ============================== */
function toCSV(rows) {
  if (!rows.length) return "";

  const headers = Object.keys(rows[0]);
  const escape = (v) =>
    `"${String(v ?? "").replace(/"/g, '""')}"`;

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => escape(row[h])).join(",")
    ),
  ];

  return lines.join("\n");
}

function downloadCSV({ filename, csv }) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/* ==============================
   Shared Firestore helpers
   ============================== */
async function fetchDocsByIds({ collectionName, ids }) {
  if (!ids?.length) return {};

  const results = {};
  const CHUNK_SIZE = 10;

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);

    const q = query(
      collection(db, collectionName),
      where("__name__", "in", chunk)
    );

    const snap = await getDocs(q);
    snap.forEach((doc) => {
      results[doc.id] = doc.data();
    });
  }

  return results;
}

/* ==============================
   Formatting helpers
   ============================== */
function formatCurrency(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatTime(tsLike) {
  try {
    if (!tsLike) return "";
    if (typeof tsLike?.toDate === "function") {
      return tsLike.toDate().toLocaleString();
    }
    if (typeof tsLike === "number") {
      return new Date(tsLike).toLocaleString();
    }
    if (tsLike instanceof Date) {
      return tsLike.toLocaleString();
    }
    return "";
  } catch {
    return "";
  }
}

export default function DashboardHome() {
  const { profile } = useAuth();
  const { activeCampaignId, campaigns } = useCampaign();
  const role = (profile?.role || "").toLowerCase();
  const isCoach = role === "coach";
  const isAdmin = role === "admin" || role === "super-admin";

  /* ==============================
     Stats (existing)
     ============================== */
  const [stats, setStats] = useState({
    activeCampaigns: 0,
    totalAthletes: 0,
    totalDonors: 0,
    fundsRaised: 0,
  });

  /* ==============================
     Recent Activity (stable)
     ============================== */
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [recentActivity, setRecentActivity] = useState([]);

  const [hasMoreActivity, setHasMoreActivity] = useState(false);
  const [activityCursor, setActivityCursor] = useState(null);
  const [coachFlowLoading, setCoachFlowLoading] = useState(false);
  const [coachFlow, setCoachFlow] = useState({
    teamCount: 0,
    athleteCount: 0,
    assignedCampaignCount: 0,
    contactCount: 0,
  });

  const fetchStats = useCallback(async () => {
    if (!profile?.orgId || !activeCampaignId) {
      setStats({
        activeCampaigns: 0,
        totalAthletes: 0,
        totalDonors: 0,
        fundsRaised: 0,
      });
      return;
    }

    try {
      const donationsSnap = await getDocs(
        query(
          collection(db, "donations"),
          where("orgId", "==", profile.orgId),
          where("campaignId", "==", activeCampaignId)
        )
      );

      let fundsRaised = 0;
      const donorKeys = new Set();
      const athleteIdsFromDonations = new Set();

      donationsSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (data.status && data.status !== "paid") return;

        fundsRaised += normalizeDonationAmount(data.amount);

        const donorKey =
          (data.donorEmail || "").toString().trim().toLowerCase() ||
          (data.donorName || "").toString().trim().toLowerCase();
        if (donorKey) donorKeys.add(donorKey);

        if (data.athleteId) athleteIdsFromDonations.add(data.athleteId);
      });

      let totalAthletes = 0;
      try {
        const campaignAthletesSnap = await getDocs(
          query(
            collection(db, "campaignAthletes"),
            where("orgId", "==", profile.orgId),
            where("campaignId", "==", activeCampaignId)
          )
        );
        totalAthletes = campaignAthletesSnap.size;
      } catch (err) {
        // Fallback when campaignAthletes is unavailable/missing for legacy data.
        totalAthletes = athleteIdsFromDonations.size;
      }

      setStats({
        activeCampaigns: 1,
        totalAthletes,
        totalDonors: donorKeys.size,
        fundsRaised,
      });
    } catch (err) {
      console.error("Dashboard stats load failed:", err);
      setStats({
        activeCampaigns: 0,
        totalAthletes: 0,
        totalDonors: 0,
        fundsRaised: 0,
      });
    }
  }, [profile?.orgId, activeCampaignId]);

  const activeCampaign = useMemo(() => {
    return campaigns?.find((c) => c.id === activeCampaignId) || null;
  }, [campaigns, activeCampaignId]);

  /* ==============================
     C4 — Campaign Goal Progress
     ============================== */
  const goalAmount = useMemo(() => {
    const raw = activeCampaign?.goal;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [activeCampaign?.goal]);

  const progressPercent = useMemo(() => {
    if (!goalAmount) return 0;
    return Math.min(
      100,
      Math.round((Number(stats.fundsRaised || 0) / goalAmount) * 100)
    );
  }, [stats.fundsRaised, goalAmount]);

  const resetActivity = useCallback(() => {
    setRecentActivity([]);
    setActivityCursor(null);
    setHasMoreActivity(false);
    setActivityError("");
  }, []);

  useEffect(() => {
    if (!profile?.orgId || (!isCoach && !isAdmin)) return;

    let cancelled = false;

    async function loadCoachFlow() {
      setCoachFlowLoading(true);
      try {
        // Teams scope: coaches see their teams; admins see org teams.
        const teamsQ =
          isCoach && profile?.uid
            ? query(
                collection(db, "teams"),
                where("orgId", "==", profile.orgId),
                where("coachId", "==", profile.uid)
              )
            : query(collection(db, "teams"), where("orgId", "==", profile.orgId));

        const teamsSnap = await getDocs(teamsQ);
        const teamRows = teamsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const teamIds = teamRows.map((t) => t.id);

        let athleteCount = 0;
        if (teamIds.length === 1) {
          const athletesSnap = await getDocs(
            query(
              collection(db, "athletes"),
              where("orgId", "==", profile.orgId),
              where("teamId", "==", teamIds[0])
            )
          );
          athleteCount = athletesSnap.size;
        } else if (teamIds.length > 1 && teamIds.length <= 10) {
          const athletesSnap = await getDocs(
            query(
              collection(db, "athletes"),
              where("orgId", "==", profile.orgId),
              where("teamId", "in", teamIds)
            )
          );
          athleteCount = athletesSnap.size;
        } else if (teamIds.length > 10 || isAdmin) {
          const athletesSnap = await getDocs(
            query(collection(db, "athletes"), where("orgId", "==", profile.orgId))
          );
          athleteCount = isCoach
            ? athletesSnap.docs.filter((d) => teamIds.includes(d.data()?.teamId)).length
            : athletesSnap.size;
        }

        // Use in-memory campaigns from context to avoid extra indexed queries.
        const scopedCampaigns = (campaigns || []).filter((c) => {
          if (!c) return false;
          const directTeam = c.teamId && teamIds.includes(c.teamId);
          const multiTeam =
            Array.isArray(c.teamIds) && c.teamIds.some((id) => teamIds.includes(id));
          return isAdmin ? true : directTeam || multiTeam;
        });
        const assignedCampaignCount = scopedCampaigns.length;

        const contactsSnap = await getDocs(
          query(collection(db, "athlete_contacts"), where("orgId", "==", profile.orgId))
        );

        if (!cancelled) {
          setCoachFlow({
            teamCount: teamRows.length,
            athleteCount,
            assignedCampaignCount,
            contactCount: contactsSnap.size,
          });
        }
      } catch (err) {
        console.error("Coach flow load failed:", err);
      } finally {
        if (!cancelled) setCoachFlowLoading(false);
      }
    }

    loadCoachFlow();

    return () => {
      cancelled = true;
    };
  }, [profile?.orgId, profile?.uid, isCoach, isAdmin, campaigns]);

  const buildDonationsQuery = useCallback(
    (cursorDoc = null) => {
      const base = [
        where("orgId", "==", profile?.orgId || "__none__"),
        where("campaignId", "==", activeCampaignId || "__none__"),
        orderBy("createdAt", "desc"),
        limit(PAGE_SIZE),
      ];

      if (cursorDoc) {
        return query(collection(db, "donations"), ...base, startAfter(cursorDoc));
      }
      return query(collection(db, "donations"), ...base);
    },
    [profile?.orgId, activeCampaignId]
  );

  /* ==============================
     Stable fetch (NO cursor dependency)
     ============================== */
  const fetchRecentActivity = useCallback(
    async ({ mode = "reset", cursor = null } = {}) => {
      if (!profile?.orgId || !activeCampaignId) return;

      setActivityLoading(true);
      setActivityError("");

      try {
        const q =
          mode === "more" && cursor
            ? buildDonationsQuery(cursor)
            : buildDonationsQuery(null);

        const snap = await getDocs(q);
        const docs = snap.docs || [];

        // Normalize donations
        const donations = docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        // Collect related IDs
        const athleteIds = Array.from(
          new Set(donations.map((d) => d.athleteId).filter(Boolean))
        );
        const teamIds = Array.from(
          new Set(donations.map((d) => d.teamId).filter(Boolean))
        );

        // Batch fetch
        const [athletesById, teamsById] = await Promise.all([
          fetchDocsByIds({ collectionName: "athletes", ids: athleteIds }),
          fetchDocsByIds({ collectionName: "teams", ids: teamIds }),
        ]);

        const items = donations.map((d) => {
          const athlete = d.athleteId ? athletesById[d.athleteId] : null;
          const team = d.teamId ? teamsById[d.teamId] : null;

          return {
            id: d.id,
            amount: Number(d.amount || 0) / 100,
            donorName:
              d.donorName ||
              d.donor?.name ||
              d.donorFullName ||
              d.name ||
              "Anonymous",
            donorEmail:
              d.donorEmail || d.donor?.email || d.email || "",
            message: d.message || d.note || "",
            createdAt: d.createdAt || null,
            createdAtMs: d.createdAtMs || null,
            status: d.status || "",
            athleteName: athlete?.name || "",
            teamName: team?.name || "",
          };
        });

        setRecentActivity((prev) =>
          mode === "more" ? [...prev, ...items] : items
        );

        const lastDoc = docs.length ? docs[docs.length - 1] : null;
        setActivityCursor(lastDoc);
        setHasMoreActivity(docs.length === PAGE_SIZE);
      } catch (err) {
        console.error("Recent Activity fetch failed:", err);
        setActivityError(
          "Could not load recent activity. Check your Firestore indexes and donation fields."
        );
        setHasMoreActivity(false);
      } finally {
        setActivityLoading(false);
      }
    },
    [profile?.orgId, activeCampaignId, buildDonationsQuery]
  );
                /* ==============================
   C5 — Export Donations CSV
   ============================== */
const exportDonationsCSV = async () => {
  if (!profile?.orgId || !activeCampaignId) return;

  try {
    const q = query(
      collection(db, "donations"),
      where("orgId", "==", profile.orgId),
      where("campaignId", "==", activeCampaignId),
      orderBy("createdAt", "desc")
    );

    const snap = await getDocs(q);
    const docs = snap.docs || [];

    // Normalize donations
    const donations = docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    // Collect related IDs
    const athleteIds = Array.from(
      new Set(donations.map((d) => d.athleteId).filter(Boolean))
    );
    const teamIds = Array.from(
      new Set(donations.map((d) => d.teamId).filter(Boolean))
    );

    // Batch fetch related data
    const [athletesById, teamsById] = await Promise.all([
      fetchDocsByIds({ collectionName: "athletes", ids: athleteIds }),
      fetchDocsByIds({ collectionName: "teams", ids: teamIds }),
    ]);

    const rows = donations.map((d) => ({
      donationId: d.id,
      donorName: d.donorName || "Anonymous",
      donorEmail: d.donorEmail || "",
      amount: d.amount || 0,
      athlete: athletesById[d.athleteId]?.name || "",
      team: teamsById[d.teamId]?.name || "",
      campaign: activeCampaign?.name || "",
      status: d.status || "",
      createdAt: formatTime(d.createdAt),
    }));

    const csv = toCSV(rows);

    downloadCSV({
      filename: `donations-${activeCampaign?.name || "campaign"}.csv`,
      csv,
    });
  } catch (err) {
    console.error("CSV export failed:", err);
    alert("Could not export donations. See console for details.");
  }
};

  /* ==============================
     Fetch ONCE per campaign change
     ============================== */
  useEffect(() => {
    if (!profile?.orgId || !activeCampaignId) return;
    resetActivity();
    fetchRecentActivity({ mode: "reset" });
  }, [profile?.orgId, activeCampaignId, resetActivity, fetchRecentActivity]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  /* ==============================
     Render
     ============================== */
  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl md:text-2xl font-semibold text-slate-900">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {activeCampaign?.name ? (
            <>
              Viewing campaign:{" "}
              <span className="font-medium text-slate-700">
                {activeCampaign.name}
              </span>
            </>
          ) : (
            "Select a campaign to view analytics."
          )}
        </p>
      </div>

      {(isCoach || isAdmin) && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Coach Onboarding Flow</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Follow this sequence to onboard your team quickly.
            </p>
          </div>

          {coachFlowLoading ? (
            <div className="px-4 py-4 text-sm text-slate-500">Loading onboarding status...</div>
          ) : (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                {
                  key: "team",
                  label: "1. Create Team",
                  done: coachFlow.teamCount > 0,
                  detail: `${coachFlow.teamCount} team${coachFlow.teamCount === 1 ? "" : "s"}`,
                  to: "/teams",
                  cta: "Open Teams",
                },
                {
                  key: "invite",
                  label: "2. Invite Athletes",
                  done: coachFlow.athleteCount > 0,
                  detail: `${coachFlow.athleteCount} athlete${coachFlow.athleteCount === 1 ? "" : "s"}`,
                  to: isCoach ? "/coach/invite" : "/athletes/add",
                  cta: isCoach ? "Invite Athletes" : "Add Athlete",
                },
                {
                  key: "campaign",
                  label: "3. Assign Campaign",
                  done: coachFlow.assignedCampaignCount > 0,
                  detail: `${coachFlow.assignedCampaignCount} campaign${coachFlow.assignedCampaignCount === 1 ? "" : "s"}`,
                  to: "/campaigns",
                  cta: "Open Campaigns",
                },
                {
                  key: "messages",
                  label: "4. Launch Messages",
                  done: coachFlow.contactCount > 0,
                  detail: `${coachFlow.contactCount} contact${coachFlow.contactCount === 1 ? "" : "s"}`,
                  to: "/messages",
                  cta: "Open Messages",
                },
              ].map((step) => (
                <div
                  key={step.key}
                  className="rounded-lg border border-slate-200 p-3 flex flex-col gap-2 bg-slate-50/40"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-slate-800">{step.label}</div>
                    <span
                      className={[
                        "text-[11px] px-2 py-1 rounded-full",
                        step.done
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700",
                      ].join(" ")}
                    >
                      {step.done ? "Done" : "Pending"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600">{step.detail}</div>
                  <Link
                    to={step.to}
                    className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {step.cta}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <AnalyticsCard
          title="Campaign Progress"
          value={`${progressPercent}%`}
          subtext={
            goalAmount
              ? `${formatCurrency(stats.fundsRaised)} of ${formatCurrency(
                  goalAmount
                )}`
              : "No goal set"
          }
        >
          {goalAmount > 0 && (
            <div className="mt-3">
              <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-slate-900 transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </AnalyticsCard>

        <AnalyticsCard
          title="Funds Raised"
          value={formatCurrency(stats.fundsRaised)}
          subtext="Campaign-scoped"
        />
        <AnalyticsCard
          title="Total Donors"
          value={stats.totalDonors}
          subtext="Unique donors"
        />
        <AnalyticsCard
          title="Total Athletes"
          value={stats.totalAthletes}
          subtext="In this campaign"
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Recent Activity
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Latest donations for this campaign
            </p>
          </div>

          <div className="flex items-center gap-2">
  <button
    onClick={() => fetchRecentActivity({ mode: "reset" })}
    disabled={activityLoading}
    className="text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
  >
    Refresh
  </button>

  {profile?.role === "admin" && (
    <button
      onClick={exportDonationsCSV}
      className="text-xs font-medium px-3 py-2 rounded-lg bg-slate-900 text-white hover:opacity-95"
    >
      Export CSV
    </button>
  )}
</div>

        </div>

        {activityError && (
          <div className="px-4 py-4 text-sm text-red-600">{activityError}</div>
        )}

        <div className="divide-y divide-slate-100">
          {recentActivity.length === 0 && !activityLoading && (
            <div className="px-4 py-8 text-sm text-slate-500">
              No activity yet for this campaign.
            </div>
          )}

          {recentActivity.map((a) => {
            const when = formatTime(a.createdAt) || formatTime(a.createdAtMs);
            return (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                <div className="mt-1 h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-xs font-semibold">
                  $
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {a.donorName}
                    <span className="text-slate-400 font-normal">
                      {" "}
                      donated{" "}
                    </span>
                    {formatCurrency(a.amount)}
                  </p>

                  {(a.athleteName || a.teamName) && (
                    <p className="text-xs text-slate-600 mt-1">
                      {a.athleteName && (
                        <>
                          Athlete:{" "}
                          <span className="font-medium">
                            {a.athleteName}
                          </span>
                        </>
                      )}
                      {a.athleteName && a.teamName && " · "}
                      {a.teamName && (
                        <>
                          Team:{" "}
                          <span className="font-medium">{a.teamName}</span>
                        </>
                      )}
                    </p>
                  )}

                  {a.message && (
                    <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                      “{a.message}”
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <p className="text-xs text-slate-500">{when}</p>
                  {a.status && (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {a.status}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing {recentActivity.length} most recent donations
          </p>

          <button
            onClick={() =>
              fetchRecentActivity({ mode: "more", cursor: activityCursor })
            }
            disabled={activityLoading || !hasMoreActivity}
            className="text-xs font-medium px-3 py-2 rounded-lg bg-slate-900 text-white hover:opacity-95 disabled:opacity-50"
          >
            {activityLoading ? "Loading…" : hasMoreActivity ? "Load More" : "End"}
          </button>
        </div>
      </div>
    </div>
  );
}
