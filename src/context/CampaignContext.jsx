import React, { createContext, useContext, useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "./AuthContext";

const CampaignContext = createContext();

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

    const q = query(
      collection(db, "campaigns"),
      where("orgId", "==", profile.orgId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setCampaigns(list);

      // If no active campaign chosen, auto-select newest
      if (!activeCampaignId && list.length > 0) {
        const newest = list[0];
        setActiveCampaignId(newest.id);
        localStorage.setItem("activeCampaignId", newest.id);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, [profile?.orgId]);

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
