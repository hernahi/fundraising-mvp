import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute() {
  const { user, loading, profile, logout } = useAuth();
  const location = useLocation();

  // Still resolving auth session
  if (loading) {
    return <div className="p-6 text-slate-600">Loading…</div>;
  }

  // Not signed in
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Signed in but no profile yet
  // Allow access to invite acceptance & login-related routes
if (!profile) {
  const path = location.pathname;

  if (
    path.startsWith("/accept-invite") ||
    path === "/login"
  ) {
    return <Outlet />;
  }

  return <div className="p-6 text-slate-600">Loading profile…</div>;
}

  const status = String(profile?.status || "active").toLowerCase();
  const isLocked = status === "inactive" || !!profile?.deletedAt;
  if (isLocked) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <h1 className="text-xl font-semibold text-slate-800">Account Access Disabled</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your account is currently inactive. Contact your administrator for access.
        </p>
        <button
          type="button"
          onClick={logout}
          className="mt-4 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return <Outlet />;
}
