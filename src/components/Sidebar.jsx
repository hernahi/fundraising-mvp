import { NavLink } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  HomeIcon,
  MegaphoneIcon,
  UserGroupIcon,
  UsersIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  ClipboardDocumentListIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "../context/AuthContext";
import { useCampaign } from "../context/CampaignContext";

const navItem =
  "flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium transition";
const navActive = "bg-blue-50 text-blue-700";
const navInactive = "text-gray-700 hover:bg-gray-100";

export default function Sidebar({ mobileOpen = false, onClose = () => {} }) {
  const { profile } = useAuth();
  const { campaigns, activeCampaignId } = useCampaign();

  const role = (profile?.role || "").toLowerCase();
  const activeCampaign = campaigns.find(
    (c) => c.id === activeCampaignId
  );

  const isAdmin = role === "admin" || role === "super-admin";
  const isCoach = role === "coach";
  const isAthlete = role === "athlete";
  const canManageOrg = isAdmin || isCoach;
  const [mainOpen, setMainOpen] = useState(true);
  const [orgOpen, setOrgOpen] = useState(true);

  const mainNavItems = useMemo(() => {
    const items = [
      {
        to: "/",
        label: "Dashboard",
        icon: HomeIcon,
        always: true,
      },
    ];

    if (canManageOrg) {
      items.push(
        { to: "/campaigns", label: "Campaigns", icon: MegaphoneIcon },
        { to: "/athletes", label: "Athletes", icon: UsersIcon }
      );
    }

    if (isAthlete && profile?.uid) {
      items.push(
        {
          to: `/athletes/${profile.uid}`,
          label: "My Athlete Page",
          icon: UsersIcon,
        },
        {
          to: "/messages",
          label: "Messages",
          icon: ChatBubbleLeftRightIcon,
        }
      );
    }

    return items;
  }, [canManageOrg, isAthlete, profile?.uid]);

  const orgNavItems = useMemo(() => {
    const items = [];

    if (canManageOrg) {
      items.push(
        { to: "/donors", label: "Donors", icon: UserGroupIcon },
        { to: "/coaches", label: "Coaches", icon: UserGroupIcon },
        { to: "/teams", label: "Teams", icon: ClipboardDocumentListIcon },
        { to: "/messages", label: "Messages", icon: ChatBubbleLeftRightIcon },
        { to: "/settings", label: "Settings", icon: Cog6ToothIcon }
      );
    }

    if (isCoach) {
      items.push({
        to: "/coach/invite",
        label: "Athlete Onboarding",
        icon: UserPlusIcon,
      });
    }

    return items;
  }, [canManageOrg, isCoach]);

  return (
    <aside
      className={[
        "fixed inset-y-0 left-0 z-40 w-64 border-r bg-white flex flex-col justify-between",
        "transform transition-transform duration-200 ease-in-out lg:static lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      {/* TOP */}
      <div>
        {/* Brand */}
        <div className="px-6 py-4 border-b">
          <div className="text-lg font-semibold">Fundraising MVP</div>
          <div className="text-xs text-gray-500">{profile?.orgId}</div>
        </div>

        {/* Navigation */}
        <nav className="mt-4 space-y-2 px-2 overflow-y-auto">
          <button
            type="button"
            onClick={() => setMainOpen((v) => !v)}
            className="w-full px-3 py-2 text-left text-xs font-semibold tracking-wide text-gray-500 rounded-md hover:bg-gray-100 lg:cursor-default lg:hover:bg-transparent"
          >
            MAIN {mainOpen ? "▲" : "▼"}
          </button>
          {(mainOpen || !mobileOpen) && (
            <div className="space-y-1">
              {mainNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `${navItem} ${isActive ? navActive : navInactive}`
                  }
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}

          {(canManageOrg || isCoach) && (
            <>
              <button
                type="button"
                onClick={() => setOrgOpen((v) => !v)}
                className="w-full px-3 py-2 text-left text-xs font-semibold tracking-wide text-gray-500 rounded-md hover:bg-gray-100 lg:cursor-default lg:hover:bg-transparent"
              >
                ORGANIZATION {orgOpen ? "▲" : "▼"}
              </button>
              {(orgOpen || !mobileOpen) && (
                <div className="space-y-1">
                  {orgNavItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        `${navItem} ${isActive ? navActive : navInactive}`
                      }
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </>
          )}
        </nav>

        {/* Active Campaign */}
        <div className="mt-6 px-6 py-4 border-t">
          <div className="text-xs font-semibold text-gray-500 mb-1">
            Active Campaign
          </div>
          {activeCampaign ? (
            <div className="text-sm font-medium text-gray-900">
              {activeCampaign.name}
            </div>
          ) : (
            <div className="text-sm text-gray-400">
              No active campaign selected
            </div>
          )}
        </div>
      </div>

      {/* ADMIN */}
      {isAdmin && !isAthlete && (
        <div className="border-t px-2 py-4">
          <div className="px-4 mb-2 text-xs font-semibold text-gray-500">
            ADMIN
          </div>

          <NavLink
            to="/admin/users"
            onClick={onClose}
            className={({ isActive }) =>
              `${navItem} ${isActive ? navActive : navInactive}`
            }
          >
            <UsersIcon className="h-5 w-5" />
            Users
          </NavLink>

          <NavLink
            to="/admin/invite"
            onClick={onClose}
            className={({ isActive }) =>
              `${navItem} ${isActive ? navActive : navInactive}`
            }
          >
            <UserPlusIcon className="h-5 w-5" />
            Invite User
          </NavLink>
        </div>
      )}
    </aside>
  );
}
