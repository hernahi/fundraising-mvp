import { db } from "./config";
import { doc, setDoc, updateDoc, deleteDoc, getDocs, collection } from "firebase/firestore";

export async function listUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addUser(uid, data) {
  return setDoc(doc(db, "users", uid), {
    ...data,
    createdAt: new Date(),
  });
}

export async function updateUser(uid, data) {
  return updateDoc(doc(db, "users", uid), data);
}

export async function removeUser(uid) {
  return deleteDoc(doc(db, "users", uid));
}
