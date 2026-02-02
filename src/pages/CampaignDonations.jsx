import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { db } from "../firebase/config";
import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";

export default function CampaignDonations() {
  const { campaignId } = useParams();

  const [donations, setDonations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [campaignName, setCampaignName] = useState("");

  useEffect(() => {
    async function loadDonations() {
      try {
        setLoading(true);

        // Query all donations for this campaign
        const donationsRef = collection(db, "donations");
        const q = query(donationsRef, where("campaignId", "==", campaignId));

        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Campaign name should be stored in each donation for efficiency
        if (list.length > 0) {
          setCampaignName(list[0].campaignName || "Campaign");
        }

        setDonations(list);
      } catch (error) {
        console.error("Error loading campaign donations:", error);
      } finally {
        setLoading(false);
      }
    }

    loadDonations();
  }, [campaignId]);

  if (loading) return <div style={{ padding: 20 }}>Loading donations…</div>;

  // Totals
  const total = donations.reduce(
    (sum, d) => sum + Number(d.amount || 0),
    0
  );
  const avg = donations.length > 0 ? total / donations.length : 0;

  return (
    <div style={{ padding: "20px" }}>
      {/* Header */}
      <h2 style={{ marginBottom: "10px" }}>
        Donations — {campaignName}
      </h2>

      {/* Stats Row */}
      <div
        style={{
          display: "flex",
          gap: "20px",
          marginBottom: "20px",
        }}
      >
        {/* Total Raised */}
        <div
          style={{
            flex: 1,
            background: "#fff",
            borderRadius: "8px",
            padding: "20px",
            border: "1px solid #ddd",
          }}
        >
          <h3 style={{ margin: 0 }}>Total Raised</h3>
          <div style={{ fontSize: "28px", fontWeight: "bold" }}>
            ${total.toLocaleString()}
          </div>
        </div>

        {/* Average Donation */}
        <div
          style={{
            flex: 1,
            background: "#fff",
            borderRadius: "8px",
            padding: "20px",
            border: "1px solid #ddd",
          }}
        >
          <h3 style={{ margin: 0 }}>Average Donation</h3>
          <div style={{ fontSize: "28px", fontWeight: "bold" }}>
            ${avg.toFixed(2)}
          </div>
        </div>

        {/* Count */}
        <div
          style={{
            flex: 1,
            background: "#fff",
            borderRadius: "8px",
            padding: "20px",
            border: "1px solid #ddd",
          }}
        >
          <h3 style={{ margin: 0 }}>Donation Count</h3>
          <div style={{ fontSize: "28px", fontWeight: "bold" }}>
            {donations.length}
          </div>
        </div>
      </div>

      {/* Donations Table */}
      <div
        style={{
          background: "#fff",
          padding: "20px",
          borderRadius: "8px",
          border: "1px solid #ddd",
        }}
      >
        <h3 style={{ marginBottom: "10px" }}>Donation History</h3>

        {donations.length === 0 ? (
          <div style={{ padding: "10px 0", color: "#666" }}>
            No donations yet.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "10px",
            }}
          >
            <thead>
              <tr style={{ background: "#f5f5f5", height: "40px" }}>
                <th align="left">Donor</th>
                <th align="left">Athlete</th>
                <th align="left">Amount</th>
                <th align="left">Date</th>
              </tr>
            </thead>

            <tbody>
              {donations.map((d) => (
                <tr
                  key={d.id}
                  style={{
                    borderBottom: "1px solid #eee",
                    height: "40px",
                  }}
                >
                  <td>{d.donorName || "Anonymous"}</td>
                  <td>{d.athleteName || "Athlete"}</td>
                  <td>${Number(d.amount).toLocaleString()}</td>
                  <td>
                    {d.createdAt?.seconds
                      ? new Date(d.createdAt.seconds * 1000).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
