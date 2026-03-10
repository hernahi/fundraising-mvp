import React, { createContext, useContext, useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "./AuthContext";

const CampaignContext = createContext();

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

export function CampaignProvider({ children }) {
  const { profile } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaignId, setActiveCampaignId] = useState(
    localStorage.getItem("activeCampaignId") || null
  );
  const [loading, setLoading] = useState(true);

  // Load campaigns for the user's org
  useEffect(() => {
    if (!profile?.orgId) return;
    const coachTeamIds = getCoachScopedTeamIds(profile);
    const isCoach = String(profile?.role || "").toLowerCase() === "coach";

    const q = query(
      collection(db, "campaigns"),
      where("orgId", "==", profile.orgId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      const scopedList =
        isCoach && coachTeamIds.length > 0
          ? list.filter((c) => coachTeamIds.includes(String(c.teamId || "").trim()))
          : isCoach
            ? []
            : list;

      setCampaigns(scopedList);

      // If no active campaign chosen, auto-select newest
      const hasSelectedCampaign = scopedList.some((c) => c.id === activeCampaignId);
      if (!hasSelectedCampaign && scopedList.length > 0) {
        const newest = scopedList[0];
        setActiveCampaignId(newest.id);
        localStorage.setItem("activeCampaignId", newest.id);
      } else if (!hasSelectedCampaign && scopedList.length === 0) {
        setActiveCampaignId(null);
        localStorage.removeItem("activeCampaignId");
      }

      setLoading(false);
    });

    return unsubscribe;
  }, [profile?.orgId, profile?.role, profile?.teamId, JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || []), activeCampaignId]);

  // When the user manually selects a campaign
  const selectCampaign = (id) => {
    setActiveCampaignId(id);
    localStorage.setItem("activeCampaignId", id);
  };

  return (
    <CampaignContext.Provider
      value={{
        campaigns,
        activeCampaignId,
        selectCampaign,
        loading,
      }}
    >
      {children}
    </CampaignContext.Provider>
  );
}

export const useCampaign = () => useContext(CampaignContext);
