import React, { createContext, useContext, useEffect, useState } from "react";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
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

async function fetchCoachCampaignsByTeamIds(orgId, teamIds) {
  const uniqueTeamIds = Array.from(
    new Set((teamIds || []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (!orgId || uniqueTeamIds.length === 0) return [];

  const queryJobs = uniqueTeamIds.flatMap((teamId) => [
    getDocs(
      query(
        collection(db, "campaigns"),
        where("orgId", "==", orgId),
        where("teamId", "==", teamId)
      )
    ).catch(() => null),
    getDocs(
      query(
        collection(db, "campaigns"),
        where("orgId", "==", orgId),
        where("teamIds", "array-contains", teamId)
      )
    ).catch(() => null),
  ]);

  const snaps = await Promise.all(queryJobs);

  const merged = new Map();
  snaps.forEach((snap) => {
    if (!snap) return;
    snap.docs.forEach((entry) => {
      merged.set(entry.id, { id: entry.id, ...entry.data() });
    });
  });

  return Array.from(merged.values());
}

export function CampaignProvider({ children }) {
  const { profile, isSuperAdmin, activeOrgId } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaignId, setActiveCampaignId] = useState(
    localStorage.getItem("activeCampaignId") || null
  );
  const [loading, setLoading] = useState(true);

  // Load campaigns for the user's org
  useEffect(() => {
    const resolvedOrgId = String(
      isSuperAdmin ? activeOrgId || "" : profile?.orgId || ""
    ).trim();
    if (!resolvedOrgId) {
      setCampaigns([]);
      setActiveCampaignId(null);
      localStorage.removeItem("activeCampaignId");
      setLoading(false);
      return undefined;
    }
    const coachTeamIds = getCoachScopedTeamIds(profile);
    const isCoach = String(profile?.role || "").toLowerCase() === "coach";
    const isAthlete = String(profile?.role || "").toLowerCase() === "athlete";

    if (isAthlete) {
      setCampaigns([]);
      setActiveCampaignId(null);
      localStorage.removeItem("activeCampaignId");
      setLoading(false);
      return undefined;
    }

    if (isCoach && coachTeamIds.length === 0) {
      setCampaigns([]);
      setActiveCampaignId(null);
      localStorage.removeItem("activeCampaignId");
      setLoading(false);
      return undefined;
    }

    if (isCoach) {
      let cancelled = false;

      (async () => {
        try {
          const scopedList = await fetchCoachCampaignsByTeamIds(
            resolvedOrgId,
            coachTeamIds
          );
          scopedList.sort((left, right) => {
            const leftTime =
              left.createdAt?.toDate?.()?.getTime?.() ||
              (left.createdAt?.seconds ? left.createdAt.seconds * 1000 : 0);
            const rightTime =
              right.createdAt?.toDate?.()?.getTime?.() ||
              (right.createdAt?.seconds ? right.createdAt.seconds * 1000 : 0);
            return rightTime - leftTime;
          });

          if (cancelled) return;
          setCampaigns(scopedList);

          const hasSelectedCampaign = scopedList.some((c) => c.id === activeCampaignId);
          if (!hasSelectedCampaign && scopedList.length > 0) {
            const newest = scopedList[0];
            setActiveCampaignId(newest.id);
            localStorage.setItem("activeCampaignId", newest.id);
          } else if (!hasSelectedCampaign && scopedList.length === 0) {
            setActiveCampaignId(null);
            localStorage.removeItem("activeCampaignId");
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }

    const q = query(
      collection(db, "campaigns"),
      where("orgId", "==", resolvedOrgId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      setCampaigns(list);

      // If no active campaign chosen, auto-select newest
      const hasSelectedCampaign = list.some((c) => c.id === activeCampaignId);
      if (!hasSelectedCampaign && list.length > 0) {
        const newest = list[0];
        setActiveCampaignId(newest.id);
        localStorage.setItem("activeCampaignId", newest.id);
      } else if (!hasSelectedCampaign && list.length === 0) {
        setActiveCampaignId(null);
        localStorage.removeItem("activeCampaignId");
      }

      setLoading(false);
    });

    return unsubscribe;
  }, [
    profile?.orgId,
    profile?.role,
    profile?.teamId,
    JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || []),
    activeCampaignId,
    isSuperAdmin,
    activeOrgId,
  ]);

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
