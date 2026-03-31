import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  startAfter,
} from "firebase/firestore";
import { db, functions } from "../firebase/config";

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

async function fetchTeamsByIds(ids) {
  if (!ids?.length) return [];

  const uniqueIds = Array.from(
    new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))
  );
  const rows = await Promise.all(
    uniqueIds.map(async (teamId) => {
      try {
        const snap = await getDoc(doc(db, "teams", teamId));
        return snap.exists() ? { id: snap.id, ...(snap.data() || {}) } : null;
      } catch {
        return null;
      }
    })
  );
  return rows.filter(Boolean);
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

function getAthleteFlowStatus({ complete, started }) {
  if (complete) {
    return {
      label: "Complete",
      className: "bg-green-100 text-green-700",
    };
  }
  if (started) {
    return {
      label: "Incomplete",
      className: "bg-amber-100 text-amber-700",
    };
  }
  return {
    label: "Not Started",
    className: "bg-red-100 text-red-700",
  };
}

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

export default function DashboardHome() {
  const { profile, activeOrgId, activeOrgName, isSuperAdmin, setActiveOrgId } = useAuth();
  const { activeCampaignId, campaigns } = useCampaign();
  const role = (profile?.role || "").toLowerCase();
  const isCoach = role === "coach";
  const isAdmin = role === "admin" || role === "super-admin";
  const isAthlete = role === "athlete";
  const resolvedOrgId =
    isSuperAdmin && !isAthlete ? activeOrgId || "" : profile?.orgId || "";
  const resolvedOrgLabel =
    isSuperAdmin && !isAthlete
      ? activeOrgName || resolvedOrgId || "the selected organization"
      : profile?.orgName || resolvedOrgId || "your organization";
  const coachTeamIds = useMemo(
    () => getCoachScopedTeamIds(profile),
    [profile?.role, profile?.teamId, JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || [])]
  );

  /* ==============================
     Stats (existing)
     ============================== */
  const [stats, setStats] = useState({
    activeCampaigns: 0,
    totalAthletes: 0,
    totalDonors: 0,
    fundsRaised: 0,
  });
  const [superAdminOverviewLoading, setSuperAdminOverviewLoading] = useState(false);
  const [superAdminOverviewReloadKey, setSuperAdminOverviewReloadKey] = useState(0);
  const [superAdminOverview, setSuperAdminOverview] = useState({
    organizations: [],
    totals: {
      orgCount: 0,
      teamCount: 0,
      athleteCount: 0,
      activeCampaignCount: 0,
      coachCount: 0,
    },
  });
  const [workspaceForm, setWorkspaceForm] = useState({
    orgName: "",
    teamName: "",
  });
  const [workspaceCreateLoading, setWorkspaceCreateLoading] = useState(false);
  const [workspaceCreateStatus, setWorkspaceCreateStatus] = useState("");
  const [createdWorkspace, setCreatedWorkspace] = useState(null);

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
    primaryTeamId: "",
    primaryTeamName: "",
  });
  const [insightOpen, setInsightOpen] = useState(false);
  const [insightType, setInsightType] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState("");
  const [insightData, setInsightData] = useState(null);
  const [athleteCampaignId, setAthleteCampaignId] = useState("");
  const [athleteCampaign, setAthleteCampaign] = useState(null);
  const [athleteTeamId, setAthleteTeamId] = useState("");
  const [athleteName, setAthleteName] = useState("");
  const [athleteGoalAmount, setAthleteGoalAmount] = useState(0);
  const [athleteContactCount, setAthleteContactCount] = useState(0);
  const [athleteProfileFlags, setAthleteProfileFlags] = useState({
    hasName: false,
    hasPhoto: false,
    hasBio: false,
    hasPersonalNote: false,
  });

  useEffect(() => {
    if (!isAthlete || !profile?.uid) {
      setAthleteCampaignId("");
      setAthleteCampaign(null);
      return;
    }

    let cancelled = false;

    async function loadAthleteCampaign() {
      try {
        const athleteSnap = await getDoc(doc(db, "athletes", profile.uid));
        if (!athleteSnap.exists()) {
          if (!cancelled) {
            setAthleteCampaignId("");
            setAthleteCampaign(null);
          }
          return;
        }

        const athleteData = athleteSnap.data() || {};
        const nextCampaignId = String(athleteData.campaignId || "").trim();
        const nextTeamId = String(athleteData.teamId || "").trim();
        const nextAthleteName = String(
          athleteData.name || athleteData.displayName || profile?.displayName || ""
        ).trim();
        const nextAthleteGoal = Number(
          athleteData.goal ?? athleteData.personalGoal ?? athleteData.fundraisingGoal ?? 0
        );
        const nextProfileFlags = {
          hasName: Boolean(
            String(
              athleteData.name || athleteData.displayName || profile?.displayName || ""
            ).trim()
          ),
          hasPhoto: Boolean(
            athleteData.photoURL ||
              athleteData.avatar ||
              athleteData.imgUrl ||
              profile?.photoURL
          ),
          hasBio: Boolean(athleteData.bio || athleteData.story || athleteData.description),
          hasPersonalNote: Boolean(
            String(athleteData.inviteMessage || athleteData.supporterMessage || "").trim()
          ),
        };
        if (!nextCampaignId) {
          if (!cancelled) {
            setAthleteCampaignId("");
            setAthleteCampaign(null);
            setAthleteTeamId(nextTeamId);
            setAthleteName(nextAthleteName);
            setAthleteGoalAmount(Number.isFinite(nextAthleteGoal) ? nextAthleteGoal : 0);
            setAthleteProfileFlags(nextProfileFlags);
          }
          return;
        }

        const [campaignSnap, contactsSnap] = await Promise.all([
          getDoc(doc(db, "campaigns", nextCampaignId)),
          getDocs(
            query(
              collection(db, "athlete_contacts"),
              where("orgId", "==", resolvedOrgId || "__none__"),
              where("athleteId", "==", profile.uid)
            )
          ),
        ]);
        if (!cancelled) {
          setAthleteCampaignId(nextCampaignId);
          setAthleteCampaign(
            campaignSnap.exists() ? { id: campaignSnap.id, ...campaignSnap.data() } : null
          );
          setAthleteTeamId(nextTeamId);
          setAthleteName(nextAthleteName);
          setAthleteGoalAmount(Number.isFinite(nextAthleteGoal) ? nextAthleteGoal : 0);
          setAthleteContactCount(contactsSnap.size || 0);
          setAthleteProfileFlags(nextProfileFlags);
        }
      } catch (err) {
        console.error("Athlete campaign load failed:", err);
        if (!cancelled) {
          setAthleteCampaignId("");
          setAthleteCampaign(null);
          setAthleteTeamId("");
          setAthleteName("");
          setAthleteGoalAmount(0);
          setAthleteContactCount(0);
          setAthleteProfileFlags({
            hasName: false,
            hasPhoto: false,
            hasBio: false,
            hasPersonalNote: false,
          });
        }
      }
    }

    loadAthleteCampaign();

    return () => {
      cancelled = true;
    };
  }, [isAthlete, profile?.displayName, resolvedOrgId, profile?.uid]);

  const resolvedCampaignId = isAthlete ? athleteCampaignId : activeCampaignId;

  const fetchStats = useCallback(async () => {
    if (!resolvedOrgId || !resolvedCampaignId || (!isCoach && !isAdmin && !isAthlete)) {
      setStats({
        activeCampaigns: 0,
        totalAthletes: 0,
        totalDonors: 0,
        fundsRaised: 0,
      });
      return;
    }

    try {
      const donationsQuery = isAthlete
        ? query(
            collection(db, "donations"),
            where("orgId", "==", resolvedOrgId),
            where("athleteId", "==", profile.uid)
          )
        : query(
            collection(db, "donations"),
            where("orgId", "==", resolvedOrgId),
            where("campaignId", "==", resolvedCampaignId)
          );
      const donationsSnap = await getDocs(
        donationsQuery
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
      if (isAthlete) {
        try {
          if (athleteTeamId) {
            const campaignAthletesSnap = await getDocs(
              query(
                collection(db, "campaignAthletes"),
                where("orgId", "==", resolvedOrgId),
                where("campaignId", "==", resolvedCampaignId),
                where("teamId", "==", athleteTeamId)
              )
            );
            totalAthletes = campaignAthletesSnap.size;
          }
        } catch (err) {
          totalAthletes = 0;
        }
        if (!totalAthletes) {
          totalAthletes = 1;
        }
      } else {
        try {
          const campaignAthletesSnap = await getDocs(
            query(
              collection(db, "campaignAthletes"),
              where("orgId", "==", resolvedOrgId),
              where("campaignId", "==", resolvedCampaignId)
            )
          );
          totalAthletes = campaignAthletesSnap.size;
        } catch (err) {
          // Fallback when campaignAthletes is unavailable/missing for legacy data.
          totalAthletes = athleteIdsFromDonations.size;
        }
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
  }, [resolvedOrgId, profile?.uid, resolvedCampaignId, athleteTeamId, isCoach, isAdmin, isAthlete]);

  const activeCampaign = useMemo(() => {
    if (isAthlete) {
      return athleteCampaign;
    }
    return campaigns?.find((c) => c.id === activeCampaignId) || null;
  }, [isAthlete, athleteCampaign, campaigns, activeCampaignId]);

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

  const personalProgressPercent = useMemo(() => {
    if (!athleteGoalAmount) return 0;
    return Math.min(
      100,
      Math.round((Number(stats.fundsRaised || 0) / athleteGoalAmount) * 100)
    );
  }, [stats.fundsRaised, athleteGoalAmount]);

  useEffect(() => {
    if (!isSuperAdmin || isAthlete || resolvedOrgId) {
      setSuperAdminOverviewLoading(false);
      setSuperAdminOverview({
        organizations: [],
        totals: {
          orgCount: 0,
          teamCount: 0,
          athleteCount: 0,
          activeCampaignCount: 0,
          coachCount: 0,
        },
      });
      return;
    }

    let cancelled = false;

    async function loadSuperAdminOverview() {
      setSuperAdminOverviewLoading(true);
      try {
        const orgsSnap = await getDocs(
          query(collection(db, "organizations"), orderBy("name"))
        );
        const orgRows = orgsSnap.docs.map((entry) => ({
          id: entry.id,
          ...entry.data(),
        }));
        const now = Date.now();

        const summaryRows = await Promise.all(
          orgRows.map(async (org) => {
            const [teamsSnap, athletesSnap, campaignsSnap, coachUsersSnap] = await Promise.all([
              getDocs(query(collection(db, "teams"), where("orgId", "==", org.id))),
              getDocs(query(collection(db, "athletes"), where("orgId", "==", org.id))),
              getDocs(query(collection(db, "campaigns"), where("orgId", "==", org.id))),
              getDocs(
                query(
                  collection(db, "users"),
                  where("orgId", "==", org.id),
                  where("role", "==", "coach")
                )
              ),
            ]);

            const campaigns = campaignsSnap.docs.map((entry) => ({
              id: entry.id,
              ...entry.data(),
            }));
            const activeCampaignCount = campaigns.filter((campaign) => {
              const startDate = parseDateLike(campaign.startDate);
              const endDate = parseDateLike(campaign.endDate);
              const start = startDate ? startDate.getTime() : null;
              const end = endDate ? endDate.getTime() : null;
              return (
                campaign.status === "active" ||
                campaign.isActive === true ||
                (start && end ? now >= start && now <= end : false)
              );
            }).length;

            const alerts = [];
            if (teamsSnap.size === 0) alerts.push("No teams");
            if (coachUsersSnap.size === 0) alerts.push("No coaches");
            if (athletesSnap.size === 0) alerts.push("No athletes");
            if (campaigns.length === 0) {
              alerts.push("No campaigns");
            } else if (activeCampaignCount === 0) {
              alerts.push("No active campaigns");
            }

            return {
              id: org.id,
              name: org.name || org.id,
              teams: teamsSnap.size || 0,
              athletes: athletesSnap.size || 0,
              campaigns: campaigns.length,
              activeCampaigns: activeCampaignCount,
              coaches: coachUsersSnap.size || 0,
              alerts,
            };
          })
        );

        const totals = summaryRows.reduce(
          (acc, row) => ({
            orgCount: acc.orgCount + 1,
            teamCount: acc.teamCount + row.teams,
            athleteCount: acc.athleteCount + row.athletes,
            activeCampaignCount: acc.activeCampaignCount + row.activeCampaigns,
            coachCount: acc.coachCount + row.coaches,
          }),
          {
            orgCount: 0,
            teamCount: 0,
            athleteCount: 0,
            activeCampaignCount: 0,
            coachCount: 0,
          }
        );

        if (!cancelled) {
          setSuperAdminOverview({
            organizations: summaryRows,
            totals,
          });
        }
      } catch (err) {
        console.error("Super-admin overview load failed:", err);
        if (!cancelled) {
          setSuperAdminOverview({
            organizations: [],
            totals: {
              orgCount: 0,
              teamCount: 0,
              athleteCount: 0,
              activeCampaignCount: 0,
              coachCount: 0,
            },
          });
        }
      } finally {
        if (!cancelled) setSuperAdminOverviewLoading(false);
      }
    }

    loadSuperAdminOverview();
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, isAthlete, resolvedOrgId, superAdminOverviewReloadKey]);

  async function handleCreateOrganizationWorkspace(event) {
    event.preventDefault();
    setWorkspaceCreateStatus("");
    setWorkspaceCreateLoading(true);
    try {
      const createOrganizationWorkspace = httpsCallable(
        functions,
        "createOrganizationWorkspace"
      );
      const result = await createOrganizationWorkspace({
        orgName: workspaceForm.orgName,
        teamName: workspaceForm.teamName,
      });
      const payload = result?.data || {};
      const nextWorkspace = {
        orgId: String(payload.orgId || "").trim(),
        orgName: String(payload.orgName || workspaceForm.orgName || "").trim(),
        teamId: String(payload.teamId || "").trim(),
        teamName: String(payload.teamName || workspaceForm.teamName || "").trim(),
      };
      setCreatedWorkspace(nextWorkspace);
      setWorkspaceForm({ orgName: "", teamName: "" });
      setWorkspaceCreateStatus("Organization workspace created.");
      setSuperAdminOverviewReloadKey((value) => value + 1);
    } catch (err) {
      console.error("Create organization workspace failed:", err);
      setWorkspaceCreateStatus(
        String(err?.message || "").trim() || "Failed to create organization workspace."
      );
    } finally {
      setWorkspaceCreateLoading(false);
    }
  }

  const athleteFlowSteps = useMemo(() => {
    if (!isAthlete) return [];

    const missingProfileItems = [
      athleteProfileFlags.hasName ? null : "full name",
      athleteProfileFlags.hasPhoto ? null : "photo",
      athleteProfileFlags.hasBio ? null : "bio",
      athleteGoalAmount > 0 ? null : "personal goal",
    ].filter(Boolean);
    const profileFieldsCompleteCount = 4 - missingProfileItems.length;
    const profileComplete = missingProfileItems.length === 0;
    const profileStarted = profileFieldsCompleteCount > 0;

    const contactsComplete = athleteContactCount >= 20;
    const contactsStarted = athleteContactCount > 0;

    const notesComplete = athleteProfileFlags.hasPersonalNote;
    const notesStarted = athleteProfileFlags.hasPersonalNote || athleteContactCount > 0;

    return [
      {
        key: "profile",
        label: "1. Create/Modify Profile",
        detail: profileComplete
          ? "Full name, photo, bio, and personal goal are ready."
          : `Missing: ${missingProfileItems.join(", ")}`,
        to: profile?.uid ? `/athletes/${profile.uid}` : "/athletes",
        cta: "Open Profile",
        status: getAthleteFlowStatus({
          complete: profileComplete,
          started: profileStarted,
        }),
      },
      {
        key: "contacts",
        label: "2. Complete 20+ email address entries",
        detail: contactsComplete
          ? `${athleteContactCount} contacts ready`
          : `${athleteContactCount}/20 contacts added`,
        to: "/messages#contacts",
        cta: "Open Contacts",
        status: getAthleteFlowStatus({
          complete: contactsComplete,
          started: contactsStarted,
        }),
      },
      {
        key: "notes",
        label: "3. Send personal notes whenever possible",
        detail: notesComplete
          ? "Personal note is ready to personalize outreach."
          : "Add a short personal note to make messages feel more direct.",
        to: "/messages#drip-campaign",
        cta: "Open Invite Message",
        status: getAthleteFlowStatus({
          complete: notesComplete,
          started: notesStarted,
        }),
      },
    ];
  }, [
    isAthlete,
    athleteProfileFlags,
    athleteGoalAmount,
    athleteContactCount,
    profile?.uid,
  ]);
  const showCampaignAnalytics = isAthlete || Boolean(activeCampaignId);

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
    if (!resolvedOrgId || (!isCoach && !isAdmin)) return;

    let cancelled = false;

    async function loadCoachFlow() {
      setCoachFlowLoading(true);
      try {
        // Teams scope: coaches see their teams; admins see org teams.
        let teamRows = [];
        if (isCoach) {
          teamRows = (await fetchTeamsByIds(coachTeamIds)).filter(
            (team) => String(team?.orgId || "").trim() === resolvedOrgId
          );
        } else {
          const teamsSnap = await getDocs(
            query(collection(db, "teams"), where("orgId", "==", resolvedOrgId))
          );
          teamRows = teamsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        const teamIds = teamRows.map((t) => t.id);

        let athleteCount = 0;
        let athleteRows = [];
        if (teamIds.length === 1) {
          const athletesSnap = await getDocs(
            query(
              collection(db, "athletes"),
              where("orgId", "==", resolvedOrgId),
              where("teamId", "==", teamIds[0])
            )
          );
          athleteCount = athletesSnap.size;
          athleteRows = athletesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        } else if (teamIds.length > 1 && teamIds.length <= 10) {
          const athletesSnap = await getDocs(
            query(
              collection(db, "athletes"),
              where("orgId", "==", resolvedOrgId),
              where("teamId", "in", teamIds)
            )
          );
          athleteCount = athletesSnap.size;
          athleteRows = athletesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        } else if (teamIds.length > 10 || isAdmin) {
          const athletesSnap = await getDocs(
            query(collection(db, "athletes"), where("orgId", "==", resolvedOrgId))
          );
          const allAthletes = athletesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
          athleteCount = isCoach
            ? allAthletes.filter((entry) => teamIds.includes(entry?.teamId)).length
            : athletesSnap.size;
          athleteRows = isCoach
            ? allAthletes.filter((entry) => teamIds.includes(entry?.teamId))
            : allAthletes;
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

        let contactCount = 0;
        if (isCoach) {
          const contactSnaps = await Promise.all(
            athleteRows.map((athlete) =>
              getDocs(
                query(
                  collection(db, "athlete_contacts"),
                  where("orgId", "==", resolvedOrgId),
                  where("athleteId", "==", athlete.id)
                )
              ).catch(() => ({ size: 0 }))
            )
          );
          contactCount = contactSnaps.reduce(
            (sum, snap) => sum + Number(snap?.size || 0),
            0
          );
        } else {
          const contactsSnap = await getDocs(
            query(collection(db, "athlete_contacts"), where("orgId", "==", resolvedOrgId))
          );
          contactCount = contactsSnap.size;
        }

        if (!cancelled) {
          setCoachFlow({
            teamCount: teamRows.length,
            athleteCount,
            assignedCampaignCount,
            contactCount,
            primaryTeamId: String(teamRows[0]?.id || "").trim(),
            primaryTeamName: String(teamRows[0]?.name || teamRows[0]?.teamName || "").trim(),
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
  }, [resolvedOrgId, profile?.uid, isCoach, isAdmin, campaigns, JSON.stringify(coachTeamIds)]);

  const buildDonationsQuery = useCallback(
    (cursorDoc = null) => {
      const base = isAthlete
        ? [
            where("orgId", "==", resolvedOrgId || "__none__"),
            where("athleteId", "==", profile?.uid || "__none__"),
            where("status", "==", "paid"),
            orderBy("createdAt", "desc"),
            limit(PAGE_SIZE),
          ]
        : [
            where("orgId", "==", resolvedOrgId || "__none__"),
            where("campaignId", "==", activeCampaignId || "__none__"),
            orderBy("createdAt", "desc"),
            limit(PAGE_SIZE),
          ];

      if (cursorDoc) {
        return query(collection(db, "donations"), ...base, startAfter(cursorDoc));
      }
      return query(collection(db, "donations"), ...base);
    },
    [isAthlete, resolvedOrgId, profile?.uid, activeCampaignId]
  );

  /* ==============================
     Stable fetch (NO cursor dependency)
     ============================== */
  const fetchRecentActivity = useCallback(
    async ({ mode = "reset", cursor = null } = {}) => {
      const canLoadAthleteActivity = isAthlete && profile?.uid;
      const canLoadCampaignActivity =
        !isAthlete && resolvedOrgId && activeCampaignId && (isCoach || isAdmin);
      if (!resolvedOrgId || (!canLoadAthleteActivity && !canLoadCampaignActivity)) {
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
    [resolvedOrgId, profile?.uid, activeCampaignId, buildDonationsQuery, isAthlete, isCoach, isAdmin]
  );
                /* ==============================
   C5 — Export Donations CSV
   ============================== */
  const exportDonationsCSV = async () => {
  if (!resolvedOrgId || !resolvedCampaignId) return;

  try {
    const q = query(
      collection(db, "donations"),
      where("orgId", "==", resolvedOrgId),
      where("campaignId", "==", resolvedCampaignId),
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

    if (!resolvedOrgId || !resolvedCampaignId) {
      setInsightError("Select a campaign first.");
      setInsightLoading(false);
      return;
    }

    try {
      const donationsQuery = isAthlete
        ? query(
            collection(db, "donations"),
            where("orgId", "==", resolvedOrgId),
            where("athleteId", "==", profile.uid)
          )
        : query(
            collection(db, "donations"),
            where("orgId", "==", resolvedOrgId),
            where("campaignId", "==", resolvedCampaignId)
          );
      const donationsSnap = await getDocs(
        donationsQuery
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

      if (isAthlete) {
        if (type === "athletes") {
          const raised = Number(athleteRaised.get(profile.uid) || 0);
          const goal = Number(athleteGoalAmount || 0);
          setInsightData({
            title: "Athlete Summary",
            subtitle: activeCampaign?.name || "Your current fundraiser",
            athletes: [
              {
                id: profile.uid,
                name: athleteName || "You",
                email: profile?.email || "",
                contacts: athleteContactCount,
                raised,
                goal,
                goalPct: goal > 0 ? Math.round((raised / goal) * 100) : null,
              },
            ],
          });
          return;
        }

        if (type === "donors") {
          const donors = Array.from(donorAgg.values()).sort((a, b) => b.amount - a.amount);
          setInsightData({
            title: "Supporter Summary",
            subtitle: "Unique donors supporting you",
            donors,
          });
          return;
        }

        if (type === "funds") {
          const avgGift = donations.length ? raisedTotal / donations.length : 0;
          setInsightData({
            title: "Funds Raised Summary",
            subtitle: "Your paid donations",
            totals: {
              raisedTotal,
              gifts: donations.length,
              avgGift,
              topGift,
            },
          });
          return;
        }

        if (type === "timeline") {
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
          return;
        }

        const remaining = Math.max(0, athleteGoalAmount - raisedTotal);
        setInsightData({
          title: "Campaign Progress Summary",
          subtitle: activeCampaign?.name || "",
          progress: {
            goal: athleteGoalAmount,
            raised: raisedTotal,
            remaining,
            percent:
              athleteGoalAmount > 0
                ? Math.min(100, Math.round((raisedTotal / athleteGoalAmount) * 100))
                : 0,
          },
        });
        return;
      }

      if (type === "athletes") {
        let athleteIds = [];
        try {
          const campaignAthletesSnap = await getDocs(
            query(
              collection(db, "campaignAthletes"),
              where("orgId", "==", resolvedOrgId),
              where("campaignId", "==", resolvedCampaignId)
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
          query(collection(db, "athlete_contacts"), where("orgId", "==", resolvedOrgId))
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
    isAthlete,
    resolvedOrgId,
    profile?.uid,
    profile?.email,
    resolvedCampaignId,
    goalAmount,
    athleteGoalAmount,
    athleteContactCount,
    athleteName,
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
      !isAthlete && resolvedOrgId && activeCampaignId && (isCoach || isAdmin);
    if (!resolvedOrgId || (!canLoadAthleteActivity && !canLoadCampaignActivity)) {
      resetActivity();
      return;
    }
    resetActivity();
    fetchRecentActivity({ mode: "reset" });
  }, [
    resolvedOrgId,
    profile?.uid,
    activeCampaignId,
    resetActivity,
    fetchRecentActivity,
    isAthlete,
    isCoach,
    isAdmin,
  ]);

  useEffect(() => {
    if (!isCoach && !isAdmin && !isAthlete) {
      setStats({
        activeCampaigns: 0,
        totalAthletes: 0,
        totalDonors: 0,
        fundsRaised: 0,
      });
      return;
    }
    fetchStats();
  }, [fetchStats, isCoach, isAdmin, isAthlete]);

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
          ) : isSuperAdmin && !resolvedOrgId ? (
            "All Organizations overview for cross-org visibility and maintenance triage."
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
        {!isAthlete && (
          <p className="text-xs text-slate-400 mt-1">
            {isSuperAdmin
              ? `Selected org: ${resolvedOrgLabel || "none"}`
              : `Organization: ${resolvedOrgLabel}`}
          </p>
        )}
      </div>

	      {!isAthlete && isSuperAdmin && !resolvedOrgId && (
	        <div className="mb-6 space-y-6">
	          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
	            All Organizations is a neutral super-admin state. Use this dashboard to compare org health, then pick an organization from the top selector when you want to do scoped maintenance.
	          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">New Customer Setup</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Create the organization record and the first team here. After that, continue into
                  the org to invite the admin, coach, and athletes. Coaches will then land on their
                  guided onboarding flow.
                </p>
              </div>
            </div>
            <form
              onSubmit={handleCreateOrganizationWorkspace}
              className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5"
            >
              <input
                type="text"
                required
                value={workspaceForm.orgName}
                onChange={(e) =>
                  setWorkspaceForm((prev) => ({ ...prev, orgName: e.target.value }))
                }
                placeholder="Organization name"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2"
              />
              <input
                type="text"
                value={workspaceForm.teamName}
                onChange={(e) =>
                  setWorkspaceForm((prev) => ({ ...prev, teamName: e.target.value }))
                }
                placeholder="First team name (recommended)"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2"
              />
              <button
                type="submit"
                disabled={workspaceCreateLoading}
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {workspaceCreateLoading ? "Creating..." : "Create Workspace"}
              </button>
            </form>
            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-xs text-slate-500">
                {workspaceCreateStatus ||
                  "Recommended order: create workspace, invite the org admin or coach, then hand off campaign and athlete onboarding."}
              </p>
              {createdWorkspace?.orgId ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveOrgId(createdWorkspace.orgId)}
                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Select New Org
                  </button>
                  <Link
                    to="/admin/users"
                    onClick={() => setActiveOrgId(createdWorkspace.orgId)}
                    className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Invite Staff / Athletes
                  </Link>
                  {createdWorkspace.teamId ? (
                    <Link
                      to={`/teams/${createdWorkspace.teamId}`}
                      onClick={() => setActiveOrgId(createdWorkspace.orgId)}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open First Team
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
            {createdWorkspace?.orgId ? (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                Created <span className="font-semibold">{createdWorkspace.orgName}</span>
                {createdWorkspace.teamName
                  ? ` with first team ${createdWorkspace.teamName}.`
                  : "."}
              </div>
            ) : null}
          </div>

	          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <AnalyticsCard
              title="Organizations"
              value={superAdminOverviewLoading ? "..." : superAdminOverview.totals.orgCount}
              subtext="Total orgs in the platform"
            />
            <AnalyticsCard
              title="Teams"
              value={superAdminOverviewLoading ? "..." : superAdminOverview.totals.teamCount}
              subtext="Across all organizations"
            />
            <AnalyticsCard
              title="Athletes"
              value={superAdminOverviewLoading ? "..." : superAdminOverview.totals.athleteCount}
              subtext="Across all organizations"
            />
            <AnalyticsCard
              title="Active Campaigns"
              value={
                superAdminOverviewLoading ? "..." : superAdminOverview.totals.activeCampaignCount
              }
              subtext="Currently active across orgs"
            />
            <AnalyticsCard
              title="Coaches"
              value={superAdminOverviewLoading ? "..." : superAdminOverview.totals.coachCount}
              subtext="Coach users assigned in orgs"
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="px-4 py-3 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">Organization Health</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Select an organization to move from overview into scoped maintenance.
              </p>
            </div>

            {superAdminOverviewLoading ? (
              <div className="px-4 py-6 text-sm text-slate-500">Loading organization summary...</div>
            ) : superAdminOverview.organizations.length === 0 ? (
              <div className="px-4 py-6 text-sm text-slate-500">No organizations found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-3 font-medium">Organization</th>
                      <th className="px-4 py-3 font-medium text-right">Teams</th>
                      <th className="px-4 py-3 font-medium text-right">Athletes</th>
                      <th className="px-4 py-3 font-medium text-right">Campaigns</th>
                      <th className="px-4 py-3 font-medium text-right">Active</th>
                      <th className="px-4 py-3 font-medium text-right">Coaches</th>
                      <th className="px-4 py-3 font-medium">Alerts</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {superAdminOverview.organizations.map((org) => (
                      <tr key={org.id} className="border-b border-slate-100 align-top">
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{org.name}</div>
                          <div className="text-xs text-slate-400">{org.id}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-700">{org.teams}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{org.athletes}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{org.campaigns}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{org.activeCampaigns}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{org.coaches}</td>
                        <td className="px-4 py-3">
                          {org.alerts.length ? (
                            <div className="flex flex-wrap gap-1.5">
                              {org.alerts.map((alert) => (
                                <span
                                  key={alert}
                                  className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                                >
                                  {alert}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
                              Healthy
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setActiveOrgId(org.id)}
                            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
                          >
                            Open Org
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

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

      {isAthlete && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">Athlete Onboarding Flow</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Follow this sequence to finish setup and start stronger outreach.
            </p>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            {athleteFlowSteps.map((step) => (
              <div
                key={step.key}
                className="rounded-lg border border-slate-200 p-3 flex flex-col gap-2 bg-slate-50/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800">{step.label}</div>
                  <span
                    className={[
                      "text-[11px] px-2 py-1 rounded-full font-semibold",
                      step.status.className,
                    ].join(" ")}
                  >
                    {step.status.label}
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
	                  detail: `${coachFlow.teamCount} team${coachFlow.teamCount === 1 ? "" : "s"}`,
	                  to: "/teams",
	                  cta: "Open Teams",
	                  status: getAthleteFlowStatus({
	                    complete: coachFlow.teamCount > 0,
	                    started: false,
	                  }),
	                },
		                {
		                  key: "invite",
		                  label: "2. Invite Athletes",
		                  detail: `${coachFlow.athleteCount} athlete${coachFlow.athleteCount === 1 ? "" : "s"}`,
		                  to:
                        coachFlow.teamCount === 1 && coachFlow.primaryTeamId
                          ? `/coach/invite?teamId=${encodeURIComponent(
                              coachFlow.primaryTeamId
                            )}&teamName=${encodeURIComponent(
                              coachFlow.primaryTeamName || ""
                            )}`
                          : "/teams",
		                  cta:
                        coachFlow.teamCount === 1 && coachFlow.primaryTeamId
                          ? "Onboard Athletes"
                          : "Open Teams",
		                  status: getAthleteFlowStatus({
		                    complete: coachFlow.athleteCount > 0,
		                    started: coachFlow.teamCount > 0,
	                  }),
	                },
	                {
	                  key: "campaign",
	                  label: "3. Assign Campaign",
	                  detail: `${coachFlow.assignedCampaignCount} campaign${coachFlow.assignedCampaignCount === 1 ? "" : "s"}`,
	                  to: "/campaigns",
	                  cta: "Open Campaigns",
	                  status: getAthleteFlowStatus({
	                    complete: coachFlow.assignedCampaignCount > 0,
	                    started: coachFlow.teamCount > 0 || coachFlow.athleteCount > 0,
	                  }),
	                },
	                {
	                  key: "messages",
	                  label: "4. Launch Messages",
	                  detail: `${coachFlow.contactCount} contact${coachFlow.contactCount === 1 ? "" : "s"}`,
	                  to: "/messages",
	                  cta: "Open Messages",
	                  status: getAthleteFlowStatus({
	                    complete: coachFlow.contactCount >= 20,
	                    started: coachFlow.contactCount > 0,
	                  }),
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
	                        "text-[11px] px-2 py-1 rounded-full font-semibold",
	                        step.status.className,
	                      ].join(" ")}
	                    >
	                      {step.status.label}
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

      {!showCampaignAnalytics && (isCoach || isAdmin) && (resolvedOrgId || !isSuperAdmin) && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Campaign Overview</h2>
          <p className="mt-1 text-sm text-slate-600">
            Select a campaign to load performance summaries, donation activity, and timeline details.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              to="/campaigns"
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Open Campaigns
            </Link>
            <Link
              to="/teams"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open Teams
            </Link>
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            {campaigns?.length
              ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} available. Choose one from your campaign selector to continue.`
              : "No campaigns are available yet. Create or assign a campaign first."}
          </div>
        </div>
      )}

      {showCampaignAnalytics && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          {isAthlete && (
            <AnalyticsCard
              title="My Personal Progress"
              value={`${personalProgressPercent}%`}
              onClick={() => openInsight("progress")}
              subtext={
                athleteGoalAmount
                  ? `${formatCurrency(stats.fundsRaised)} of ${formatCurrency(
                      athleteGoalAmount
                    )}`
                  : "No personal goal set"
              }
            >
              {athleteGoalAmount > 0 && (
                <div className="mt-3">
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-slate-900 transition-all"
                      style={{ width: `${personalProgressPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </AnalyticsCard>
          )}
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
      )}

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

      {showCampaignAnalytics && (
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
      )}
    </div>
  );
}
