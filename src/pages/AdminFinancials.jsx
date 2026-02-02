import { useEffect, useState, useMemo } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

function centsToDollars(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

export default function AdminFinancials() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rollups, setRollups] = useState([]);

  useEffect(() => {
    if (!profile?.orgId) return;

    async function load() {
      setLoading(true);

      const snap = await getDocs(
        query(
          collection(db, "donation_rollups"),
          where("orgId", "==", profile.orgId)
        )
      );

      const rows = snap.docs
        .map(d => d.data())
        .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

      setRollups(rows);
      setLoading(false);
    }

    load();
  }, [profile?.orgId]);

  const totals = useMemo(() => {
    return rollups.reduce(
      (acc, r) => {
        acc.amount += r.totalAmountCents || 0;
        acc.count += r.donationCount || 0;
        return acc;
      },
      { amount: 0, count: 0 }
    );
  }, [rollups]);

  const byCampaign = useMemo(() => {
    const map = {};
    rollups.forEach(r => {
      Object.entries(r.byCampaign || {}).forEach(([cid, v]) => {
        if (!map[cid]) {
          map[cid] = { amount: 0, count: 0 };
        }
        map[cid].amount += v.amountCents || 0;
        map[cid].count += v.count || 0;
      });
    });
    return map;
  }, [rollups]);

  if (!["admin", "super-admin"].includes(profile?.role)) {
    return <div>Access Restricted</div>;
  }

  if (loading) return <div>Loading financials…</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Financial Overview</h1>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Total Raised" value={`$${centsToDollars(totals.amount)}`} />
        <Stat label="Donations" value={totals.count} />
        <Stat
          label="Avg Donation"
          value={`$${centsToDollars(
            totals.count ? totals.amount / totals.count : 0
          )}`}
        />
        <Stat label="Days" value={rollups.length} />
      </div>

      {/* DAILY TABLE */}
      <div>
        <h2 className="text-lg font-semibold mb-2">Daily Totals</h2>
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-right">Donations</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rollups.map(r => (
              <tr key={r.dateKey} className="border-t">
                <td className="p-2">{r.dateKey}</td>
                <td className="p-2 text-right">{r.donationCount}</td>
                <td className="p-2 text-right">
                  ${centsToDollars(r.totalAmountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CAMPAIGN BREAKDOWN */}
      <div>
        <h2 className="text-lg font-semibold mb-2">By Campaign</h2>
        <table className="w-full text-sm border">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2 text-left">Campaign</th>
              <th className="p-2 text-right">Donations</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(byCampaign).map(([cid, v]) => (
              <tr key={cid} className="border-t">
                <td className="p-2">{cid}</td>
                <td className="p-2 text-right">{v.count}</td>
                <td className="p-2 text-right">
                  ${centsToDollars(v.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="border rounded p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}
