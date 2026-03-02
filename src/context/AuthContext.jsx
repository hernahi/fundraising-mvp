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
import { doc, getDoc } from "firebase/firestore";

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

  const loadProfile = useCallback(async (uid, attempt = 0) => {
    try {
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);

      if (snap.exists()) {
  const data = snap.data();
  setProfile(data);

  // 🔑 Initialize activeOrgId once profile is loaded
  if (!activeOrgId && data?.orgId) {
    setActiveOrgId(data.orgId);
  }

  return true;
}

      // Retry up to ~3 seconds for invite flows
      if (attempt < 6) {
        setTimeout(() => loadProfile(uid, attempt + 1), 500);
      }

      return false;
    } catch (err) {
      console.warn("Profile load delayed:", err.message);
      return false;
    }
  }, 
  []);

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

    // ===== C11 additions =====
    activeOrgId,
    setActiveOrgId,
    isSuperAdmin,
  }}
>

      {!loading && children}
    </AuthContext.Provider>
  );
}
