import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import safeImageURL from "../utils/safeImage.js";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";

/* =========================
   HELPERS
   ========================= */
const getInitials = (name, email) => {
  if (name) {
    const parts = name.trim().split(" ");
    return parts.length === 1
      ? parts[0][0].toUpperCase()
      : (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return email ? email[0][0].toUpperCase() : "?";
};

const getStatus = (u) => {
  if (u.deletedAt) return { label: "Deactivated", color: "gray" };
  if (u.status === "pending") return { label: "Pending", color: "amber" };
  return { label: "Active", color: "green" };
};

export default function AdminUsers() {
  const { user: currentUser, isSuperAdmin, activeOrgId } = useAuth();

  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDeactivated, setShowDeactivated] = useState(false);

  /* =========================
     USERS LISTENER
     ========================= */
  useEffect(() => {
    const baseRef = collection(db, "users");
    let q;

    if (isSuperAdmin && !activeOrgId) {
      q = query(baseRef, orderBy("createdAt", "desc"));
    } else if (activeOrgId) {
      q = query(
        baseRef,
        where("orgId", "==", activeOrgId),
        orderBy("createdAt", "desc")
      );
    } else {
      return;
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        setUsers(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        );
      },
      (err) => console.error("❌ Users listener error:", err)
    );

    return () => unsub();
  }, [isSuperAdmin, activeOrgId, currentUser?.uid]);

  /* =========================
     INVITES LISTENER
     ========================= */
  useEffect(() => {
    const baseRef = collection(db, "invites");
    let q;

    if (isSuperAdmin && !activeOrgId) {
      q = query(baseRef, orderBy("createdAt", "desc"));
    } else if (activeOrgId) {
      q = query(
        baseRef,
        where("orgId", "==", activeOrgId),
        orderBy("createdAt", "desc")
      );
    } else {
      return;
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        setInvites(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((i) => i.status === "pending")
        );
      },
      (err) => console.error("❌ Invites listener error:", err)
    );

    return () => unsub();
  }, [isSuperAdmin, activeOrgId]);

  /* =========================
     ACTIONS
     ========================= */
  const isSelf = (u) => currentUser?.uid === u.id;
  const isSuper = (u) => u.role === "super-admin";

  const handleRoleChange = async (userId, role) => {
    await updateDoc(doc(db, "users", userId), { role });
  };

  const handleDeactivateUser = async (userId) => {
    if (!confirm("Deactivate this user?")) return;
    await updateDoc(doc(db, "users", userId), {
      deletedAt: serverTimestamp(),
      deletedBy: currentUser.uid,
    });
  };

  const handleRevokeInvite = async (inviteId) => {
    if (!confirm("Revoke this invite?")) return;
    await deleteDoc(doc(db, "invites", inviteId));
  };

  /* =========================
     FILTERING
     ========================= */
  const filteredUsers = users.filter((u) => {
    if (!showDeactivated && u.deletedAt) return false;

  const status = u.status ?? "active";
    if (statusFilter === "pending") return status === "pending";
    if (statusFilter === "active") return status !== "pending";

  return true;
  });

  /* =========================
     RENDER
     ========================= */
  return (
    <div className="page-container">
      <h1 className="page-title">Users</h1>

      <div className="flex items-center gap-4 mb-4">
        <label className="text-sm font-medium">Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
        </select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showDeactivated}
            onChange={(e) => setShowDeactivated(e.target.checked)}
          />
          Show deactivated
        </label>
      </div>

      {filteredUsers.length === 0 ? (
        <div className="text-center py-10 text-gray-500">
          <p className="mb-2">No users found.</p>
          <Link to="/admin/invite" className="text-blue-600 underline">
            Invite your first coach or athlete
          </Link>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => {
              const status = getStatus(u);
              return (
                <tr key={u.id}>
                  <td className="flex items-center gap-2">
                    {safeImageURL(u.photoURL) ? (
                      <img
                        src={safeImageURL(u.photoURL)}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-slate-400 text-white flex items-center justify-center text-xs font-semibold">
                        {getInitials(u.displayName, u.email)}
                      </div>
                    )}
                    {u.displayName || "Unnamed"}
                  </td>
                  <td>{u.email}</td>
                  <td className="capitalize">{u.role}</td>
                  <td>{status.label}</td>
                  <td>
                    {!isSelf(u) && !isSuper(u) && !u.deletedAt && (
                      <button
                        onClick={() => handleDeactivateUser(u.id)}
                        className="text-xs text-red-600"
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {invites.length > 0 && (
        <div className="mt-10">
          <h2 className="page-subtitle">Pending Invites</h2>
          <table className="table">
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td>Pending</td>
                  <td>
                    <button
                      onClick={() => handleRevokeInvite(i.id)}
                      className="text-xs text-red-600"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
