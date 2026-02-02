import { useAuth } from "../context/AuthContext";
import { useCampaign } from "../context/CampaignContext";
import safeImage from "../utils/safeImage";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { useEffect, useState } from "react";

export default function Topbar() {
  const {
  user,
  profile,
  logout,
  isSuperAdmin,
  activeOrgId,
  setActiveOrgId,
} = useAuth();

  const {
    campaigns = [],
    activeCampaignId,
    selectCampaign,
    loading,
  } = useCampaign();

  const [orgs, setOrgs] = useState([]);
  const role = (profile?.role || "").toLowerCase();
  const isAthlete = role === "athlete";

useEffect(() => {
  if (!isSuperAdmin) return;

  const loadOrgs = async () => {
    const snap = await getDocs(collection(db, "organizations"));
    setOrgs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  loadOrgs();
}, [isSuperAdmin]);

  const avatarSrc = safeImage(
    profile?.photoURL ||
    user?.photoURL ||
    ""
  );

  return (
    <header className="h-16 w-full border-b bg-white flex items-center">
      {/* CONTENT WRAPPER — flush with sidebar */}
      <div className="flex w-full items-center justify-between px-6">
        
        {/* LEFT */}
        <div className="flex items-center gap-4">
          {isSuperAdmin && !isAthlete && (
  <select
    value={activeOrgId || ""}
    onChange={(e) =>
      setActiveOrgId(e.target.value || null)
    }
    className="text-sm border rounded-md px-2 py-1 bg-white"
  >
    <option value="">All Organizations</option>
    {orgs.map((org) => (
      <option key={org.id} value={org.id}>
        {org.name}
      </option>
    ))}
  </select>
)}
          <div className="font-semibold text-lg">
            Fundraising MVP
          </div>

          {/* Active Campaign Selector */}
          {!isAthlete && !loading && campaigns.length > 0 && (
            <select
              value={activeCampaignId || ""}
              onChange={(e) => selectCampaign(e.target.value)}
              className="border rounded-md px-3 py-1 text-sm bg-white"
            >
              <option value="">Select campaign…</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* RIGHT */}
        <div className="flex items-center gap-4">
          {/* User */}
          <div className="flex items-center gap-3">
            <img
              src={avatarSrc}
              alt="User avatar"
              className="w-8 h-8 rounded-full object-cover bg-gray-200"
            />

            <div className="leading-tight text-right">
              <div className="text-sm font-medium">
                {profile?.name || user?.displayName || "User"}
              </div>
              <div className="text-xs text-gray-500">
                Role: {profile?.role || "user"}
              </div>
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={logout}
            className="border rounded-md px-3 py-1 text-sm hover:bg-gray-100"
          >
            Logout
          </button>
        </div>

      </div>
    </header>
  );
}
