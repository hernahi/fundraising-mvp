// src/pages/Donations.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import HeaderActions from "../components/HeaderActions";
import ListLoadingSpinner from "../components/ListLoadingSpinner";
import ListEmptyState from "../components/ListEmptyState";
import CardUserAvatar from "../components/CardUserAvatar";
import CardStatBadge from "../components/CardStatBadge";

import { useToast } from "../components/Toast";
import { useAuth } from "../context/AuthContext";

import { db } from "../firebase/config";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
} from "../firebase/firestore";

export default function Donors() {
  const { profile, activeOrgId, loading: authLoading } = useAuth();
  const { push } = useToast();

  const [donors, setDonors] = useState([]);
  const [donationRows, setDonationRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created");
  const [activityFilter, setActivityFilter] = useState("all");
  const orgId = activeOrgId || profile?.orgId;

  useEffect(() => {
    if (authLoading) return;
    if (!orgId) {
      setDonors([]);
      setLoading(false);
      return;
    }

    const ref = collection(db, "donors");
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
  }, [authLoading, orgId, push]);

  useEffect(() => {
    if (authLoading) return;
    if (!orgId) {
      setDonationRows([]);
      return;
    }

    const ref = collection(db, "donations");
    const q = query(ref, where("orgId", "==", orgId));

    const unsub = onSnapshot(
      q,
      (snap) => {
        setDonationRows(snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })));
      },
      (err) => {
        console.error("Donations stats listener error:", err);
      }
    );

    return () => unsub();
  }, [authLoading, orgId]);

  const donationStats = useMemo(() => {
    const next = {};
    donationRows.forEach((data) => {
      const donorKey =
        data.donorId ||
        data.donor?.id ||
        data.donor?.uid ||
        data.donorEmail ||
        data.donorName ||
        data.id;

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
      current.donorName =
        current.donorName || data.donorName || data.donor?.name || "";
      current.donorEmail =
        current.donorEmail || data.donorEmail || data.donor?.email || "";

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
      <HeaderActions
        title="Donors"
        addLabel={<Link to="/donors/new">+ Add Donor</Link>}
        exportLabel="Export CSV"
        onExport={() => {
          exportCsv(visibleDonors, "donors_filtered");
        }}
        lastUpdated={lastUpdated}
      />
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

      {loading ? (
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
                className="bg-white rounded-2xl border border-slate-200 p-4 md:p-5 shadow hover:shadow-yellow-300/40 transition-all duration-300"
              >
                <div className="flex items-start md:items-center gap-3">
                  <CardUserAvatar name={d.donorName} imgUrl={avatarUrl} />

                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800">
                      {d.donorName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {d.donorEmail || "No email"}
                    </div>
                  </div>
                </div>

                <div className="text-[10px] text-slate-400 mt-1 select-all">
                  ID: {d.id}
                </div>

                <div className="mt-3 flex gap-2 flex-wrap">
                  <CardStatBadge
                    label="Total Donations"
                    value={d.totalDonations}
                  />
                  <CardStatBadge
                    label="Last Donation"
                    value={lastDonationLabel}
                  />
                </div>

                <div className="mt-4 flex justify-end sm:justify-end">
                  {d.hasDonorDoc ? (
                    <Link
                      to={`/donors/${d.id}`}
                      className="text-sm px-3 py-1.5 rounded-lg border border-yellow-400 text-yellow-600 hover:bg-yellow-400 hover:text-slate-900 transition w-full sm:w-auto text-center"
                    >
                      View
                    </Link>
                  ) : (
                    <span className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-400 cursor-not-allowed w-full sm:w-auto text-center">
                      View
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
