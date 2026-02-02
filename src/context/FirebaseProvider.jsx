import { createContext, useContext, useEffect, useState } from "react";
import { db } from "../firebase/config";
import { useAuth } from "./AuthContext";
import { collection, onSnapshot, query, where } from "firebase/firestore";

const FirebaseContext = createContext();
export const useFirebase = () => useContext(FirebaseContext);

export default function FirebaseProvider({ children }) {
  const { user, profile } = useAuth();

  const [campaigns, setCampaigns] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [donations, setDonations] = useState([]);
  const [users, setUsers] = useState([]);

  // campaigns
  useEffect(() => {
    if (!user || !profile?.orgId) return;
    const q = query(collection(db, "campaigns"), where("orgId", "==", profile.orgId));
    return onSnapshot(q, snap =>
      setCampaigns(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [user, profile]);

  // athletes
  useEffect(() => {
    if (!user || !profile?.orgId) return;
    const q = query(collection(db, "athletes"), where("orgId", "==", profile.orgId));
    return onSnapshot(q, snap =>
      setAthletes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [user, profile]);

  // donations
  useEffect(() => {
    if (!user || !profile?.orgId) return;
    const q = query(collection(db, "donations"), where("orgId", "==", profile.orgId));
    return onSnapshot(q, snap =>
      setDonations(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [user, profile]);

  // admin-only user list
  useEffect(() => {
    if (!user || profile?.role !== "admin") return;
    return onSnapshot(collection(db, "users"), snap =>
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
  }, [user, profile]);

  return (
    <FirebaseContext.Provider value={{ campaigns, athletes, donations, users }}>
      {children}
    </FirebaseContext.Provider>
  );
}
