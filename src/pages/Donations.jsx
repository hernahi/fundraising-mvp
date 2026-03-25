// src/pages/Donations.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaPlus } from "react-icons/fa";

import ListLoadingSpinner from "../components/ListLoadingSpinner";
import ListEmptyState from "../components/ListEmptyState";

import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";
import { safeImageURL } from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";

import { db } from "../firebase/config";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
} from "../firebase/firestore";

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

export default function Donors() {
  const { profile, activeOrgId, activeOrgName, isSuperAdmin, loading: authLoading } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();

  const [donors, setDonors] = useState([]);
  const [donationRows, setDonationRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created");
  const [activityFilter, setActivityFilter] = useState("all");
  const orgId = isSuperAdmin ? activeOrgId || "" : profile?.orgId || "";
  const role = String(profile?.role || "").toLowerCase();
  const isCoach = role === "coach";
  const coachTeamIds = useMemo(() => getCoachScopedTeamIds(profile), [
    profile?.role,
    profile?.teamId,
    JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || []),
  ]);

  useEffect(() => {
    if (authLoading) return;
    if (!orgId) {
      setDonors([]);
      setLoading(false);
      return;
    }
    if (isCoach && coachTeamIds.length === 0) {
      setDonors([]);
      setLoading(false);
      return;
    }

    const ref = collection(db, "donors");
    if (!isCoach) {
      const q = query(
        ref,
        where("orgId", "==", orgId),
        orderBy("createdAt", "desc")
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setDonors(items);
          setLoading(false);
          setLastUpdated(new Date().toLocaleTimeString());
        },
        (err) => {
          console.error("Donors listener error:", err);
          push("Failed to load donors.", "error");
          setLoading(false);
        }
      );
      return () => unsub();
    }

    const chunkSize = 10;
    const chunks = [];
    for (let i = 0; i < coachTeamIds.length; i += chunkSize) {
      chunks.push(coachTeamIds.slice(i, i + chunkSize));
    }

    const itemsByChunk = new Map();
    let hasError = false;

    const applyMerged = () => {
      const merged = [];
      const dedupe = new Map();
      itemsByChunk.forEach((rows) => {
        rows.forEach((row) => dedupe.set(row.id, row));
      });
      dedupe.forEach((row) => merged.push(row));
      merged.sort((a, b) => {
        const aTime =
          a.createdAt?.toDate?.()?.getTime?.() ||
          (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
        const bTime =
          b.createdAt?.toDate?.()?.getTime?.() ||
          (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
        return bTime - aTime;
      });
      setDonors(merged);
      setLoading(false);
      setLastUpdated(new Date().toLocaleTimeString());
    };

    const unsubs = chunks.map((chunk, index) => {
      const teamConstraint =
        chunk.length === 1
          ? where("teamId", "==", chunk[0])
          : where("teamId", "in", chunk);
      const q = query(
        ref,
        where("orgId", "==", orgId),
        teamConstraint,
        orderBy("createdAt", "desc")
      );
      return onSnapshot(
        q,
        (snap) => {
          itemsByChunk.set(
            index,
            snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          );
          applyMerged();
        },
        (err) => {
          console.error("Donors listener error:", err);
          if (!hasError) {
            push("Failed to load donors.", "error");
            hasError = true;
          }
          setLoading(false);
        }
      );
    });

    return () => unsubs.forEach((unsub) => unsub());
  }, [authLoading, coachTeamIds, isCoach, orgId, push]);

  useEffect(() => {
    if (authLoading) return;
    if (!orgId) {
      setDonationRows([]);
      return;
    }
    if (isCoach && coachTeamIds.length === 0) {
      setDonationRows([]);
      return;
    }

    const ref = collection(db, "donations");
    if (!isCoach) {
      const q = query(ref, where("orgId", "==", orgId));
      const unsub = onSnapshot(
        q,
        (snap) => {
          setDonationRows(
            snap.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
            }))
          );
        },
        (err) => {
          console.error("Donations stats listener error:", err);
        }
      );
      return () => unsub();
    }

    const chunkSize = 10;
    const chunks = [];
    for (let i = 0; i < coachTeamIds.length; i += chunkSize) {
      chunks.push(coachTeamIds.slice(i, i + chunkSize));
    }
    const rowsByChunk = new Map();

    const applyMerged = () => {
      const dedupe = new Map();
      rowsByChunk.forEach((rows) => {
        rows.forEach((row) => dedupe.set(row.id, row));
      });
      setDonationRows(Array.from(dedupe.values()));
    };

    const unsubs = chunks.map((chunk, index) => {
      const teamConstraint =
        chunk.length === 1
          ? where("teamId", "==", chunk[0])
          : where("teamId", "in", chunk);
      const q = query(ref, where("orgId", "==", orgId), teamConstraint);
      return onSnapshot(
        q,
        (snap) => {
          rowsByChunk.set(
            index,
            snap.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
            }))
          );
          applyMerged();
        },
        (err) => {
          console.error("Donations stats listener error:", err);
        }
      );
    });

    return () => unsubs.forEach((unsub) => unsub());
  }, [authLoading, coachTeamIds, isCoach, orgId]);

  const donationStats = useMemo(() => {
    const next = {};
    donationRows.forEach((data) => {
      const donorEmail = String(
        data.donorEmail || data.donor?.email || ""
      ).trim().toLowerCase();
      const donorName = String(
        data.donorName || data.donor?.name || ""
      ).trim();
      const donorKey =
        data.donorId ||
        data.donor?.id ||
        data.donor?.uid ||
        (donorEmail ? `email:${donorEmail}` : "") ||
        (donorName ? `name:${donorName}` : "") ||
        `unresolved:${data.id}`;

      const amount = Number(data.amount || 0);
      const createdAt =
        data.createdAt?.toDate?.() ||
        (data.createdAt?.seconds
          ? new Date(data.createdAt.seconds * 1000)
          : null);

      const current = next[donorKey] || {
        total: 0,
        count: 0,
        lastDonationAt: null,
        lastCampaignId: null,
        lastCampaignName: null,
        lastAthleteId: null,
        lastAthleteName: null,
        donorName: "",
        donorEmail: "",
        donorId: data.donorId || null,
      };

      current.total += amount;
      current.count += 1;
      current.donorName = current.donorName || donorName;
      current.donorEmail = current.donorEmail || donorEmail;

      if (
        createdAt &&
        (!current.lastDonationAt || createdAt > current.lastDonationAt)
      ) {
        current.lastDonationAt = createdAt;
        current.lastCampaignId = data.campaignId || null;
        current.lastCampaignName =
          data.campaignName || data.campaign?.name || null;
        current.lastAthleteId = data.athleteId || null;
        current.lastAthleteName =
          data.athleteName || data.athlete?.name || null;
      }

      next[donorKey] = current;
    });
    return next;
  }, [donationRows]);

  const normalizedDonors = useMemo(() => {
    const donorsById = new Map(donors.map((d) => [d.id, d]));
    const rows = [];
    const seenKeys = new Set();

    Object.entries(donationStats).forEach(([key, stats]) => {
      const donorDoc = stats.donorId ? donorsById.get(stats.donorId) : null;
      const donorName =
        donorDoc?.name ||
        donorDoc?.donorName ||
        donorDoc?.fullName ||
        stats.donorName ||
        "Anonymous";
      const donorEmail =
        donorDoc?.email ||
        donorDoc?.donorEmail ||
        stats.donorEmail ||
        "";
      const createdAt =
        donorDoc?.createdAt?.toDate?.() ||
        (donorDoc?.createdAt?.seconds
          ? new Date(donorDoc.createdAt.seconds * 1000)
          : null);

      rows.push({
        ...(donorDoc || {}),
        id: donorDoc?.id || key,
        donorName,
        donorEmail,
        totalDonations: stats.total,
        donationCount: stats.count,
        lastDonationAt: stats.lastDonationAt || createdAt,
        lastCampaignId: stats.lastCampaignId,
        lastCampaignName: stats.lastCampaignName || "",
        lastAthleteId: stats.lastAthleteId,
        lastAthleteName: stats.lastAthleteName || "",
        hasDonorDoc: !!donorDoc,
      });

      if (donorDoc?.id) {
        seenKeys.add(donorDoc.id);
      }
    });

    donors.forEach((d) => {
      if (seenKeys.has(d.id)) return;
      const createdAt =
        d.createdAt?.toDate?.() ||
        (d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null);
      rows.push({
        ...d,
        donorName:
          d.name || d.donorName || d.fullName || d.donor?.name || "Anonymous",
        donorEmail: d.email || d.donorEmail || d.donor?.email || "",
        totalDonations: d.totalDonations ?? d.amount ?? 0,
        donationCount: d.donationCount ?? 0,
        lastDonationAt: createdAt,
        lastCampaignId: d.lastCampaignId ?? d.campaignId ?? null,
        lastCampaignName: d.lastCampaignName ?? d.campaignName ?? "",
        lastAthleteId: d.lastAthleteId ?? d.athleteId ?? null,
        lastAthleteName: d.lastAthleteName ?? d.athleteName ?? "",
        hasDonorDoc: true,
      });
    });

    return rows;
  }, [donationStats, donors]);

  const sortDonors = (rows, sortKey) => {
    const sorters = {
      recent: (a, b) =>
        (b.lastDonationAt?.getTime?.() || 0) -
        (a.lastDonationAt?.getTime?.() || 0),
      total: (a, b) => (b.totalDonations || 0) - (a.totalDonations || 0),
      name: (a, b) => a.donorName.localeCompare(b.donorName),
      created: (a, b) =>
        (b.createdAt?.toDate?.()?.getTime?.() || 0) -
        (a.createdAt?.toDate?.()?.getTime?.() || 0),
    };
    const sorter = sorters[sortKey] || sorters.recent;
    return [...rows].sort(sorter);
  };

  const visibleDonors = useMemo(() => {
    const q = (search || "").trim().toLowerCase();

    let rows = normalizedDonors;

    if (q) {
      rows = rows.filter((d) => {
        const haystack = `${d.donorName} ${d.donorEmail} ${d.id}`.toLowerCase();
        return haystack.includes(q);
      });
    }

    if (activityFilter === "with") {
      rows = rows.filter((d) => d.donationCount > 0);
    } else if (activityFilter === "none") {
      rows = rows.filter((d) => d.donationCount === 0);
    }

    return sortDonors(rows, sortBy);
  }, [normalizedDonors, search, activityFilter, sortBy]);

  const exportCsv = (rows, filename) => {
    if (rows.length === 0) {
      push("No donors to export.", "warning");
      return;
    }

    const headers = [
      "Donor ID",
      "Name",
      "Email",
      "Total Donations",
      "Donation Count",
      "Last Donation",
      "Last Campaign",
      "Last Athlete",
      "Created At",
    ];

    const csvEscape = (value) => {
      if (value == null) return "";
      const str = String(value);
      if (/[",\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const dataRows = rows.map((d) => {
      const createdAt =
        d.createdAt?.toDate?.() ||
        (d.createdAt?.seconds ? new Date(d.createdAt.seconds * 1000) : null);

      return [
        d.id,
        d.donorName,
        d.donorEmail,
        d.totalDonations ?? 0,
        d.donationCount ?? 0,
        d.lastDonationAt ? d.lastDonationAt.toISOString() : "",
        d.lastCampaignName || "",
        d.lastAthleteName || "",
        createdAt ? createdAt.toISOString() : "",
      ].map(csvEscape);
    });

    const csv = [
      headers.map(csvEscape).join(","),
      ...dataRows.map((r) => r.join(",")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `${filename}_${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (authLoading) {
    return (
      <div className="p-4 md:p-6">
        <ListLoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Donors
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isSuperAdmin
              ? `Viewing donors for ${activeOrgName || orgId || "the selected organization"}`
              : `Viewing donors for ${profile?.orgName || orgId || "your organization"}`}
          </p>
          {lastUpdated && (
            <div className="mt-1 text-xs text-slate-400">
              Last synced: {lastUpdated}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate("/donors/new")}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            <FaPlus className="text-xs" />
            Add Donor
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-500">
        This list is for returning donors. One-time donations appear on campaign
        pages.
      </p>

      <div className="mt-4 flex flex-col gap-3 md:gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search donors (name, email, ID)"
            className="w-full sm:w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-yellow-200"
          />

          <select
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm w-full sm:w-auto"
          >
            <option value="all">All donors</option>
            <option value="with">With donations</option>
            <option value="none">No donations</option>
          </select>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wide">
            Sort
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm w-full sm:w-auto"
          >
            <option value="recent">Recent activity</option>
            <option value="total">Total donated</option>
            <option value="name">Name</option>
            <option value="created">Newest added</option>
          </select>
          <button
            type="button"
            onClick={() => exportCsv(sortDonors(normalizedDonors, sortBy), "donors_all")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 w-full sm:w-auto"
          >
            Export All
          </button>
        </div>
      </div>

      {!orgId ? (
        <ListEmptyState message="Select an organization to view donors." />
      ) : loading ? (
        <ListLoadingSpinner />
      ) : visibleDonors.length === 0 ? (
        <ListEmptyState message="No donors found." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5 lg:gap-6">
          {visibleDonors.map((d) => {
            const avatarUrl =
              d.imgUrl || d.photoURL || d.photoUrl || d.avatarUrl || "";
            const lastDonationLabel = d.lastDonationAt
              ? d.lastDonationAt.toLocaleDateString()
              : "N/A";

            return (
              <div
                key={d.id}
                className="rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md hover:border-slate-400"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={safeImageURL(
                      avatarUrl,
                      avatarFallback({ label: d.donorName || "Donor", type: "user", size: 96 })
                    )}
                    alt={d.donorName || "Donor"}
                    className="w-12 h-12 rounded-full border object-cover bg-slate-100 shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800 truncate">
                      {d.donorName}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {d.donorEmail || "No email"}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                      ID: {d.id}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full border border-slate-300 text-slate-700">
                    Total ${Number(d.totalDonations || 0).toLocaleString()}
                  </span>
                  <span className="px-2 py-1 rounded-full border border-slate-300 text-slate-700">
                    {d.donationCount || 0} gift{(d.donationCount || 0) === 1 ? "" : "s"}
                  </span>
                  <span className="px-2 py-1 rounded-full border border-slate-300 text-slate-700">
                    Last {lastDonationLabel}
                  </span>
                  {d.lastCampaignName && (
                    <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                      {d.lastCampaignName}
                    </span>
                  )}
                </div>

                <div className="mt-4 flex justify-end sm:justify-end">
                  <Link
                    to={`/donors/${encodeURIComponent(d.id)}`}
                    className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition w-full sm:w-auto text-center"
                  >
                    View
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
