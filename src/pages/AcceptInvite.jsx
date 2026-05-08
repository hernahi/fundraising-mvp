import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

function normalizeFullName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isUsablePersonName(value, email = "") {
  const name = normalizeFullName(value);
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (name.length < 2) return false;
  if (normalizedEmail && name.toLowerCase() === normalizedEmail) return false;
  if (normalizedEmail && name.toLowerCase() === normalizedEmail.split("@")[0]) return false;
  return /[a-zA-Z]/.test(name);
}

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login, reloadProfile, logout } = useAuth();

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [athleteFullName, setAthleteFullName] = useState("");

  const acceptingRef = useRef(false);
  const inviteId = params.get("invite");
  const returnToLogin = `/login?redirectTo=${encodeURIComponent(
    `${location.pathname}${location.search}`
  )}`;

  const isExpired = (inviteRecord) => {
    if (!inviteRecord?.expiresAt) return false;
    const expires =
      inviteRecord.expiresAt?.toDate?.() ?? new Date(inviteRecord.expiresAt);
    return expires.getTime() < Date.now();
  };

  useEffect(() => {
    const loadInvite = async () => {
      if (!inviteId) {
        setError("Invalid invite link.");
        setLoading(false);
        return;
      }

      try {
        const ref = doc(db, "invites", inviteId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setError("This invite does not exist.");
          setLoading(false);
          return;
        }

        const data = snap.data();

        if (data.status === "pending" && isExpired(data)) {
          try {
            await updateDoc(ref, {
              status: "expired",
              updatedAt: serverTimestamp(),
            });
          } catch (e) {
            console.warn("Failed to mark invite expired:", e);
          }

          setError("This invite has expired. Please request a new one.");
          setLoading(false);
          return;
        }

        if (data.status !== "pending") {
          setError("This invite has already been used or is no longer valid.");
          setLoading(false);
          return;
        }

        setInvite({ id: snap.id, ...data });
        setLoading(false);
      } catch (err) {
        console.error("Failed to load invite:", err);
        setError("Failed to load invite.");
        setLoading(false);
      }
    };

    loadInvite();
  }, [inviteId]);

  useEffect(() => {
    if (String(invite?.role || "").toLowerCase() !== "athlete") return;
    if (athleteFullName) return;
    if (isUsablePersonName(user?.displayName, user?.email)) {
      setAthleteFullName(normalizeFullName(user.displayName));
    }
  }, [invite?.role, athleteFullName, user?.displayName, user?.email]);

  const acceptInvite = async () => {
    if (acceptingRef.current) return;
    acceptingRef.current = true;

    try {
      if (!user) {
        setError("You must be signed in to accept this invite.");
        acceptingRef.current = false;
        return;
      }

      if (!invite) {
        setError("Invalid invite.");
        acceptingRef.current = false;
        return;
      }

      if (invite.status !== "pending" || isExpired(invite)) {
        setError("This invite is no longer valid.");
        acceptingRef.current = false;
        return;
      }

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      const existingUser = userSnap.exists() ? userSnap.data() || {} : {};
      const existingOrgId = String(existingUser.orgId || "").trim();
      const inviteOrgId = String(invite.orgId || "").trim();
      const inviteTeamId = String(invite.teamId || "").trim();
      const inviteRole = String(invite.role || "").trim().toLowerCase();
      const normalizedAthleteFullName = normalizeFullName(athleteFullName);
      if (inviteRole === "athlete" && !isUsablePersonName(normalizedAthleteFullName, user.email)) {
        setError("Enter the athlete's full name before accepting the invite.");
        acceptingRef.current = false;
        return;
      }
      const resolvedDisplayName =
        inviteRole === "athlete"
          ? normalizedAthleteFullName
          : normalizeFullName(
              user.displayName ||
                existingUser.displayName ||
                existingUser.name ||
                user.email ||
                ""
            );
      const inviteTeamIds = Array.isArray(invite.teamIds)
        ? invite.teamIds
        : inviteTeamId
          ? [inviteTeamId]
          : [];
      const existingTeamIds = Array.isArray(existingUser.teamIds)
        ? existingUser.teamIds
        : Array.isArray(existingUser.assignedTeamIds)
          ? existingUser.assignedTeamIds
          : [];
      const mergedTeamIds = Array.from(
        new Set(
          [...existingTeamIds, ...inviteTeamIds, inviteTeamId]
            .map((id) => String(id || "").trim())
            .filter(Boolean)
        )
      );

      if (existingOrgId && existingOrgId !== inviteOrgId) {
        setError(
          "This account is already assigned to another organization. Sign in with the invited account or contact an administrator."
        );
        acceptingRef.current = false;
        return;
      }

      const accessPayload = {
        uid: user.uid,
        email: user.email,
        displayName: resolvedDisplayName,
        name: resolvedDisplayName,
        photoURL: user.photoURL || existingUser.photoURL || null,
        role: inviteRole,
        orgId: inviteOrgId,
        orgName: String(invite.orgName || existingUser.orgName || inviteOrgId || "").trim(),
        teamId: inviteTeamId || existingUser.teamId || null,
        teamName: String(invite.teamName || existingUser.teamName || inviteTeamId || "").trim(),
        teamIds: inviteRole === "coach" ? mergedTeamIds : [],
        assignedTeamIds: inviteRole === "coach" ? mergedTeamIds : [],
        inviteId: invite.id,
        status: "active",
        updatedAt: serverTimestamp(),
      };

      if (
        inviteRole === "athlete" &&
        normalizedAthleteFullName &&
        normalizeFullName(user.displayName) !== normalizedAthleteFullName
      ) {
        try {
          await updateProfile(user, { displayName: normalizedAthleteFullName });
        } catch (profileErr) {
          console.warn("Auth display name update skipped:", profileErr?.message || profileErr);
        }
      }

      if (!userSnap.exists()) {
        await setDoc(
          userRef,
          {
            ...accessPayload,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await setDoc(
          userRef,
          accessPayload,
          { merge: true }
        );
      }

      if (inviteRole === "athlete") {
        const athleteRef = doc(db, "athletes", user.uid);
        const athleteSnap = await getDoc(athleteRef);
        let inviteCampaignName = "";
        const inviteCampaignId = String(invite.campaignId || "").trim();
        if (inviteCampaignId) {
          try {
            const campaignSnap = await getDoc(doc(db, "campaigns", inviteCampaignId));
            if (campaignSnap.exists()) {
              inviteCampaignName = String(
                campaignSnap.data()?.name || campaignSnap.data()?.title || inviteCampaignId
              ).trim();
            }
          } catch (campaignErr) {
            console.warn("Invite campaign name resolution skipped:", campaignErr?.message || campaignErr);
          }
        }

        const athletePayload = {
          userId: user.uid,
          email: user.email,
          name: normalizedAthleteFullName,
          displayName: normalizedAthleteFullName,
          orgId: inviteOrgId,
          orgName: String(invite.orgName || existingUser.orgName || inviteOrgId || "").trim(),
          inviteId: invite.id,
          status: "active",
          updatedAt: serverTimestamp(),
        };

        if (inviteTeamId) {
          athletePayload.teamId = inviteTeamId;
          athletePayload.teamName = String(invite.teamName || inviteTeamId).trim();
        }

        if (inviteCampaignId) {
          athletePayload.campaignId = inviteCampaignId;
          athletePayload.campaignName = inviteCampaignName || inviteCampaignId;
        }

        if (!athleteSnap.exists()) {
          athletePayload.createdAt = serverTimestamp();
          if (!inviteTeamId) athletePayload.teamId = null;
          if (!inviteCampaignId) athletePayload.campaignId = null;
        }

        await setDoc(athleteRef, athletePayload, { merge: true });
      }

      try {
        await updateDoc(doc(db, "invites", invite.id), {
          status: "accepted",
          acceptedAt: serverTimestamp(),
          acceptedByUid: user.uid,
        });

        if (inviteRole === "coach") {
          const coachRef = doc(db, "coaches", user.uid);
          const coachDisplayName = String(
            user.displayName ||
              existingUser.displayName ||
              existingUser.name ||
              user.email ||
              "Coach"
          ).trim();
          await setDoc(
            coachRef,
            {
              uid: user.uid,
              userId: user.uid,
              orgId: inviteOrgId,
              role: "coach",
              name: coachDisplayName,
              email: user.email || existingUser.email || "",
              teamId: inviteTeamId || null,
              team: String(invite.teamName || inviteTeamId || "").trim(),
              teamName: String(invite.teamName || inviteTeamId || "").trim(),
              teamIds: mergedTeamIds,
              assignedTeamIds: mergedTeamIds,
              status: "active",
              inviteId: invite.id,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );

          if (inviteTeamId) {
            await updateDoc(doc(db, "teams", inviteTeamId), {
              coachId: user.uid,
              coachName: coachDisplayName,
              coachRole: "coach",
              updatedAt: serverTimestamp(),
            });
          }
        }
      } catch (e) {
        console.warn("Invite update failed (non-fatal):", e);
      }

      try {
        await reloadProfile();
      } catch (e) {
        console.warn("Profile reload failed (non-fatal):", e);
      }

      setError("");
      setAccepted(true);

      const redirectTo =
        inviteRole === "coach" && inviteTeamId
          ? `/teams/${inviteTeamId}`
          : inviteRole === "athlete" && inviteTeamId
          ? `/teams/${inviteTeamId}`
          : "/";

      setTimeout(() => {
        navigate(redirectTo, { replace: true });
      }, 0);
    } catch (err) {
      console.error("Invite acceptance failed:", err);
      setError("Failed to accept invite.");
      acceptingRef.current = false;
    }
  };

  if (loading) {
    return <div className="p-6">Loading invite...</div>;
  }

  if (accepted) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold">Invitation Accepted</h1>
          <p className="text-slate-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-md">
          <h1 className="text-xl font-semibold">Invite Error</h1>
          <p className="text-slate-600">{error}</p>
          <button
            onClick={() => navigate("/", { replace: true })}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const signedInEmail = String(user?.email || "").toLowerCase();
  const invitedEmail = String(invite?.email || "").toLowerCase();
  const emailMismatch = Boolean(user && invitedEmail && signedInEmail && invitedEmail !== signedInEmail);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Accept Invitation</h1>
            <p className="mt-2 text-sm text-slate-600">
              Sign in or create a local account, then return here to complete setup.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-2">
            <div><span className="font-semibold">Invited email:</span> {invite?.email || "Unknown"}</div>
            <div><span className="font-semibold">Role:</span> {invite?.role || "Unknown"}</div>
            <div><span className="font-semibold">Organization:</span> {invite?.orgId || "Unknown"}</div>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
            If you do not want to use Google, choose Create Account on the login page and use the invited email address.
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              to={returnToLogin}
              className="px-4 py-3 rounded-lg bg-slate-900 text-white text-center font-medium"
            >
              Continue to Login
            </Link>
            <button
              onClick={login}
              className="px-4 py-3 rounded-lg bg-blue-600 text-white font-medium"
            >
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Accept Invitation</h1>
          <p className="mt-2 text-sm text-slate-600">
            Review the invite details below, then continue.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-2">
          <div><span className="font-semibold">Signed in as:</span> {user.email || "Unknown"}</div>
          <div><span className="font-semibold">Invited email:</span> {invite?.email || "Unknown"}</div>
          <div><span className="font-semibold">Role:</span> {invite?.role || "Unknown"}</div>
          <div><span className="font-semibold">Organization:</span> {invite?.orgId || "Unknown"}</div>
        </div>

        {String(invite?.role || "").toLowerCase() === "athlete" ? (
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">
              Athlete Full Name
            </label>
            <input
              type="text"
              value={athleteFullName}
              onChange={(e) => setAthleteFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
              placeholder="Enter athlete full name"
              autoComplete="name"
            />
            <p className="mt-1 text-xs text-slate-500">
              This is the name shown on the athlete profile and fundraising pages. Do not use an email address.
            </p>
          </div>
        ) : null}

        {emailMismatch ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-3">
            <p>
              You are signed in with a different email than the invited address.
              To avoid account confusion, sign out and use the invited email if possible.
            </p>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900"
            >
              Sign Out
            </button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          onClick={acceptInvite}
          className="px-6 py-3 rounded-lg bg-slate-900 text-white font-medium"
        >
          Accept & Continue
        </button>
      </div>
    </div>
  );
}
