import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { FaArrowLeft } from "react-icons/fa";
import { Link } from "react-router-dom";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

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

export default function Accounting() {
  const { profile, user, activeOrgId, isSuperAdmin } = useAuth();
  const role = String(profile?.role || "").toLowerCase();
  const canAccessAccounting = ["admin", "super-admin", "coach"].includes(role);
  const resolvedOrgId = (isSuperAdmin ? activeOrgId : profile?.orgId) || profile?.orgId || "";

  const [loading, setLoading] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [orgName, setOrgName] = useState("");
  const [campaigns, setCampaigns] = useState([]);
  const [donations, setDonations] = useState([]);
  const [userPreferences, setUserPreferences] = useState({});
  const [payoutPrefs, setPayoutPrefs] = useState(DEFAULT_PAYOUT_PREFS);

  useEffect(() => {
    if (!canAccessAccounting || !resolvedOrgId) {
      setLoading(false);
      return;
    }

    async function loadAccounting() {
      try {
        setLoading(true);

        const [orgSnap, campaignsSnap, donationsSnap, userSnap] = await Promise.all([
          getDoc(doc(db, "organizations", resolvedOrgId)),
          getDocs(query(collection(db, "campaigns"), where("orgId", "==", resolvedOrgId))),
          getDocs(query(collection(db, "donations"), where("orgId", "==", resolvedOrgId))),
          user?.uid ? getDoc(doc(db, "users", user.uid)) : Promise.resolve(null),
        ]);

        const nextCampaigns = campaignsSnap.docs.map((entry) => ({
          id: entry.id,
          ...(entry.data() || {}),
        }));
        const nextDonations = donationsSnap.docs
          .map((entry) => ({ id: entry.id, ...(entry.data() || {}) }))
          .filter((entry) => String(entry.status || "").toLowerCase() === "paid");

        setCampaigns(nextCampaigns);
        setDonations(nextDonations);
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
    }

    loadAccounting();
  }, [
    activeOrgId,
    canAccessAccounting,
    isSuperAdmin,
    profile?.displayName,
    profile?.email,
    profile?.name,
    resolvedOrgId,
    user?.uid,
  ]);

  const campaignSummaries = useMemo(() => {
    const byCampaign = new Map();

    for (const campaign of campaigns) {
      byCampaign.set(campaign.id, {
        id: campaign.id,
        name: campaign.name || campaign.title || "Untitled Campaign",
        isPublic: Boolean(campaign.isPublic),
        goalCents: Math.round(Number(campaign.goal || 0) * 100) || 0,
        grossCents: 0,
        donationCount: 0,
        stripeFeeCents: 0,
        platformFeeCents: 0,
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
        });
      }

      const summary = byCampaign.get(campaignId);
      const amountCents = Number(donation.amount || 0);
      const campaignFeePct =
        summary?.id && campaigns.find((campaign) => campaign.id === summary.id)?.platformFeePct != null
          ? campaigns.find((campaign) => campaign.id === summary.id)?.platformFeePct
          : campaigns.find((campaign) => campaign.id === summary.id)?.feePct;

      summary.grossCents += amountCents;
      summary.donationCount += 1;
      summary.stripeFeeCents += estimateStripeFeeCents(amountCents);
      summary.platformFeeCents += percentToCents(amountCents, campaignFeePct);
    }

    return Array.from(byCampaign.values())
      .map((summary) => ({
        ...summary,
        estimatedNetCents:
          summary.grossCents - summary.stripeFeeCents - summary.platformFeeCents,
      }))
      .filter((summary) => summary.grossCents > 0 || summary.goalCents > 0)
      .sort((a, b) => b.grossCents - a.grossCents);
  }, [campaigns, donations]);

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
            Reporting-first accounting pass
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Gross Donations"
            value={centsToCurrency(totals.grossCents)}
            detail={`${totals.donationCount} paid donations`}
          />
          <SummaryCard
            label="Est. Stripe Fees"
            value={centsToCurrency(totals.stripeFeeCents)}
            detail="Estimated at 2.9% + $0.30 per paid donation"
          />
          <SummaryCard
            label="Platform Fees"
            value={centsToCurrency(totals.platformFeeCents)}
            detail="Uses configured campaign fee % when available"
          />
          <SummaryCard
            label="Est. Net Available"
            value={centsToCurrency(totals.estimatedNetCents)}
            detail="Gross less estimated processing + configured fees"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.7fr_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Campaign Fee / Net Summary
                </h2>
                <p className="text-xs text-slate-500">
                  Live donation totals by campaign. Exact payout ledger and chargeback adjustments will be added in a later accounting phase.
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
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
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

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <MiniMetric label="Gross" value={centsToCurrency(summary.grossCents)} />
                      <MiniMetric label="Est. Net" value={centsToCurrency(summary.estimatedNetCents)} />
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
              <h2 className="text-sm font-semibold text-slate-900">
                Payout Workflow Notes
              </h2>
                <div className="mt-3 space-y-3 text-sm text-slate-600">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  Campaign closes, net is reviewed, payout is approved, and funds are released.
                  </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  This first pass does not move money. It prepares payout preference data and gives finance visibility before Stripe Connect or manual check workflows are added.
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
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
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
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
