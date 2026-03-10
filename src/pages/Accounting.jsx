import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, documentId, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { FaArrowLeft } from "react-icons/fa";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { exportToCSV } from "../utils/exportToCSV";

function centsToCurrency(cents) {
  return (Number(cents || 0) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function percentToCents(amountCents, pct) {
  const numericPct = Number(pct || 0);
  if (!Number.isFinite(numericPct) || numericPct <= 0) return 0;
  const normalized = numericPct > 1 ? numericPct / 100 : numericPct;
  return Math.round(Number(amountCents || 0) * normalized);
}

function estimateStripeFeeCents(amountCents) {
  const amount = Number(amountCents || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round(amount * 0.029) + 30;
}

const DEFAULT_PAYOUT_PREFS = {
  preferredMethod: "standard_ach",
  payoutPayeeName: "",
  payoutEmail: "",
  mailingAddress: "",
  expeditePreference: "standard",
  notes: "",
};

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

export default function Accounting() {
  const { profile, user, activeOrgId, isSuperAdmin } = useAuth();
  const role = String(profile?.role || "").toLowerCase();
  const canAccessAccounting = ["admin", "super-admin", "coach"].includes(role);
  const resolvedOrgId = (isSuperAdmin ? activeOrgId : profile?.orgId) || profile?.orgId || "";
  const coachTeamIds = useMemo(() => getCoachScopedTeamIds(profile), [
    profile?.role,
    profile?.teamId,
    JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || []),
  ]);

  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [savingTeamStatusId, setSavingTeamStatusId] = useState("");
  const [backfillingFees, setBackfillingFees] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState("");
  const [orgName, setOrgName] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [donations, setDonations] = useState([]);
  const [teams, setTeams] = useState([]);
  const [userPreferences, setUserPreferences] = useState({});
  const [payoutPrefs, setPayoutPrefs] = useState(DEFAULT_PAYOUT_PREFS);
  const [ledgerCampaignFilter, setLedgerCampaignFilter] = useState("all");
  const [ledgerTeamFilter, setLedgerTeamFilter] = useState("all");
  const [ledgerPayoutStatusFilter, setLedgerPayoutStatusFilter] = useState("all");

  const loadAccounting = useCallback(async () => {
    if (!canAccessAccounting || !resolvedOrgId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const chunkValues = (values, size = 10) => {
        const chunks = [];
        for (let i = 0; i < values.length; i += size) {
          chunks.push(values.slice(i, i + size));
        }
        return chunks;
      };

      const getScopedDocs = async (collectionName, teamField) => {
        if (role !== "coach") {
          const snap = await getDocs(
            query(collection(db, collectionName), where("orgId", "==", resolvedOrgId))
          );
          return snap.docs;
        }
        if (coachTeamIds.length === 0) {
          return [];
        }

        const snaps = await Promise.all(
          chunkValues(coachTeamIds).map((chunk) => {
            const teamConstraint =
              teamField === "__name__"
                ? where(documentId(), "in", chunk)
                : chunk.length === 1
                  ? where(teamField, "==", chunk[0])
                  : where(teamField, "in", chunk);
            return getDocs(
              query(
                collection(db, collectionName),
                where("orgId", "==", resolvedOrgId),
                teamConstraint
              )
            );
          })
        );

        const dedupe = new Map();
        snaps.forEach((snap) => {
          snap.docs.forEach((entry) => dedupe.set(entry.id, entry));
        });
        return Array.from(dedupe.values());
      };

      const [orgSnap, campaignsDocs, donationsDocs, teamsDocs, userSnap] = await Promise.all([
        getDoc(doc(db, "organizations", resolvedOrgId)),
        getScopedDocs("campaigns", "teamId"),
        getScopedDocs("donations", "teamId"),
        getScopedDocs("teams", "__name__"),
        user?.uid ? getDoc(doc(db, "users", user.uid)) : Promise.resolve(null),
      ]);

      const nextCampaigns = campaignsDocs.map((entry) => ({
        id: entry.id,
        ...(entry.data() || {}),
      }));
      const nextDonations = donationsDocs
        .map((entry) => ({ id: entry.id, ...(entry.data() || {}) }))
        .filter((entry) => String(entry.status || "").toLowerCase() === "paid");
      const nextTeams = teamsDocs.map((entry) => ({
        id: entry.id,
        ...(entry.data() || {}),
      }));

      setCampaigns(nextCampaigns);
      setDonations(nextDonations);
      setTeams(nextTeams);
      setOrgName(String(orgSnap.exists() ? orgSnap.data()?.name || "" : ""));

      const nextPrefs = userSnap?.exists()
        ? userSnap.data()?.preferences?.payout || {}
        : {};
      const nextUserPreferences = userSnap?.exists()
        ? userSnap.data()?.preferences || {}
        : {};

      setUserPreferences(nextUserPreferences);
      setPayoutPrefs({
        ...DEFAULT_PAYOUT_PREFS,
        payoutPayeeName:
          nextPrefs.payoutPayeeName ||
          profile?.displayName ||
          profile?.name ||
          "",
        payoutEmail: nextPrefs.payoutEmail || profile?.email || "",
        ...nextPrefs,
      });
    } catch (err) {
      console.error("Failed to load accounting data:", err);
    } finally {
      setLoading(false);
    }
  }, [
    activeOrgId,
    canAccessAccounting,
    coachTeamIds,
    isSuperAdmin,
    profile?.displayName,
    profile?.email,
    profile?.name,
    role,
    resolvedOrgId,
    user?.uid,
  ]);

  useEffect(() => {
    loadAccounting();
  }, [loadAccounting]);

  const campaignSummaries = useMemo(() => {
    const byCampaign = new Map();
    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));

    for (const campaign of campaigns) {
      byCampaign.set(campaign.id, {
        id: campaign.id,
        teamId: campaign.teamId || "",
        teamName: campaign.teamName || "",
        name: campaign.name || campaign.title || "Untitled Campaign",
        isPublic: Boolean(campaign.isPublic),
        goalCents: Math.round(Number(campaign.goal || 0) * 100) || 0,
        grossCents: 0,
        donationCount: 0,
        stripeFeeCents: 0,
        platformFeeCents: 0,
        estimatedNetCents: 0,
      });
    }

    for (const donation of donations) {
      const campaignId = String(donation.campaignId || "");
      if (!campaignId) continue;

      if (!byCampaign.has(campaignId)) {
        byCampaign.set(campaignId, {
          id: campaignId,
          name: "Unknown Campaign",
          isPublic: false,
          goalCents: 0,
          grossCents: 0,
          donationCount: 0,
          stripeFeeCents: 0,
          platformFeeCents: 0,
          estimatedNetCents: 0,
        });
      }

      const summary = byCampaign.get(campaignId);
      const campaign = campaignById.get(summary.id) || {};
      const amountCents = Number(
        donation.grossAmountCents || donation.amount || 0
      );
      const campaignFeePct =
        campaign.platformFeePct != null
          ? campaign.platformFeePct
          : campaign.feePct;
      const stripeFeeCents =
        donation.stripeFeeCents != null
          ? Number(donation.stripeFeeCents || 0)
          : estimateStripeFeeCents(amountCents);
      const platformFeeCents =
        donation.platformFeeCents != null
          ? Number(donation.platformFeeCents || 0)
          : percentToCents(amountCents, campaignFeePct);
      const netAmountCents =
        donation.netAmountCents != null
          ? Number(donation.netAmountCents || 0)
          : amountCents - stripeFeeCents - platformFeeCents;

      summary.grossCents += amountCents;
      summary.donationCount += 1;
      summary.stripeFeeCents += stripeFeeCents;
      summary.platformFeeCents += platformFeeCents;
      summary.estimatedNetCents = (summary.estimatedNetCents || 0) + netAmountCents;
    }

    return Array.from(byCampaign.values())
      .map((summary) => ({
        ...summary,
        estimatedNetCents:
          summary.estimatedNetCents ??
          summary.grossCents - summary.stripeFeeCents - summary.platformFeeCents,
      }))
      .filter((summary) => summary.grossCents > 0 || summary.goalCents > 0)
      .sort((a, b) => b.grossCents - a.grossCents);
  }, [campaigns, donations]);

  const ledgerRows = useMemo(() => {
    const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const teamByIdDetailed = new Map(teams.map((team) => [team.id, team]));
    const teamById = new Map(
      teams.map((team) => [team.id, team.name || team.teamName || team.id])
    );

    return donations
      .map((donation) => {
        const campaign = campaignById.get(String(donation.campaignId || "")) || {};
        const teamId = String(campaign.teamId || "");
        const team = teamByIdDetailed.get(teamId) || {};
        const grossAmountCents = Number(
          donation.grossAmountCents || donation.amount || 0
        );
        const stripeFeeCents =
          donation.stripeFeeCents != null
            ? Number(donation.stripeFeeCents || 0)
            : estimateStripeFeeCents(grossAmountCents);
        const platformFeeCents =
          donation.platformFeeCents != null
            ? Number(donation.platformFeeCents || 0)
            : percentToCents(
                grossAmountCents,
                campaign.platformFeePct != null
                  ? campaign.platformFeePct
                  : campaign.feePct
              );
        const netAmountCents =
          donation.netAmountCents != null
            ? Number(donation.netAmountCents || 0)
            : grossAmountCents - stripeFeeCents - platformFeeCents;
        const createdAt = donation.createdAt?.toDate
          ? donation.createdAt.toDate()
          : null;

        return {
          id: donation.id,
          createdAt,
          createdAtLabel: createdAt
            ? createdAt.toLocaleString()
            : "Pending timestamp",
          donorName: donation.donorName || "Anonymous",
          donorEmail: donation.donorEmail || "N/A",
          campaignId: donation.campaignId || "",
          campaignName: campaign.name || campaign.title || donation.campaignId || "Unknown Campaign",
          teamId,
          teamName:
            teamById.get(teamId) ||
            campaign.teamName ||
            "Unassigned Team",
          grossAmountCents,
          stripeFeeCents,
          platformFeeCents,
          netAmountCents,
          payoutStatus: team.payoutStatus ||
            donation.payoutStatus ||
            (campaign.endDate && new Date(campaign.endDate) < new Date()
              ? "ready_for_review"
              : "accruing"),
          hasExactFees:
            donation.stripeFeeCents != null &&
            donation.platformFeeCents != null &&
            donation.netAmountCents != null,
        };
      })
      .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
  }, [campaigns, donations, teams]);

  const filteredLedgerRows = useMemo(() => {
    return ledgerRows.filter((row) => {
      if (ledgerCampaignFilter !== "all" && row.campaignId !== ledgerCampaignFilter) {
        return false;
      }
      if (ledgerTeamFilter !== "all" && row.teamId !== ledgerTeamFilter) {
        return false;
      }
      if (
        ledgerPayoutStatusFilter !== "all" &&
        row.payoutStatus !== ledgerPayoutStatusFilter
      ) {
        return false;
      }
      return true;
    });
  }, [ledgerCampaignFilter, ledgerPayoutStatusFilter, ledgerRows, ledgerTeamFilter]);

  const teamPayoutSummaries = useMemo(() => {
    const teamMap = new Map(
      teams.map((team) => [
        team.id,
        {
          id: team.id,
          name: team.name || team.teamName || team.id,
          coachId: team.coachId || "",
          payoutStatus: team.payoutStatus || "accruing",
          payoutNotes: team.payoutNotes || "",
          payoutReferenceNumber: team.payoutReferenceNumber || "",
          payoutPaidAt: team.payoutPaidAt || null,
          payoutMethod:
            team.payoutMethod ||
            team.payoutPreference ||
            DEFAULT_PAYOUT_PREFS.preferredMethod,
          grossCents: 0,
          stripeFeeCents: 0,
          platformFeeCents: 0,
          netAmountCents: 0,
          donationCount: 0,
          campaignCount: 0,
        },
      ])
    );

    const campaignIdsByTeam = new Map();
    campaignSummaries.forEach((summary) => {
      const teamId = String(summary.teamId || "");
      if (!teamId) return;
      if (!teamMap.has(teamId)) {
        teamMap.set(teamId, {
          id: teamId,
          name: summary.teamName || teamId,
          coachId: "",
          payoutStatus: "accruing",
          payoutNotes: "",
          payoutReferenceNumber: "",
          payoutPaidAt: null,
          payoutMethod: DEFAULT_PAYOUT_PREFS.preferredMethod,
          grossCents: 0,
          stripeFeeCents: 0,
          platformFeeCents: 0,
          netAmountCents: 0,
          donationCount: 0,
          campaignCount: 0,
        });
      }
      if (!campaignIdsByTeam.has(teamId)) {
        campaignIdsByTeam.set(teamId, new Set());
      }
      campaignIdsByTeam.get(teamId).add(summary.id);
      const row = teamMap.get(teamId);
      row.grossCents += summary.grossCents;
      row.stripeFeeCents += summary.stripeFeeCents;
      row.platformFeeCents += summary.platformFeeCents;
      row.netAmountCents += summary.estimatedNetCents;
      row.donationCount += summary.donationCount;
    });

    for (const [teamId, ids] of campaignIdsByTeam.entries()) {
      const row = teamMap.get(teamId);
      if (row) row.campaignCount = ids.size;
    }

    return Array.from(teamMap.values())
      .filter((team) => team.grossCents > 0 || team.campaignCount > 0)
      .sort((a, b) => b.netAmountCents - a.netAmountCents);
  }, [campaignSummaries, teams]);

  const totals = useMemo(() => {
    return campaignSummaries.reduce(
      (acc, summary) => {
        acc.grossCents += summary.grossCents;
        acc.stripeFeeCents += summary.stripeFeeCents;
        acc.platformFeeCents += summary.platformFeeCents;
        acc.estimatedNetCents += summary.estimatedNetCents;
        acc.donationCount += summary.donationCount;
        return acc;
      },
      {
        grossCents: 0,
        stripeFeeCents: 0,
        platformFeeCents: 0,
        estimatedNetCents: 0,
        donationCount: 0,
      }
    );
  }, [campaignSummaries]);

  const exactFeeCoverage = useMemo(() => {
    const exactRows = ledgerRows.filter((row) => row.hasExactFees).length;
    const totalRows = ledgerRows.length;
    const estimatedRows = Math.max(0, totalRows - exactRows);

    return {
      exactRows,
      totalRows,
      estimatedRows,
      percent: totalRows ? Math.round((exactRows / totalRows) * 100) : 100,
    };
  }, [ledgerRows]);

  if (!canAccessAccounting) {
    return <div className="p-6 text-red-600">Access Restricted</div>;
  }

  if (loading) {
    return <div className="p-6 text-slate-600">Loading accounting...</div>;
  }

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <FaArrowLeft /> Back to Dashboard
        </Link>

        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Accounting
            </h1>
            <p className="text-sm text-slate-500">
              Gross donations, estimated fees, payout planning, and campaign-level net views for{" "}
              <span className="font-medium text-slate-700">
                {orgName || resolvedOrgId || "your organization"}
              </span>
              .
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            Accounting Overview
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Gross Donations"
            value={centsToCurrency(totals.grossCents)}
            detail={`${totals.donationCount} paid donations`}
          />
          <SummaryCard
            label="Stripe Fees"
            value={centsToCurrency(totals.stripeFeeCents)}
            detail="Exact for backfilled/new donations, estimated for older rows"
          />
          <SummaryCard
            label="Platform Fees"
            value={centsToCurrency(totals.platformFeeCents)}
            detail="Uses configured campaign fee % when available"
          />
          <SummaryCard
            label="Net Available"
            value={centsToCurrency(totals.estimatedNetCents)}
            detail="Uses exact stored ledger fields when available"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Exact fee coverage:</span>{" "}
              {exactFeeCoverage.exactRows} of {exactFeeCoverage.totalRows} donations
              {" "}({exactFeeCoverage.percent}%)
            </div>
            <div className="text-xs text-slate-500">
              {exactFeeCoverage.estimatedRows > 0
                ? `${exactFeeCoverage.estimatedRows} donation rows still use fallback estimates.`
                : "All current donation rows are using stored fee fields."}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.7fr_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                    Campaign Accounting Summary
                </h2>
                <p className="text-xs text-slate-500">
                    Live donation totals by campaign, using stored fee data when available and safe fallback estimates for older donations.
                </p>
              </div>
              <span className="text-xs text-slate-400">
                {campaignSummaries.length} campaigns tracked
              </span>
            </div>

            {campaignSummaries.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No paid donations found yet for this organization.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-2">
                {campaignSummaries.map((summary) => (
                  <div
                    key={summary.id}
                    className="rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 px-4 py-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {summary.name}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {summary.isPublic ? "Public campaign" : "Private campaign"}
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
                        {summary.donationCount} donations
                      </span>
                    </div>

                    <div className="mt-4 space-y-2 text-sm">
                      <MiniMetric label="Gross" value={centsToCurrency(summary.grossCents)} />
                      <MiniMetric label="Net" value={centsToCurrency(summary.estimatedNetCents)} />
                      <MiniMetric label="Stripe Fees" value={centsToCurrency(summary.stripeFeeCents)} />
                      <MiniMetric label="Platform Fees" value={centsToCurrency(summary.platformFeeCents)} />
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <span>Goal</span>
                      <span className="font-medium text-slate-700">
                        {summary.goalCents > 0 ? centsToCurrency(summary.goalCents) : "Not set"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Team Payout Status
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Track net owed by team and mark where each team sits in the payout review process.
                  </p>
                </div>
                <span className="text-xs text-slate-400">
                  {teamPayoutSummaries.length} teams
                </span>
              </div>

              {teamPayoutSummaries.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No team payout activity yet.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {teamPayoutSummaries.map((team) => (
                    <div
                      key={team.id}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {team.name}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {team.campaignCount} campaigns • {team.donationCount} donations • Net {centsToCurrency(team.netAmountCents)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={team.payoutStatus}
                            onChange={async (e) => {
                              const nextStatus = e.target.value;
                              const previousTeams = teams;
                              // Optimistic local update so UI reflects the change instantly.
                              setTeams((prev) =>
                                prev.map((entry) =>
                                  entry.id === team.id
                                    ? {
                                        ...entry,
                                        payoutStatus: nextStatus,
                                      }
                                    : entry
                                )
                              );
                              try {
                                setSavingTeamStatusId(team.id);
                                await updateDoc(doc(db, "teams", team.id), {
                                  payoutStatus: nextStatus,
                                  payoutUpdatedAt: serverTimestamp(),
                                });
                              } catch (err) {
                                console.error("Failed to update payout status:", err);
                                // Revert if the write fails.
                                setTeams(previousTeams);
                              } finally {
                                setSavingTeamStatusId("");
                              }
                            }}
                            disabled={savingTeamStatusId === team.id}
                            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                          >
                            <option value="accruing">Accruing</option>
                            <option value="ready_for_review">Ready for Review</option>
                            <option value="approved">Approved</option>
                            <option value="paid">Paid</option>
                            <option value="on_hold">On Hold</option>
                          </select>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
                            {team.payoutMethod}
                          </span>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="text-[11px] uppercase tracking-wide text-slate-400">
                            Payout Reference
                          </span>
                          <input
                            value={team.payoutReferenceNumber || ""}
                            onChange={(e) =>
                              setTeams((prev) =>
                                prev.map((entry) =>
                                  entry.id === team.id
                                    ? { ...entry, payoutReferenceNumber: e.target.value }
                                    : entry
                                )
                              )
                            }
                            onBlur={async (e) => {
                              try {
                                setSavingTeamStatusId(team.id);
                                await updateDoc(doc(db, "teams", team.id), {
                                  payoutReferenceNumber: e.target.value.trim(),
                                  payoutUpdatedAt: serverTimestamp(),
                                });
                              } catch (err) {
                                console.error("Failed to save payout reference:", err);
                              } finally {
                                setSavingTeamStatusId("");
                              }
                            }}
                            className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                            placeholder="Check #, ACH trace, wire ref"
                          />
                        </label>
                        <label className="block">
                          <span className="text-[11px] uppercase tracking-wide text-slate-400">
                            Paid Date
                          </span>
                          <input
                            type="date"
                            value={toDateInputValue(team.payoutPaidAt)}
                            onChange={(e) =>
                              setTeams((prev) =>
                                prev.map((entry) =>
                                  entry.id === team.id
                                    ? { ...entry, payoutPaidAt: e.target.value || null }
                                    : entry
                                )
                              )
                            }
                            onBlur={async (e) => {
                              try {
                                setSavingTeamStatusId(team.id);
                                await updateDoc(doc(db, "teams", team.id), {
                                  payoutPaidAt: e.target.value || null,
                                  payoutUpdatedAt: serverTimestamp(),
                                });
                              } catch (err) {
                                console.error("Failed to save payout paid date:", err);
                              } finally {
                                setSavingTeamStatusId("");
                              }
                            }}
                            className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          />
                        </label>
                      </div>
                      <label className="mt-3 block">
                        <span className="text-[11px] uppercase tracking-wide text-slate-400">
                          Payout Notes
                        </span>
                        <textarea
                          rows={2}
                          value={team.payoutNotes || ""}
                          onChange={(e) =>
                            setTeams((prev) =>
                              prev.map((entry) =>
                                entry.id === team.id
                                  ? { ...entry, payoutNotes: e.target.value }
                                  : entry
                              )
                            )
                          }
                          onBlur={async (e) => {
                            try {
                              setSavingTeamStatusId(team.id);
                              await updateDoc(doc(db, "teams", team.id), {
                                payoutNotes: e.target.value.trim(),
                                payoutUpdatedAt: serverTimestamp(),
                              });
                            } catch (err) {
                              console.error("Failed to save payout notes:", err);
                            } finally {
                              setSavingTeamStatusId("");
                            }
                          }}
                          className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                          placeholder="Optional notes about payout timing, holds, or reconciliation"
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Payout Preferences
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                This stores your current payout workflow preference. Actual ACH/check/wire execution will be added in a later payout operations phase.
              </p>

              <div className="mt-4 space-y-4">
                <FormField label="Preferred Method">
                  <select
                    value={payoutPrefs.preferredMethod}
                    onChange={(e) =>
                      setPayoutPrefs((prev) => ({
                        ...prev,
                        preferredMethod: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="standard_ach">Standard ACH (recommended)</option>
                    <option value="expedited_ach">Expedited ACH</option>
                    <option value="check">Paper Check</option>
                    <option value="wire">Wire Transfer</option>
                  </select>
                </FormField>

                <FormField label="Payee Name">
                  <input
                    value={payoutPrefs.payoutPayeeName}
                    onChange={(e) =>
                      setPayoutPrefs((prev) => ({
                        ...prev,
                        payoutPayeeName: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    placeholder="Team booster club, coach, or school payee name"
                  />
                </FormField>

                <FormField label="Accounting Contact Email">
                  <input
                    type="email"
                    value={payoutPrefs.payoutEmail}
                    onChange={(e) =>
                      setPayoutPrefs((prev) => ({
                        ...prev,
                        payoutEmail: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    placeholder="accounting@example.org"
                  />
                </FormField>

                <FormField label="Mailing Address">
                  <textarea
                    rows={3}
                    value={payoutPrefs.mailingAddress}
                    onChange={(e) =>
                      setPayoutPrefs((prev) => ({
                        ...prev,
                        mailingAddress: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    placeholder="Required if check delivery is preferred"
                  />
                </FormField>

                <FormField label="Delivery Speed Preference">
                  <select
                    value={payoutPrefs.expeditePreference}
                    onChange={(e) =>
                      setPayoutPrefs((prev) => ({
                        ...prev,
                        expeditePreference: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="standard">No extra fee preference</option>
                    <option value="expedite_when_available">Expedite when available</option>
                    <option value="confirm_before_fee">Ask before charging any expedite fee</option>
                  </select>
                </FormField>

                <FormField label="Accounting Notes">
                  <textarea
                    rows={3}
                    value={payoutPrefs.notes}
                    onChange={(e) =>
                      setPayoutPrefs((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    placeholder="Optional notes about payout contact, school finance office, or delivery constraints"
                  />
                </FormField>

                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                  Standard ACH is the best default when payout operations go live. Check and wire usually create extra handling cost and should remain opt-in.
                </div>

                {role !== "coach" && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          Historical Fee Backfill
                        </p>
                        <p className="text-xs text-slate-500">
                          Populate exact Stripe/platform/net fee fields for older donations that predate the accounting webhook update.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={backfillingFees || !resolvedOrgId}
                        onClick={async () => {
                          try {
                            setBackfillingFees(true);
                            setBackfillStatus("");
                            const fn = httpsCallable(functions, "backfillDonationFees");
                            const result = await fn({ orgId: resolvedOrgId, limit: 150 });
                            const data = result?.data || {};
                            setBackfillStatus(
                              `Backfill complete. Scanned ${data.scanned || 0}, updated ${data.updated || 0}, failed ${Array.isArray(data.failed) ? data.failed.length : 0}.`
                            );
                            await loadAccounting();
                          } catch (err) {
                            console.error("Failed to backfill donation fees:", err);
                            setBackfillStatus("Backfill failed. Check function logs and retry.");
                          } finally {
                            setBackfillingFees(false);
                          }
                        }}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        {backfillingFees ? "Backfilling..." : "Backfill Historical Fees"}
                      </button>
                    </div>
                    {backfillStatus ? (
                      <p className="mt-2 text-xs text-slate-600">{backfillStatus}</p>
                    ) : null}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">{saveStatus || "Preferences save to your account profile."}</span>
                  <button
                    type="button"
                    disabled={savingPrefs || !user?.uid}
                    onClick={async () => {
                      if (!user?.uid) return;
                      try {
                        setSavingPrefs(true);
                        setSaveStatus("");
                        await updateDoc(doc(db, "users", user.uid), {
                          preferences: {
                            ...userPreferences,
                            payout: {
                              ...payoutPrefs,
                            },
                          },
                          updatedAt: serverTimestamp(),
                        });
                        setUserPreferences((prev) => ({
                          ...prev,
                          payout: {
                            ...payoutPrefs,
                          },
                        }));
                        setSaveStatus("Payout preferences saved.");
                      } catch (err) {
                        console.error("Failed to save payout preferences:", err);
                        setSaveStatus("Failed to save payout preferences.");
                      } finally {
                        setSavingPrefs(false);
                      }
                    }}
                    className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {savingPrefs ? "Saving..." : "Save Preferences"}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Donation Ledger
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Per-donation accounting rows for export, review, and reconciliation.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!filteredLedgerRows.length}
                  onClick={() =>
                    exportToCSV(
                      filteredLedgerRows.map((row) => ({
                        createdAt: row.createdAtLabel,
                        donorName: row.donorName,
                        donorEmail: row.donorEmail,
                        campaign: row.campaignName,
                        team: row.teamName,
                        grossAmount: centsToCurrency(row.grossAmountCents),
                        stripeFee: centsToCurrency(row.stripeFeeCents),
                        platformFee: centsToCurrency(row.platformFeeCents),
                        netAmount: centsToCurrency(row.netAmountCents),
                        payoutStatus: row.payoutStatus,
                        exactFeeFields: row.hasExactFees ? "yes" : "estimated",
                      })),
                      `accounting_ledger_${resolvedOrgId || "org"}.csv`
                    )
                  }
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  Export CSV
                </button>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">
                    Campaign
                  </span>
                  <select
                    value={ledgerCampaignFilter}
                    onChange={(e) => setLedgerCampaignFilter(e.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All campaigns</option>
                    {campaignSummaries.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">
                    Team
                  </span>
                  <select
                    value={ledgerTeamFilter}
                    onChange={(e) => setLedgerTeamFilter(e.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All teams</option>
                    {teamPayoutSummaries.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">
                    Payout Status
                  </span>
                  <select
                    value={ledgerPayoutStatusFilter}
                    onChange={(e) => setLedgerPayoutStatusFilter(e.target.value)}
                    className="mt-2 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All statuses</option>
                    <option value="accruing">Accruing</option>
                    <option value="ready_for_review">Ready for Review</option>
                    <option value="approved">Approved</option>
                    <option value="paid">Paid</option>
                    <option value="on_hold">On Hold</option>
                  </select>
                </label>
              </div>
              {filteredLedgerRows.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No ledger rows match the current filters.
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Donor</th>
                        <th className="px-3 py-2 font-semibold">Campaign</th>
                        <th className="px-3 py-2 font-semibold">Team</th>
                        <th className="px-3 py-2 font-semibold text-right">Gross</th>
                        <th className="px-3 py-2 font-semibold text-right">Stripe</th>
                        <th className="px-3 py-2 font-semibold text-right">Platform</th>
                        <th className="px-3 py-2 font-semibold text-right">Net</th>
                        <th className="px-3 py-2 font-semibold text-right">Fee Data</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredLedgerRows.slice(0, 50).map((row) => (
                        <tr key={row.id}>
                          <td className="px-3 py-2 text-slate-600">{row.createdAtLabel}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-800">{row.donorName}</div>
                            <div className="text-xs text-slate-500">{row.donorEmail}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{row.campaignName}</td>
                          <td className="px-3 py-2 text-slate-700">{row.teamName}</td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900">
                            {centsToCurrency(row.grossAmountCents)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {centsToCurrency(row.stripeFeeCents)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-600">
                            {centsToCurrency(row.platformFeeCents)}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-700">
                            {centsToCurrency(row.netAmountCents)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-slate-500">
                            {row.hasExactFees ? "Exact" : "Estimated"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">
                Payout Workflow Notes
              </h2>
                <div className="mt-3 space-y-3 text-sm text-slate-600">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  Campaign closes, net proceeds are reviewed, payout is approved, and funds are released.
                  </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  This page does not move money yet. It prepares payout preference data and gives finance visibility before Stripe Connect or manual check workflows are added.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function toDateInputValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  if (value?.toDate) {
    return value.toDate().toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return "";
}

function SummaryCard({ label, value, detail }) {
  return (
    <div className="rounded-2xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/80 px-4 py-4 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
      <div className="mt-2 text-xs text-slate-500">{detail}</div>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="text-sm font-semibold text-right text-slate-800 break-all">
        {value}
      </div>
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-slate-400">
        {label}
      </label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
