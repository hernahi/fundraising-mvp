import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";

export default function Login() {
  const { login, user, loading, profile } = useAuth();
  const navigate = useNavigate();

  // Redirect AFTER AuthContext finishes loading user profile
  useEffect(() => {
    if (!loading && user) {
      const role = (profile?.role || "").toLowerCase();
      if (role === "athlete" && profile?.uid) {
        navigate(`/athletes/${profile.uid}`, { replace: true });
        return;
      }
      navigate("/", { replace: true });
    }
  }, [user, loading, profile, navigate]);

  const handleLogin = async () => {
    try {
      await login();  // Popup returns immediately, AuthContext handles rest
    } catch (err) {
      console.error("Login failed:", err);
      alert("Google Sign-In failed. Please try again.");
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading…</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white shadow-xl rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-4">
          Welcome to Fundraising MVP
        </h1>
        <p className="text-center text-gray-600 mb-8">
          Sign in to access your organization dashboard.
        </p>

        <button
          onClick={handleLogin}
          className="w-full bg-blue-600 text-white py-3 rounded hover:bg-blue-700 transition"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
