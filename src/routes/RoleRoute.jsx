import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "../components/ListLoadingSpinner";

export default function RoleRoute({ children, allowed }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  const status = String(profile?.status || "active").toLowerCase();
  const isLocked = status === "inactive" || !!profile?.deletedAt;
  if (isLocked) return <Navigate to="/dashboard" replace />;

  return allowed.includes(profile?.role)
    ? children
    : <Navigate to="/dashboard" replace />;
}
