import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../firebase/config";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import safeImageURL from "../utils/safeImage";

// Utility
function formatCurrency(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

export default function CampaignOverview() {
  const { campaignId } = useParams();
  const [campaign, setCampaign] = useState(null);
  const [donations, setDonations] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAll() {
      try {
        setLoading(true);

        // Load campaign
        const cRef = doc(db, "campaigns", campaignId);
        const cSnap = await getDoc(cRef);
        if (!cSnap.exists()) {
          console.error("Campaign not found:", campaignId);
          setLoading(false);
          return;
        }
        setCampaign({ id: cSnap.id, ...cSnap.data() });

        // Load donations
        const dRef = collection(db, "donations");
        const qDon = query(dRef, where("campaignId", "==", campaignId));
        const dSnap = await getDocs(qDon);
        const dList = dSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setDonations(dList);

        // Load athletes
        const aRef = collection(db, "athletes");
        const qAth = query(aRef, where("campaignId", "==", campaignId));
        const aSnap = await getDocs(qAth);
        const aList = aSnap.docs.map((a) => ({ id: a.id, ...a.data() }));
        setAthletes(aList);
      } catch (err) {
        console.error("Error loading campaign overview:", err);
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, [campaignId]);

  if (loading) return <div style={{ padding: 20 }}>Loading campaign…</div>;
  if (!campaign) return <div style={{ padding: 20 }}>Campaign not found.</div>;

  // -------------------------
  // Calculations
  // -------------------------
  const totalRaised = donations.reduce(
    (s, d) => s + Number(d.amount || 0),
    0
  );

  const goal = Number(campaign.goalAmount || 0);

  const percent = goal > 0 ? Math.min(100, (totalRaised / goal) * 100) : 0;

  const recent = donations
    .sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds)
    .slice(0, 5);

  // Build leaderboard
  const athleteTotals = athletes.map((a) => {
    const sum = donations
      .filter((d) => d.athleteId === a.id)
      .reduce((s, d) => s + Number(d.amount || 0), 0);
    return { ...a, totalRaised: sum };
  });

  const topAthletes = athleteTotals
    .sort((a, b) => b.totalRaised - a.totalRaised)
    .slice(0, 5);

  return (
    <div style={{ padding: "20px" }}>
      {/* HEADER */}
      <div
        style={{
          background: "#fff",
          padding: "20px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          marginBottom: "20px",
          display: "flex",
          gap: "20px",
        }}
      >
        <img
          src={safeImageURL(campaign.imageURL)}
          alt="Campaign"
          style={{
            width: "180px",
            height: "120px",
            borderRadius: "8px",
            objectFit: "cover",
          }}
        />

        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>{campaign.name}</h2>
          <div style={{ color: "#666", marginBottom: "10px" }}>
            {campaign.teamName || "Team"}
          </div>

          {/* Progress */}
          <div
            style={{
              background: "#f0f0f0",
              borderRadius: "8px",
              height: "12px",
              overflow: "hidden",
              marginTop: "10px",
            }}
          >
            <div
              style={{
                width: `${percent}%`,
                background: "#4caf50",
                height: "100%",
              }}
            ></div>
          </div>

          <div style={{ marginTop: "8px", fontWeight: "bold" }}>
            {formatCurrency(totalRaised)} raised of {formatCurrency(goal)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {/* FIXED to match correct route: /campaigns/:id/donations */}
          <Link
            to={`/campaigns/${campaignId}/donations`}
            style={{
              padding: "8px 14px",
              background: "#1976d2",
              color: "#fff",
              borderRadius: "6px",
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            View Donation Table
          </Link>

          {/* FIXED to match correct route: /campaigns/:id/edit */}
          <Link
            to={`/campaigns/${campaignId}/edit`}
            style={{
              padding: "8px 14px",
              background: "#555",
              color: "#fff",
              borderRadius: "6px",
              textAlign: "center",
              textDecoration: "none",
            }}
          >
            Edit Campaign
          </Link>
        </div>
      </div>

      {/* METRICS */}
      <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
        <StatCard label="Total Raised" value={formatCurrency(totalRaised)} />
        <StatCard label="Goal" value={formatCurrency(goal)} />
        <StatCard label="Progress" value={`${percent.toFixed(1)}%`} />
        <StatCard label="Donations" value={donations.length} />
      </div>

      {/* LAYOUT */}
      <div style={{ display: "flex", gap: "20px" }}>
        {/* LEFT COLUMN */}
        <div
          style={{ flex: 2, display: "flex", flexDirection: "column", gap: "20px" }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #ddd",
              padding: "20px",
            }}
          >
            <h3>Recent Donations</h3>
            {recent.length === 0 ? (
              <div>No donations yet.</div>
            ) : (
              <ul style={{ paddingLeft: 20 }}>
                {recent.map((d) => (
                  <li key={d.id} style={{ marginBottom: "6px" }}>
                    <strong>{d.donorName || "Anonymous"}</strong>{" "}
                    donated {formatCurrency(d.amount)}{" "}
                    {d.athleteName ? `to ${d.athleteName}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #ddd",
              padding: "20px",
            }}
          >
            <h3>Engagement Overview</h3>
            <div style={{ color: "#666" }}>
              (Coming soon: link clicks, QR scans, athlete share stats…)
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              background: "#fff",
              borderRadius: "8px",
              border: "1px solid #ddd",
              padding: "20px",
            }}
          >
            <h3>Top Athletes</h3>
            {topAthletes.length === 0 && <div>No athletes assigned yet.</div>}
            {topAthletes.map((a, i) => (
              <div
                key={a.id}
                style={{
                  marginBottom: "10px",
                  paddingBottom: "10px",
                  borderBottom: "1px solid #eee",
                }}
              >
                <strong>
                  #{i + 1} {a.name || "Athlete"}
                </strong>
                <div>{formatCurrency(a.totalRaised)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div
      style={{
        flex: 1,
        padding: "20px",
        background: "#fff",
        border: "1px solid #ddd",
        borderRadius: "8px",
      }}
    >
      <div style={{ color: "#777", fontSize: "14px" }}>{label}</div>
      <div
        style={{
          fontWeight: "bold",
          fontSize: "24px",
          marginTop: "4px",
        }}
      >
        {value}
      </div>
    </div>
  );
}
