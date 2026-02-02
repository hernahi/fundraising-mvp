import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute() {
  const { user, loading, profile } = useAuth();
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

  return <Outlet />;
}
