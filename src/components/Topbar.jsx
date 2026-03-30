import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { collection, getDocs } from "firebase/firestore";

import { useAuth } from "../context/AuthContext";
import { useCampaign } from "../context/CampaignContext";
import { db } from "../firebase/config";
import safeImage from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const role = (profile?.role || "").toLowerCase();
  const isAthlete = role === "athlete";
  const displayLabel =
    profile?.displayName ||
    profile?.name ||
    user?.displayName ||
    profile?.email ||
    user?.email ||
    "User";

  useEffect(() => {
    if (!isSuperAdmin) return;

    const loadOrgs = async () => {
      const snap = await getDocs(collection(db, "organizations"));
      setOrgs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    };

    loadOrgs();
  }, [isSuperAdmin, activeOrgId]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (!menuRef.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const avatarSrc = safeImage(
    profile?.photoURL || user?.photoURL || "",
    avatarFallback({
      label: displayLabel,
      type: "user",
      size: 96,
    })
  );

  const myAccountPath = useMemo(() => {
    if (isAthlete && profile?.uid) return `/athletes/${profile.uid}`;
    return "/settings";
  }, [isAthlete, profile?.uid]);

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

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="flex items-center gap-2 sm:gap-3 rounded-xl border border-slate-200 bg-white px-2 py-1.5 hover:bg-slate-50"
          >
            <img
              src={avatarSrc}
              alt="User avatar"
              className="w-8 h-8 rounded-full object-cover bg-gray-200"
            />

            <div className="leading-tight text-right hidden sm:block">
              <div className="text-sm font-medium truncate max-w-[180px]">
                {displayLabel}
              </div>
              <div className="text-xs text-gray-500">
                Role: {profile?.role || "user"}
              </div>
            </div>
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-52 rounded-xl border border-slate-200 bg-white shadow-lg z-50 overflow-hidden">
              <Link
                to={myAccountPath}
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                My Account
              </Link>
              <Link
                to="/settings"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                Settings
              </Link>
              <Link
                to="/help"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                Help Center
              </Link>
              <button
                type="button"
                onClick={async () => {
                  setMenuOpen(false);
                  await logout();
                }}
                className="block w-full text-left px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
