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

function parseDateLike(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  if (value instanceof Date) return value;
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate;
}

function toDayKey(date) {
  if (!(date instanceof Date)) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dayDiff(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.max(0, Math.round((e - s) / 86400000));
}

function formatShortDate(dateLike) {
  const date = parseDateLike(dateLike);
  if (!date) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function DashboardHome() {
  const { profile } = useAuth();
  const { activeCampaignId, campaigns } = useCampaign();
  const role = (profile?.role || "").toLowerCase();
  const isCoach = role === "coach";
  const isAdmin = role === "admin" || role === "super-admin";
  const isAthlete = role === "athlete";

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
  const [insightOpen, setInsightOpen] = useState(false);
  const [insightType, setInsightType] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [insightData, setInsightData] = useState(null);

  const fetchStats = useCallback(async () => {
    if (!profile?.orgId || !activeCampaignId || (!isCoach && !isAdmin)) {
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
  }, [profile?.orgId, activeCampaignId, isCoach, isAdmin]);

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

  const campaignStartDate = useMemo(() => {
    return (
      parseDateLike(activeCampaign?.startDate) ||
      parseDateLike(activeCampaign?.startsAt) ||
      parseDateLike(activeCampaign?.createdAt) ||
      null
    );
  }, [activeCampaign]);

  const campaignEndDate = useMemo(() => {
    return (
      parseDateLike(activeCampaign?.endDate) ||
      parseDateLike(activeCampaign?.endsAt) ||
      null
    );
  }, [activeCampaign]);

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
      const base = isAthlete
        ? [
            where("orgId", "==", profile?.orgId || "__none__"),
            where("athleteId", "==", profile?.uid || "__none__"),
            where("status", "==", "paid"),
            orderBy("createdAt", "desc"),
            limit(PAGE_SIZE),
          ]
        : [
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
    [isAthlete, profile?.orgId, profile?.uid, activeCampaignId]
  );

  /* ==============================
     Stable fetch (NO cursor dependency)
     ============================== */
  const fetchRecentActivity = useCallback(
    async ({ mode = "reset", cursor = null } = {}) => {
      const canLoadAthleteActivity = isAthlete && profile?.uid;
      const canLoadCampaignActivity =
        !isAthlete && profile?.orgId && activeCampaignId && (isCoach || isAdmin);
      if (!profile?.orgId || (!canLoadAthleteActivity && !canLoadCampaignActivity)) {
        setRecentActivity([]);
        setActivityCursor(null);
        setHasMoreActivity(false);
        setActivityError("");
        return;
      }

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

        // Batch fetch
        const athletesById = await fetchDocsByIds({
          collectionName: "athletes",
          ids: athleteIds,
        });
        const teamIds = Array.from(
          new Set([
            ...donations.map((d) => d.teamId).filter(Boolean),
            ...Object.values(athletesById)
              .map((athlete) => athlete?.teamId)
              .filter(Boolean),
          ])
        );
        const teamsById = await fetchDocsByIds({
          collectionName: "teams",
          ids: teamIds,
        });

        const items = donations.map((d) => {
          const athlete = d.athleteId ? athletesById[d.athleteId] : null;
          const team = (d.teamId || athlete?.teamId) ? teamsById[d.teamId || athlete?.teamId] : null;

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
          "Could not load recent activity right now. Please try again in a moment."
        );
        setHasMoreActivity(false);
      } finally {
        setActivityLoading(false);
      }
    },
    [profile?.orgId, profile?.uid, activeCampaignId, buildDonationsQuery, isAthlete, isCoach, isAdmin]
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

  const openInsight = useCallback(async (type) => {
    setInsightOpen(true);
    setInsightType(type);
    setInsightLoading(true);
    setInsightError("");
    setInsightData(null);

    if (!profile?.orgId || !activeCampaignId) {
      setInsightError("Select a campaign first.");
      setInsightLoading(false);
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

      const donations = donationsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => !d.status || d.status === "paid");

      const raisedTotal = donations.reduce(
        (sum, d) => sum + normalizeDonationAmount(d.amount),
        0
      );

      const athleteRaised = new Map();
      const donorAgg = new Map();
      let topGift = 0;

      donations.forEach((d) => {
        const amount = normalizeDonationAmount(d.amount);
        if (amount > topGift) topGift = amount;

        if (d.athleteId) {
          athleteRaised.set(d.athleteId, (athleteRaised.get(d.athleteId) || 0) + amount);
        }

        const donorKey = (d.donorEmail || d.donorName || "anonymous").toString().trim().toLowerCase();
        const donorLabel = d.donorName || d.donorEmail || "Anonymous";
        const prev = donorAgg.get(donorKey) || { name: donorLabel, email: d.donorEmail || "", amount: 0, gifts: 0 };
        donorAgg.set(donorKey, {
          ...prev,
          amount: prev.amount + amount,
          gifts: prev.gifts + 1,
        });
      });

      if (type === "athletes") {
        let athleteIds = [];
        try {
          const campaignAthletesSnap = await getDocs(
            query(
              collection(db, "campaignAthletes"),
              where("orgId", "==", profile.orgId),
              where("campaignId", "==", activeCampaignId)
            )
          );
          athleteIds = campaignAthletesSnap.docs
            .map((d) => d.data()?.athleteId)
            .filter(Boolean);
        } catch {
          athleteIds = [];
        }

        if (athleteIds.length === 0) {
          athleteIds = Array.from(athleteRaised.keys());
        }

        const uniqAthleteIds = Array.from(new Set(athleteIds));
        const athletesById = await fetchDocsByIds({
          collectionName: "athletes",
          ids: uniqAthleteIds,
        });

        const contactsSnap = await getDocs(
          query(collection(db, "athlete_contacts"), where("orgId", "==", profile.orgId))
        );
        const contactCounts = new Map();
        contactsSnap.forEach((d) => {
          const athleteId = d.data()?.athleteId;
          if (!athleteId) return;
          contactCounts.set(athleteId, (contactCounts.get(athleteId) || 0) + 1);
        });

        const athletes = uniqAthleteIds
          .map((id) => {
            const a = athletesById[id] || {};
            const goal = Number(a.goal ?? a.personalGoal ?? a.fundraisingGoal ?? 0);
            const raised = Number(athleteRaised.get(id) || 0);
            const contacts = Number(contactCounts.get(id) || 0);
            const goalPct = goal > 0 ? Math.round((raised / goal) * 100) : null;

            return {
              id,
              name: a.name || "Unnamed Athlete",
              email: a.email || "",
              contacts,
              raised,
              goal,
              goalPct,
            };
          })
          .sort((a, b) => (b.raised - a.raised) || (b.contacts - a.contacts) || a.name.localeCompare(b.name));

        setInsightData({
          title: "Athlete Performance",
          subtitle: "Ranked by amount raised (highest first)",
          athletes,
        });
      } else if (type === "donors") {
        const donors = Array.from(donorAgg.values()).sort((a, b) => b.amount - a.amount);
        setInsightData({
          title: "Donor Summary",
          subtitle: "Unique donors in active campaign",
          donors,
        });
      } else if (type === "funds") {
        const avgGift = donations.length ? raisedTotal / donations.length : 0;
        setInsightData({
          title: "Funds Raised Summary",
          subtitle: "Active campaign paid donations",
          totals: {
            raisedTotal,
            gifts: donations.length,
            avgGift,
            topGift,
          },
        });
      } else if (type === "timeline") {
        const dayMap = new Map();
        donations.forEach((d) => {
          const dt =
            parseDateLike(d.createdAt) ||
            parseDateLike(d.createdAtMs) ||
            parseDateLike(d.updatedAt);
          if (!dt) return;
          const key = toDayKey(dt);
          dayMap.set(key, (dayMap.get(key) || 0) + normalizeDonationAmount(d.amount));
        });

        const points = Array.from(dayMap.entries())
          .map(([day, amount]) => ({ day, amount }))
          .sort((a, b) => a.day.localeCompare(b.day));

        const peak = points.reduce(
          (best, p) => (!best || p.amount > best.amount ? p : best),
          null
        );
        const valley = points.reduce(
          (best, p) => (!best || p.amount < best.amount ? p : best),
          null
        );

        const today = new Date();
        const elapsedDays = campaignStartDate ? dayDiff(campaignStartDate, today) : null;
        const totalDays =
          campaignStartDate && campaignEndDate ? dayDiff(campaignStartDate, campaignEndDate) : null;
        const remainingDays = campaignEndDate ? dayDiff(today, campaignEndDate) : null;

        setInsightData({
          title: "Campaign Timeline",
          subtitle: activeCampaign?.name || "",
          timeline: {
            start: campaignStartDate,
            end: campaignEndDate,
            elapsedDays,
            totalDays,
            remainingDays,
            points,
            peak,
            valley,
          },
        });
      } else {
        const remaining = Math.max(0, goalAmount - raisedTotal);
        setInsightData({
          title: "Campaign Progress Summary",
          subtitle: activeCampaign?.name || "",
          progress: {
            goal: goalAmount,
            raised: raisedTotal,
            remaining,
            percent: goalAmount > 0 ? Math.min(100, Math.round((raisedTotal / goalAmount) * 100)) : 0,
          },
        });
      }
    } catch (err) {
      console.error("Insight modal load failed:", err);
      setInsightError("Could not load summary data.");
    } finally {
      setInsightLoading(false);
    }
  }, [
    profile?.orgId,
    activeCampaignId,
    goalAmount,
    activeCampaign?.name,
    campaignStartDate,
    campaignEndDate,
  ]);

  /* ==============================
     Fetch ONCE per campaign change
     ============================== */
  useEffect(() => {
    const canLoadAthleteActivity = isAthlete && profile?.uid;
    const canLoadCampaignActivity =
      !isAthlete && profile?.orgId && activeCampaignId && (isCoach || isAdmin);
    if (!profile?.orgId || (!canLoadAthleteActivity && !canLoadCampaignActivity)) {
      resetActivity();
      return;
    }
    resetActivity();
    fetchRecentActivity({ mode: "reset" });
  }, [
    profile?.orgId,
    profile?.uid,
    activeCampaignId,
    resetActivity,
    fetchRecentActivity,
    isAthlete,
    isCoach,
    isAdmin,
  ]);

  useEffect(() => {
    if (!isCoach && !isAdmin) {
      setStats({
        activeCampaigns: 0,
        totalAthletes: 0,
        totalDonors: 0,
        fundsRaised: 0,
      });
      return;
    }
    fetchStats();
  }, [fetchStats, isCoach, isAdmin]);

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
          {isAthlete ? (
            "Use your athlete profile and messages page to manage your fundraising progress."
          ) : activeCampaign?.name ? (
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

      {isAthlete && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Athlete Dashboard</h2>
          <p className="mt-1 text-sm text-slate-600">
            Your fundraising workflow lives in your athlete profile and messages pages. Use those pages to finish your profile, add supporters, and send outreach.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to={profile?.uid ? `/athletes/${profile.uid}` : "/athletes"}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Open My Athlete Profile
            </Link>
            <Link
              to="/messages"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Messages
            </Link>
          </div>
        </div>
      )}

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
                  to: "/coach/invite",
                  cta: "Onboard Athletes",
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
          onClick={() => openInsight("progress")}
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
          onClick={() => openInsight("funds")}
          subtext="Campaign-scoped"
        />
        <AnalyticsCard
          title="Total Donors"
          value={stats.totalDonors}
          onClick={() => openInsight("donors")}
          subtext="Unique donors"
        />
        <AnalyticsCard
          title="Total Athletes"
          value={stats.totalAthletes}
          onClick={() => openInsight("athletes")}
          subtext="In this campaign"
        />
        <AnalyticsCard
          title="Campaign Timeline"
          value={
            campaignStartDate && campaignEndDate
              ? `${formatShortDate(campaignStartDate)} - ${formatShortDate(campaignEndDate)}`
              : campaignStartDate
              ? `Started ${formatShortDate(campaignStartDate)}`
              : "No dates set"
          }
          onClick={() => openInsight("timeline")}
          subtext={
            campaignStartDate && campaignEndDate
              ? `${dayDiff(campaignStartDate, campaignEndDate)} day window`
              : "Start/end and daily trend"
          }
        />
      </div>

      {insightOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[85vh] overflow-auto rounded-xl bg-white border border-slate-200 shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {insightData?.title || "Summary"}
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">{insightData?.subtitle || ""}</p>
              </div>
              <button
                type="button"
                onClick={() => setInsightOpen(false)}
                className="px-3 py-1.5 text-xs rounded border border-slate-300 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="p-5">
              {insightLoading && <div className="text-sm text-slate-500">Loading summary...</div>}
              {insightError && <div className="text-sm text-red-600">{insightError}</div>}

              {!insightLoading && !insightError && insightType === "athletes" && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-slate-500 border-b">
                        <th className="py-2 pr-3">Athlete</th>
                        <th className="py-2 pr-3">Contacts</th>
                        <th className="py-2 pr-3">Raised</th>
                        <th className="py-2 pr-3">Goal</th>
                        <th className="py-2 pr-3">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(insightData?.athletes || []).map((a) => (
                        <tr key={a.id} className="border-b border-slate-100">
                          <td className="py-2 pr-3 font-medium text-slate-800">{a.name}</td>
                          <td className="py-2 pr-3 text-slate-700">{a.contacts}</td>
                          <td className="py-2 pr-3 text-slate-700">{formatCurrency(a.raised)}</td>
                          <td className="py-2 pr-3 text-slate-700">
                            {a.goal > 0 ? formatCurrency(a.goal) : "—"}
                          </td>
                          <td className="py-2 pr-3 text-slate-700">
                            {a.goalPct == null ? "No goal" : `${a.goalPct}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!insightLoading && !insightError && insightType === "donors" && (
                <div className="space-y-2">
                  {(insightData?.donors || []).slice(0, 25).map((d, idx) => (
                    <div key={`${d.email}-${idx}`} className="flex items-center justify-between rounded border border-slate-200 p-2">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 truncate">{d.name || d.email || "Anonymous"}</div>
                        <div className="text-xs text-slate-500">{d.gifts} gift{d.gifts === 1 ? "" : "s"}</div>
                      </div>
                      <div className="font-semibold text-slate-900">{formatCurrency(d.amount)}</div>
                    </div>
                  ))}
                </div>
              )}

              {!insightLoading && !insightError && insightType === "funds" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Raised</div><div className="text-xl font-semibold">{formatCurrency(insightData?.totals?.raisedTotal || 0)}</div></div>
                  <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">Total Gifts</div><div className="text-xl font-semibold">{insightData?.totals?.gifts || 0}</div></div>
                  <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">Average Gift</div><div className="text-xl font-semibold">{formatCurrency(insightData?.totals?.avgGift || 0)}</div></div>
                  <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">Top Gift</div><div className="text-xl font-semibold">{formatCurrency(insightData?.totals?.topGift || 0)}</div></div>
                </div>
              )}

              {!insightLoading && !insightError && insightType === "progress" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">Goal</div><div className="text-xl font-semibold">{formatCurrency(insightData?.progress?.goal || 0)}</div></div>
                  <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">Raised</div><div className="text-xl font-semibold">{formatCurrency(insightData?.progress?.raised || 0)}</div></div>
                  <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">Remaining</div><div className="text-xl font-semibold">{formatCurrency(insightData?.progress?.remaining || 0)}</div></div>
                  <div className="rounded border border-slate-200 p-3"><div className="text-xs text-slate-500">Progress</div><div className="text-xl font-semibold">{insightData?.progress?.percent || 0}%</div></div>
                </div>
              )}

              {!insightLoading && !insightError && insightType === "timeline" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Start Date</div>
                      <div className="text-sm font-semibold">
                        {insightData?.timeline?.start ? insightData.timeline.start.toLocaleDateString() : "Not set"}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">End Date</div>
                      <div className="text-sm font-semibold">
                        {insightData?.timeline?.end ? insightData.timeline.end.toLocaleDateString() : "Not set"}
                      </div>
                    </div>
                    <div className="rounded border border-slate-200 p-3">
                      <div className="text-xs text-slate-500">Days</div>
                      <div className="text-sm font-semibold">
                        {insightData?.timeline?.totalDays != null ? `${insightData.timeline.totalDays} total` : "N/A"}
                        {insightData?.timeline?.remainingDays != null ? ` · ${insightData.timeline.remainingDays} left` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-slate-200 p-3">
                    <div className="text-xs text-slate-500 mb-2">Daily Donations Trend</div>
                    {(insightData?.timeline?.points || []).length === 0 ? (
                      <div className="text-sm text-slate-500">No donation activity yet for this campaign.</div>
                    ) : (
                      <>
                        <div className="h-36 flex items-end gap-1">
                          {(insightData.timeline.points || []).slice(-45).map((p) => {
                            const maxAmount = Math.max(
                              ...insightData.timeline.points.map((x) => Number(x.amount || 0)),
                              1
                            );
                            const h = Math.max(8, Math.round((Number(p.amount || 0) / maxAmount) * 100));
                            return (
                              <div
                                key={p.day}
                                className="flex-1 bg-slate-800/85 rounded-t"
                                style={{ height: `${h}%` }}
                                title={`${p.day}: ${formatCurrency(p.amount)}`}
                              />
                            );
                          })}
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-slate-700">
                          <div>
                            Peak:{" "}
                            <span className="font-medium">
                              {insightData?.timeline?.peak?.day || "N/A"} ({formatCurrency(insightData?.timeline?.peak?.amount || 0)})
                            </span>
                          </div>
                          <div>
                            Valley:{" "}
                            <span className="font-medium">
                              {insightData?.timeline?.valley?.day || "N/A"} ({formatCurrency(insightData?.timeline?.valley?.amount || 0)})
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Recent Activity
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isAthlete
                ? "Latest supporters for your fundraiser"
                : "Latest donations for this campaign"}
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
              {isAthlete
                ? "No supporter activity yet for your fundraiser."
                : "No activity yet for this campaign."}
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
            Showing {recentActivity.length} most recent{" "}
            {isAthlete ? "supporters" : "donations"}
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
