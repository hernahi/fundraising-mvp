import { useEffect, useState } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { collection, getDocs } from "firebase/firestore";

import { useAuth } from "../context/AuthContext";
import { useCampaign } from "../context/CampaignContext";
import { db } from "../firebase/config";
import safeImage from "../utils/safeImage";

export default function Topbar({ onOpenMobileMenu = () => {} }) {
  const {
    user,
    profile,
    logout,
    isSuperAdmin,
    activeOrgId,
    setActiveOrgId,
  } = useAuth();

  const { campaigns = [], activeCampaignId, selectCampaign, loading } =
    useCampaign();

  const [orgs, setOrgs] = useState([]);
  const role = (profile?.role || "").toLowerCase();
  const isAthlete = role === "athlete";

  useEffect(() => {
    if (!isSuperAdmin) return;

    const loadOrgs = async () => {
      const snap = await getDocs(collection(db, "organizations"));
      setOrgs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    };

    loadOrgs();
  }, [isSuperAdmin]);

  const avatarSrc = safeImage(profile?.photoURL || user?.photoURL || "");

  return (
    <header className="h-16 w-full border-b bg-white flex items-center">
      <div className="flex w-full items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <button
            type="button"
            aria-label="Open navigation menu"
            onClick={onOpenMobileMenu}
            className="inline-flex items-center justify-center rounded-md border p-2 text-gray-700 hover:bg-gray-100 lg:hidden"
          >
            <Bars3Icon className="h-5 w-5" />
          </button>

          {isSuperAdmin && !isAthlete && (
            <select
              value={activeOrgId || ""}
              onChange={(e) => setActiveOrgId(e.target.value || null)}
              className="hidden md:block text-sm border rounded-md px-2 py-1 bg-white"
            >
              <option value="">All Organizations</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          )}

          <div className="font-semibold text-base sm:text-lg truncate">
            Fundraising MVP
          </div>

          {!isAthlete && !loading && campaigns.length > 0 && (
            <select
              value={activeCampaignId || ""}
              onChange={(e) => selectCampaign(e.target.value)}
              className="hidden lg:block border rounded-md px-3 py-1 text-sm bg-white max-w-[220px]"
            >
              <option value="">Select campaign...</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <img
              src={avatarSrc}
              alt="User avatar"
              className="w-8 h-8 rounded-full object-cover bg-gray-200"
            />

            <div className="leading-tight text-right hidden sm:block">
              <div className="text-sm font-medium truncate max-w-[180px]">
                {profile?.name || user?.displayName || "User"}
              </div>
              <div className="text-xs text-gray-500">
                Role: {profile?.role || "user"}
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            className="border rounded-md px-2 sm:px-3 py-1 text-xs sm:text-sm hover:bg-gray-100"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
