// src/pages/Campaigns.jsx
import React, { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import safeImageURL from "../utils/safeImage";
import { Link } from "react-router-dom";

export default function Campaigns() {
  const { user, profile, loading } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  const orgId = profile?.orgId || null;

  // ───────────────────────────────────────────────
  // Fetch campaigns
  // ───────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      if (!user || !orgId) return;

      try {
        setLoadingCampaigns(true);

    let campaignsQuery;

    if (profile.role === "coach") {
      // 1️⃣ Load teams coached by this user
      const teamsQ = query(
        collection(db, "teams"),
        where("orgId", "==", orgId),
        where("coachId", "==", profile.uid)
      );

      const teamsSnap = await getDocs(teamsQ);
      const coachTeamIds = teamsSnap.docs.map((d) => d.id);

      // Coach has no teams → no campaigns
      if (coachTeamIds.length === 0) {
        setCampaigns([]);
        return;
      }

      // 2️⃣ Load campaigns that include any of those teams
      campaignsQuery = query(
        collection(db, "campaigns"),
        where("teamIds", "array-contains-any", coachTeamIds.slice(0, 10))
      );
    } else {
      // Admin / Super Admin
      campaignsQuery = query(
        collection(db, "campaigns"),
        where("orgId", "==", orgId)
      );
    }

    const snap = await getDocs(campaignsQuery);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    setCampaigns(list);

      } catch (err) {
        console.error("Error loading campaigns:", err);
      } finally {
        setLoadingCampaigns(false);
      }
    }

    load();
  }, [user, orgId]);

  // ───────────────────────────────────────────────
  // Loading screen
  // ───────────────────────────────────────────────
  if (loading || loadingCampaigns) {
    return (
      <div style={{ padding: "20px", fontSize: "18px" }}>
        Loading campaigns...
      </div>
    );
  }

  // ───────────────────────────────────────────────
  // Empty screen
  // ───────────────────────────────────────────────
  if (campaigns.length === 0) {
    return (
      <div style={{ padding: "20px" }}>
        <h2>Campaigns</h2>
        <p>No campaigns found for this organization.</p>
      </div>
    );
  }

  // ───────────────────────────────────────────────
  // Display campaigns
  // ───────────────────────────────────────────────
  return (
    <div style={{ padding: "20px" }}>
      <h2 style={{ marginBottom: "20px" }}>Campaigns</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "20px",
        }}
      >
        {campaigns.map((c) => {
          const image = safeImageURL(c.image);

          return (
            <div
              key={c.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: "6px",
                overflow: "hidden",
                background: "#fff",
              }}
            >
              {/* Campaign image */}
              {image ? (
                <img
                  src={image}
                  alt={c.name}
                  style={{
                    width: "100%",
                    height: "160px",
                    objectFit: "cover",
                    background: "#f1f1f1",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "160px",
                    background: "#e5e5e5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#777",
                  }}
                >
                  No Image
                </div>
              )}

              <div style={{ padding: "15px" }}>
                <h3 style={{ marginTop: 0 }}>{c.name || "Untitled Campaign"}</h3>

                <p style={{ margin: "8px 0", color: "#555" }}>
                  {c.description || "No description available."}
                </p>

                <div style={{ marginTop: "10px" }}>
                  <Link
                    to={`/campaigns/${c.id}`}
                    style={{
                      display: "inline-block",
                      padding: "8px 14px",
                      background: "#007bff",
                      color: "#fff",
                      textDecoration: "none",
                      borderRadius: "4px",
                      fontSize: "14px",
                    }}
                  >
                    View Details
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
