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
const ACTIVE_ORG_STORAGE_KEY = "activeOrgId";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [activeOrgId, setActiveOrgId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [activeOrgName, setActiveOrgName] = useState("");
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
    setActiveOrgName("");
    try {
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup issues during logout.
    }
  };

  const loadProfile = useCallback(
    async (uid, attempt = 0) => {
      try {
        const ref = doc(db, "users", uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data() || {};
          const authDisplayName = String(auth.currentUser?.displayName || "").trim();
          const authEmail = String(auth.currentUser?.email || "").trim();
          const authPhotoURL = String(auth.currentUser?.photoURL || "").trim();
          let nextProfile = {
            ...data,
            displayName: String(
              data?.displayName || data?.name || authDisplayName || authEmail || ""
            ).trim(),
            name: String(
              data?.name || data?.displayName || authDisplayName || authEmail || ""
            ).trim(),
            email: String(data?.email || authEmail || "").trim(),
            photoURL: String(data?.photoURL || authPhotoURL || "").trim(),
          };

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

          if (String(data?.role || "").toLowerCase() === "athlete") {
            try {
              const athleteSnap = await getDoc(doc(db, "athletes", uid));
              if (athleteSnap.exists()) {
                const athleteData = athleteSnap.data() || {};
                const athleteDisplayName = String(
                  athleteData?.name ||
                    athleteData?.displayName ||
                    nextProfile?.displayName ||
                    nextProfile?.name ||
                    authDisplayName ||
                    authEmail ||
                    ""
                ).trim();
                const athleteTeamId = String(
                  nextProfile?.teamId || athleteData?.teamId || ""
                ).trim();
                let athleteTeamName = String(
                  nextProfile?.teamName || athleteData?.teamName || ""
                ).trim();

                if (athleteTeamId && !athleteTeamName) {
                  const teamSnap = await getDoc(doc(db, "teams", athleteTeamId));
                  if (teamSnap.exists()) {
                    athleteTeamName = String(
                      teamSnap.data()?.name || teamSnap.data()?.teamName || ""
                    ).trim();
                  }
                }

                nextProfile = {
                  ...nextProfile,
                  displayName: athleteDisplayName || nextProfile?.displayName || "",
                  name: athleteDisplayName || nextProfile?.name || "",
                  photoURL: String(
                    athleteData?.photoURL ||
                      athleteData?.avatar ||
                      nextProfile?.photoURL ||
                      authPhotoURL ||
                      ""
                  ).trim(),
                  teamId: athleteTeamId || nextProfile?.teamId || "",
                  teamName: athleteTeamName || nextProfile?.teamName || athleteTeamId || "",
                };
              }
            } catch (athleteErr) {
              console.warn(
                "Athlete team enrichment skipped:",
                athleteErr?.message || athleteErr
              );
            }
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

          const nextRole = String(nextProfile?.role || "").toLowerCase();
          if (nextRole !== "super-admin" && !activeOrgId && nextProfile?.orgId) {
            // Non-super-admin roles stay pinned to their org by default.
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

  useEffect(() => {
    let cancelled = false;

    async function resolveActiveOrgName() {
      if (!profile) {
        if (!cancelled) setActiveOrgName("");
        return;
      }

      const role = String(profile.role || "").toLowerCase();
      const targetOrgId =
        role === "super-admin"
          ? String(activeOrgId || "").trim()
          : String(profile.orgId || "").trim();

      if (!targetOrgId) {
        if (!cancelled) setActiveOrgName("");
        return;
      }

      if (role !== "super-admin" && String(profile.orgName || "").trim()) {
        if (!cancelled) setActiveOrgName(String(profile.orgName || "").trim());
        return;
      }

      try {
        const orgSnap = await getDoc(doc(db, "organizations", targetOrgId));
        const nextName = orgSnap.exists()
          ? String(orgSnap.data()?.name || targetOrgId).trim()
          : targetOrgId;
        if (!cancelled) setActiveOrgName(nextName);
      } catch (err) {
        console.warn("Active org name resolution skipped:", err?.message || err);
        if (!cancelled) setActiveOrgName(targetOrgId);
      }
    }

    resolveActiveOrgName();
    return () => {
      cancelled = true;
    };
  }, [profile, activeOrgId]);

  useEffect(() => {
    try {
      if (isSuperAdmin) {
        if (activeOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, activeOrgId);
        } else {
          localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
        }
        return;
      }
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    } catch {
      // Ignore storage sync issues so auth state still works.
    }
  }, [isSuperAdmin, activeOrgId]);

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
        activeOrgName,
        setActiveOrgId,
        isSuperAdmin,
      }}
    >
      {!loading && children}
    </AuthContext.Provider>
  );
}
