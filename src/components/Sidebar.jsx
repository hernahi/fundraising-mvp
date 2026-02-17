import { NavLink } from "react-router-dom";
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
  const isAthlete = role === "athlete";

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
        <nav className="mt-4 space-y-1 px-2">
          <NavLink
            to="/"
            end
            onClick={onClose}
            className={({ isActive }) =>
              `${navItem} ${isActive ? navActive : navInactive}`
            }
          >
            <HomeIcon className="h-5 w-5" />
            Dashboard
          </NavLink>

          {!isAthlete && (
            <>
              <NavLink
                to="/campaigns"
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <MegaphoneIcon className="h-5 w-5" />
                Campaigns
              </NavLink>

              <NavLink
                to="/athletes"
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <UsersIcon className="h-5 w-5" />
                Athletes
              </NavLink>
            </>
          )}

          {isAthlete && profile?.uid && (
            <>
              <NavLink
                to={`/athletes/${profile.uid}`}
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <UsersIcon className="h-5 w-5" />
                My Athlete Page
              </NavLink>

              <NavLink
                to="/messages"
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                Messages
              </NavLink>
            </>
          )}

          {!isAthlete && (
            <>
              <NavLink
                to="/donors"
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <UserGroupIcon className="h-5 w-5" />
                Donors
              </NavLink>

              <NavLink
                to="/coaches"
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <UserGroupIcon className="h-5 w-5" />
                Coaches
              </NavLink>

              <NavLink
                to="/teams"
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <ClipboardDocumentListIcon className="h-5 w-5" />
                Teams
              </NavLink>

              <NavLink
                to="/messages"
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <ChatBubbleLeftRightIcon className="h-5 w-5" />
                Messages
              </NavLink>

              <NavLink
                to="/settings"
                onClick={onClose}
                className={({ isActive }) =>
                  `${navItem} ${isActive ? navActive : navInactive}`
                }
              >
                <Cog6ToothIcon className="h-5 w-5" />
                Settings
              </NavLink>
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

          {profile?.role === "coach" && (
  <NavLink
    to="/coach/invite"
    onClick={onClose}
    className={({ isActive }) =>
      `${navItem} ${isActive ? navActive : navInactive}`
    }
  >
    Invite Athletes
  </NavLink>
)}
        </div>
      )}
    </aside>
  );
}
