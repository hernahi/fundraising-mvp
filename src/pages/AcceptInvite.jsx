import { useEffect, useState, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, login, reloadProfile } = useAuth();

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  const acceptingRef = useRef(false);
  const inviteId = params.get("invite");
  const isExpired = (inviteRecord) => {
    if (!inviteRecord?.expiresAt) return false;
    const expires =
      inviteRecord.expiresAt?.toDate?.() ?? new Date(inviteRecord.expiresAt);
    return expires.getTime() < Date.now();
  };

  /* ===============================
     LOAD INVITE
     =============================== */

  useEffect(() => {
    const loadInvite = async () => {
      if (!inviteId) {
        setError("Invalid invite link.");
        setLoading(false);
        return;
      }

      if (!user) {
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

        // Expired (auto-mark if still pending)
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

        // Already used / revoked
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
  }, [inviteId, user]);

  /* ===============================
     ACCEPT INVITE
     =============================== */

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

      /* ===== STEP 1: CREATE / UPDATE USER ===== */

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(
          userRef,
          {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL || null,
            role: invite.role,
            orgId: invite.orgId,
            inviteId: invite.id,

            // Required for admin visibility
            status: "active",
            createdAt: serverTimestamp(),

            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await setDoc(
          userRef,
          {
            displayName: user.displayName,
            photoURL: user.photoURL || null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      /* ===== STEP 1.5: CREATE ATHLETE PROFILE (IF ATHLETE) ===== */

      if (invite.role === "athlete") {
        const athleteRef = doc(db, "athletes", user.uid);
        const athleteSnap = await getDoc(athleteRef);

        if (!athleteSnap.exists()) {
          await setDoc(
            athleteRef,
            {
              userId: user.uid,
              email: user.email,
              displayName: user.displayName || user.email,
              orgId: invite.orgId,
              teamId: invite.teamId || null,
              campaignId: invite.campaignId || null,

              // Required for invite-based create
              inviteId: invite.id,

              status: "active",
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      /* ===== STEP 2: MARK INVITE ACCEPTED ===== */

      try {
        await updateDoc(doc(db, "invites", invite.id), {
          status: "accepted",
          acceptedAt: serverTimestamp(),
          acceptedByUid: user.uid,
        });

        // Create coach record on invite accept
        if (invite.role === "coach") {
          const coachRef = doc(db, "coaches", user.uid);

          await setDoc(
            coachRef,
            {
              uid: user.uid,
              userId: user.uid,
              orgId: invite.orgId,
              role: "coach",
              createdAt: serverTimestamp(),
            },
            { merge: true }
          );
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

      /* ===== STEP 3: ATHLETE AUTO-JOIN (OPTIONAL) ===== */

      const redirectTo =
        invite.role === "coach" && invite.teamId
          ? `/teams/${invite.teamId}`
          : invite.role === "athlete" && invite.teamId
          ? `/teams/${invite.teamId}`
          : "/dashboard";

      // Defer navigation to avoid throwing inside async flow
      setTimeout(() => {
        navigate(redirectTo, { replace: true });
      }, 0);

      return;
    } catch (err) {
      console.error("Invite acceptance failed:", err);
      setError("Failed to accept invite.");
      acceptingRef.current = false;
    }
  };

  /* ===============================
     RENDER STATES
     =============================== */

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

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center space-y-4">
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

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <button
          onClick={login}
          className="px-6 py-3 rounded-lg bg-slate-900 text-white font-medium"
        >
          Sign in to accept invite
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <button
        onClick={acceptInvite}
        className="px-6 py-3 rounded-lg bg-slate-900 text-white font-medium"
      >
        Accept & Continue
      </button>
    </div>
  );
}
