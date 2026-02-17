import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import LoadingSpinner from "../components/ListLoadingSpinner";

export default function AdminRoute({ children }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <LoadingSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!["admin", "super-admin"].includes(profile?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
