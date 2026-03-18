import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { auth, db } from "../firebase/config";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";

const AuthContext = createContext();
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeOrgId, setActiveOrgId] = useState(null);
  const [loading, setLoading] = useState(true);
  const isSuperAdmin = profile?.role === "super-admin";

  const login = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const loginWithEmail = async (email, password) => {
    return signInWithEmailAndPassword(auth, email, password);
  };

  const signupWithEmail = async (email, password) => {
    return createUserWithEmailAndPassword(auth, email, password);
  };

  const resetPassword = async (email) => {
    return sendPasswordResetEmail(auth, email);
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
    setProfile(null);
    setActiveOrgId(null);
  };

  const loadProfile = useCallback(
    async (uid, attempt = 0) => {
      try {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data() || {};
          let nextProfile = data;

          if (String(data?.role || "").toLowerCase() === "coach" && data?.orgId) {
            const explicitTeamIds = Array.isArray(data.teamIds)
              ? data.teamIds
              : Array.isArray(data.assignedTeamIds)
                ? data.assignedTeamIds
                : [];
            const singleTeamId = String(data.teamId || "").trim();

            let derivedTeamIds = [];
            try {
              const teamsSnap = await getDocs(
                query(
                  collection(db, "teams"),
                  where("orgId", "==", data.orgId),
                  where("coachId", "==", uid)
                )
              );
              derivedTeamIds = teamsSnap.docs.map((entry) => entry.id);
            } catch (deriveErr) {
              // Do not block login if coach team enrichment fails.
              console.warn(
                "Coach team enrichment skipped:",
                deriveErr?.message || deriveErr
              );
            }

            const mergedTeamIds = Array.from(
              new Set(
                [...explicitTeamIds, ...derivedTeamIds, singleTeamId]
                  .map((id) => String(id || "").trim())
                  .filter(Boolean)
              )
            );

            nextProfile = {
              ...data,
              teamIds: mergedTeamIds,
              assignedTeamIds: mergedTeamIds,
              teamId: data.teamId || mergedTeamIds[0] || "",
            };
          }

          const resolvedOrgId = String(nextProfile?.orgId || "").trim();
          const resolvedTeamId = String(nextProfile?.teamId || "").trim();
          const orgName = String(nextProfile?.orgName || "").trim();
          const teamName = String(nextProfile?.teamName || "").trim();

          nextProfile = {
            ...nextProfile,
            orgName: orgName || resolvedOrgId || "",
            teamName: teamName || resolvedTeamId || "",
          };

          setProfile(nextProfile);

          // Initialize activeOrgId once profile is loaded.
          if (!activeOrgId && nextProfile?.orgId) {
            setActiveOrgId(nextProfile.orgId);
          }

          return true;
        }

        // Retry up to ~3 seconds for invite flows.
        if (attempt < 6) {
          setTimeout(() => loadProfile(uid, attempt + 1), 500);
        }

        return false;
      } catch (err) {
        console.warn("Profile load delayed:", err.message);
        return false;
      }
    },
    [activeOrgId]
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setUser(firebaseUser);
      setLoading(true);

      await loadProfile(firebaseUser.uid);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [loadProfile]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        login,
        loginWithEmail,
        signupWithEmail,
        resetPassword,
        logout,
        reloadProfile: () => user && loadProfile(user.uid),
        activeOrgId,
        setActiveOrgId,
        isSuperAdmin,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
}
