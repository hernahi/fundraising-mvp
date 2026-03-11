import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase/config";

export default function Login() {
  const {
    login,
    loginWithEmail,
    signupWithEmail,
    resetPassword,
    logout,
    reloadProfile,
    user,
    loading,
    profile,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo =
    searchParams.get("redirectTo") ||
    `${location.state?.from?.pathname || ""}${location.state?.from?.search || ""}`;

  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bootstrapSubmitting, setBootstrapSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showBootstrap, setShowBootstrap] = useState(false);
  const [bootstrapForm, setBootstrapForm] = useState({
    orgName: "",
    teamName: "",
    campaignName: "",
    campaignGoal: "",
  });
  const [bootstrapResult, setBootstrapResult] = useState(null);

  useEffect(() => {
    if (!loading && user && !profile && redirectTo?.startsWith("/accept-invite")) {
      navigate(redirectTo, { replace: true });
      return;
    }

    if (!loading && user && profile) {
      if (redirectTo && redirectTo !== "/login") {
        navigate(redirectTo, { replace: true });
        return;
      }
      const role = (profile?.role || "").toLowerCase();
      if (role === "athlete" && profile?.uid) {
        navigate(`/athletes/${profile.uid}`, { replace: true });
        return;
      }
      navigate("/", { replace: true });
    }
  }, [user, loading, profile, navigate, redirectTo]);

  const clearStatus = () => {
    setMessage("");
    setError("");
  };

  const handleGoogleLogin = async () => {
    clearStatus();
    try {
      await login();
    } catch (err) {
      console.error("Login failed:", err);
      setError("Google Sign-In failed. Please try again.");
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    clearStatus();

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signupWithEmail(email.trim(), password);
        setMessage(
          "Local account created. If you have an invite link, open it now to finish access setup."
        );
      } else {
        await loginWithEmail(email.trim(), password);
      }
    } catch (err) {
      console.error("Email auth failed:", err);
      if (err?.code === "auth/email-already-in-use") {
        setError("That email is already in use.");
      } else if (
        err?.code === "auth/invalid-credential" ||
        err?.code === "auth/wrong-password" ||
        err?.code === "auth/user-not-found"
      ) {
        setError("Invalid email or password.");
      } else if (err?.code === "auth/invalid-email") {
        setError("Invalid email address.");
      } else {
        setError(err?.message || "Authentication failed.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async () => {
    clearStatus();
    if (!email.trim()) {
      setError("Enter your email first, then click reset password.");
      return;
    }

    try {
      await resetPassword(email.trim());
      setMessage("Password reset email sent.");
    } catch (err) {
      console.error("Password reset failed:", err);
      setError(err?.message || "Failed to send password reset email.");
    }
  };

  const handleBootstrapWorkspace = async () => {
    clearStatus();
    const orgName = String(bootstrapForm.orgName || "").trim();
    const teamName = String(bootstrapForm.teamName || "").trim();
    const campaignName = String(bootstrapForm.campaignName || "").trim();
    const campaignGoal = Number(bootstrapForm.campaignGoal || 0);

    if (!orgName || !teamName) {
      setError("Organization name and team name are required.");
      return;
    }

    setBootstrapSubmitting(true);
    try {
      const bootstrapSoloWorkspace = httpsCallable(functions, "bootstrapSoloWorkspace");
      const result = await bootstrapSoloWorkspace({
        orgName,
        teamName,
        campaignName,
        campaignGoal: Number.isFinite(campaignGoal) ? campaignGoal : 0,
      });
      const data = result?.data || {};
      setBootstrapResult({
        orgId: String(data.orgId || ""),
        teamId: String(data.teamId || ""),
        campaignId: String(data.campaignId || ""),
      });

      // Pull fresh users/{uid} profile created by bootstrap callable.
      await reloadProfile?.();
      setMessage("Workspace created successfully.");
    } catch (err) {
      console.error("Bootstrap workspace failed:", err);
      setError(
        err?.message || "Failed to start your workspace. Please try again."
      );
    } finally {
      setBootstrapSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  const hasAccountWithoutProfile = Boolean(user && !profile);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white shadow-xl rounded-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-4">
          Welcome to Fundraising MVP
        </h1>
        <p className="text-center text-gray-600 mb-8">
          Sign in with Google or use a local email/password account.
        </p>
        {redirectTo?.startsWith("/accept-invite") ? (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-800">
            After signing in, you will return to your invite automatically.
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 mb-6">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              clearStatus();
            }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              mode === "signin"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              clearStatus();
            }}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              mode === "signup"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="you@example.com"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Enter password"
              disabled={submitting}
            />
          </div>

          {mode === "signup" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Confirm password"
                disabled={submitting}
              />
            </div>
          )}

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {message ? <p className="text-sm text-green-600">{message}</p> : null}

          {hasAccountWithoutProfile && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              Your authentication account exists, but app access is not assigned yet.
              {redirectTo?.startsWith("/accept-invite")
                ? " You will be returned to your invite automatically."
                : " Use your invite link or contact your administrator."}
              <div className="mt-2 text-xs text-amber-900">
                Auth UID: <span className="font-mono">{user?.uid || "unknown"}</span>
                <br />
                Auth Email: <span className="font-mono">{user?.email || "unknown"}</span>
              </div>
              {!redirectTo?.startsWith("/accept-invite") ? (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowBootstrap((prev) => !prev)}
                    className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50"
                  >
                    {showBootstrap ? "Hide Setup" : "Start My Own Team"}
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {hasAccountWithoutProfile && showBootstrap && !redirectTo?.startsWith("/accept-invite") ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="mb-2 text-xs text-slate-600">
                Solo workspace setup: this creates your organization, first team, and optional starter campaign.
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={bootstrapForm.orgName}
                  onChange={(e) =>
                    setBootstrapForm((prev) => ({ ...prev, orgName: e.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  placeholder="Organization name"
                  disabled={bootstrapSubmitting}
                />
                <input
                  type="text"
                  value={bootstrapForm.teamName}
                  onChange={(e) =>
                    setBootstrapForm((prev) => ({ ...prev, teamName: e.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  placeholder="Team name"
                  disabled={bootstrapSubmitting}
                />
                <input
                  type="text"
                  value={bootstrapForm.campaignName}
                  onChange={(e) =>
                    setBootstrapForm((prev) => ({ ...prev, campaignName: e.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  placeholder="Starter campaign name (optional)"
                  disabled={bootstrapSubmitting}
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={bootstrapForm.campaignGoal}
                  onChange={(e) =>
                    setBootstrapForm((prev) => ({ ...prev, campaignGoal: e.target.value }))
                  }
                  className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
                  placeholder="Campaign goal (optional)"
                  disabled={bootstrapSubmitting}
                />
                <button
                  type="button"
                  onClick={handleBootstrapWorkspace}
                  disabled={bootstrapSubmitting}
                  className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {bootstrapSubmitting ? "Creating..." : "Create Workspace"}
                </button>
              </div>
              {bootstrapResult?.orgId ? (
                <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs text-emerald-900">
                  <div className="mb-2 font-semibold">Setup Complete</div>
                  <div className="space-y-2">
                    <IdRow label="Org ID" value={bootstrapResult.orgId} />
                    <IdRow label="Team ID" value={bootstrapResult.teamId} />
                    <IdRow
                      label="Campaign ID"
                      value={bootstrapResult.campaignId || "none (not created)"}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate("/", { replace: true })}
                    className="mt-3 w-full rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                  >
                    Continue to Dashboard
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-slate-900 text-white py-3 rounded hover:bg-slate-800 transition disabled:opacity-60"
          >
            {submitting
              ? "Please wait..."
              : mode === "signup"
              ? "Create Local Account"
              : "Sign In with Email"}
          </button>
        </form>

        <div className="mt-3 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handlePasswordReset}
            className="text-slate-600 hover:text-slate-800 underline"
          >
            Reset Password
          </button>
          {hasAccountWithoutProfile ? (
            <button
              type="button"
              onClick={logout}
              className="text-slate-600 hover:text-slate-800 underline"
            >
              Sign Out
            </button>
          ) : null}
        </div>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs uppercase tracking-wide text-slate-400">or</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <button
          onClick={handleGoogleLogin}
          className="w-full bg-blue-600 text-white py-3 rounded hover:bg-blue-700 transition"
        >
          Sign in with Google
        </button>

        {redirectTo?.startsWith("/accept-invite") ? (
          <div className="mt-4 text-center">
            <Link
              to={redirectTo}
              className="text-sm text-slate-600 hover:text-slate-800 underline"
            >
              Back to Invite
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IdRow({ label, value }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value || ""));
    } catch (_) {
      // Ignore clipboard errors in unsupported contexts.
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-white px-2 py-1">
      <span className="text-emerald-800">{label}</span>
      <div className="flex items-center gap-2">
        <code className="max-w-[180px] truncate text-emerald-900">{value}</code>
        <button
          type="button"
          onClick={copy}
          className="rounded border border-emerald-300 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
