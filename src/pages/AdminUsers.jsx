import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import safeImageURL from "../utils/safeImage.js";
import { useAuth } from "../context/AuthContext";

const INVITE_ROLES = ["coach", "athlete", "admin"];
const INVITE_RESEND_COOLDOWN_MS = 60 * 1000;

function getInitials(name, email) {
  if (name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return parts[0]?.[0]?.toUpperCase() || "?";
  }
  return String(email || "?")[0]?.toUpperCase() || "?";
}

function getStatusBadge(user) {
  if (user?.deletedAt) return { label: "Deactivated", classes: "bg-slate-100 text-slate-700" };
  if (String(user?.status || "").toLowerCase() === "pending") {
    return { label: "Pending", classes: "bg-amber-100 text-amber-800" };
  }
  return { label: "Active", classes: "bg-emerald-100 text-emerald-800" };
}

function formatInviteTimestamp(value) {
  if (!value) return "-";
  try {
    const date =
      typeof value?.toDate === "function"
        ? value.toDate()
        : value instanceof Date
          ? value
          : null;
    if (!date) return "-";
    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
}

function canResendInvite(invite) {
  const lastResentAt = invite?.lastResentAt;
  if (!lastResentAt || typeof lastResentAt?.toMillis !== "function") return true;
  return Date.now() - lastResentAt.toMillis() >= INVITE_RESEND_COOLDOWN_MS;
}

export default function AdminUsers() {
  const { user: currentUser, profile, isSuperAdmin, activeOrgId } = useAuth();
  const role = String(profile?.role || "").toLowerCase();
  const isAdmin = role === "admin" || role === "super-admin";
  const scopedOrgId = String(activeOrgId || profile?.orgId || "").trim();

  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [teams, setTeams] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [search, setSearch] = useState("");

  const [inviteForm, setInviteForm] = useState({
    email: "",
    role: "coach",
    teamId: "",
  });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteStatus, setInviteStatus] = useState("");
  const [resendingInviteId, setResendingInviteId] = useState("");

  useEffect(() => {
    if (!isAdmin) return undefined;

    const baseRef = collection(db, "users");
    let qRef;
    if (isSuperAdmin && !scopedOrgId) {
      qRef = query(baseRef, orderBy("createdAt", "desc"));
    } else if (scopedOrgId) {
      qRef = query(baseRef, where("orgId", "==", scopedOrgId), orderBy("createdAt", "desc"));
    } else {
      return undefined;
    }

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => console.error("Users listener error:", err)
    );
    return () => unsub();
  }, [isAdmin, isSuperAdmin, scopedOrgId]);

  useEffect(() => {
    if (!isAdmin) return undefined;

    const baseRef = collection(db, "invites");
    let qRef;
    if (isSuperAdmin && !scopedOrgId) {
      qRef = query(baseRef, orderBy("createdAt", "desc"));
    } else if (scopedOrgId) {
      qRef = query(baseRef, where("orgId", "==", scopedOrgId), orderBy("createdAt", "desc"));
    } else {
      return undefined;
    }

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        setInvites(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((i) => String(i.status || "").toLowerCase() === "pending")
        );
      },
      (err) => console.error("Invites listener error:", err)
    );
    return () => unsub();
  }, [isAdmin, isSuperAdmin, scopedOrgId]);

  useEffect(() => {
    async function loadTeams() {
      if (!isAdmin || !scopedOrgId) return;
      try {
        const snap = await getDocs(
          query(collection(db, "teams"), where("orgId", "==", scopedOrgId))
        );
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() || {}) }))
          .sort((a, b) =>
            String(a.name || a.teamName || a.id).localeCompare(
              String(b.name || b.teamName || b.id)
            )
          );
        setTeams(rows);
      } catch (err) {
        console.error("Failed to load teams for invites:", err);
      }
    }
    loadTeams();
  }, [isAdmin, scopedOrgId]);

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((u) => {
      if (!showDeactivated && u.deletedAt) return false;
      const status = String(u.status || "active").toLowerCase();
      if (statusFilter === "pending" && status !== "pending") return false;
      if (statusFilter === "active" && status === "pending") return false;
      if (!needle) return true;
      const haystack = [
        u.displayName,
        u.name,
        u.email,
        u.role,
        u.orgId,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return haystack.includes(needle);
    });
  }, [users, showDeactivated, statusFilter, search]);

  if (!isAdmin) {
    return <div className="p-6 text-red-600">Access restricted.</div>;
  }

  async function handleInviteSubmit(e) {
    e.preventDefault();
    setInviteStatus("");
    setInviteLoading(true);
    try {
      if (!scopedOrgId) {
        throw new Error("Select an active organization before inviting users.");
      }
      const email = String(inviteForm.email || "").trim().toLowerCase();
      if (!email) {
        throw new Error("Email is required.");
      }
      if (!INVITE_ROLES.includes(inviteForm.role)) {
        throw new Error("Invalid role selected.");
      }

      const inviteRef = await addDoc(collection(db, "invites"), {
        email,
        role: inviteForm.role,
        orgId: scopedOrgId,
        teamId: inviteForm.teamId || null,
        status: "pending",
        invitedBy: currentUser?.uid || "",
        createdAt: serverTimestamp(),
      });

      const appUrl = window.location.origin;
      const sendInviteEmail = httpsCallable(functions, "sendInviteEmail");
      await sendInviteEmail({
        toEmail: email,
        inviteId: inviteRef.id,
        appUrl,
      });

      setInviteForm({ email: "", role: "coach", teamId: "" });
      setInviteStatus("Invite sent.");
    } catch (err) {
      console.error("Invite failed:", err);
      setInviteStatus("Failed to send invite.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRevokeInvite(inviteId) {
    if (!window.confirm("Revoke this invite?")) return;
    await deleteDoc(doc(db, "invites", inviteId));
  }

  async function handleResendInvite(invite) {
    const email = String(invite?.email || "").trim().toLowerCase();
    const inviteId = String(invite?.id || "").trim();
    if (!email || !inviteId) return;
    if (!canResendInvite(invite)) {
      setInviteStatus("Please wait one minute before resending this invite again.");
      return;
    }
    try {
      setResendingInviteId(inviteId);
      setInviteStatus("");
      const sendInviteEmail = httpsCallable(functions, "sendInviteEmail");
      await sendInviteEmail({
        toEmail: email,
        inviteId,
        appUrl: window.location.origin,
      });
      await updateDoc(doc(db, "invites", inviteId), {
        lastResentAt: serverTimestamp(),
        resendCount: Number(invite?.resendCount || 0) + 1,
        updatedAt: serverTimestamp(),
      });
      setInviteStatus(`Invite resent to ${email}.`);
    } catch (err) {
      console.error("Resend invite failed:", err);
      setInviteStatus("Failed to resend invite.");
    } finally {
      setResendingInviteId("");
    }
  }

  async function handleDeactivateUser(userId) {
    if (!window.confirm("Deactivate this user?")) return;
    await updateDoc(doc(db, "users", userId), {
      deletedAt: serverTimestamp(),
      deletedBy: currentUser?.uid || null,
    });
  }

  async function handleReactivateUser(userId) {
    await updateDoc(doc(db, "users", userId), {
      deletedAt: null,
      deletedBy: null,
      status: "active",
      updatedAt: serverTimestamp(),
    });
  }

  async function handleRoleChange(userId, nextRole) {
    await updateDoc(doc(db, "users", userId), {
      role: nextRole,
      updatedAt: serverTimestamp(),
    });
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Users</h1>
          <p className="text-sm text-slate-500">
            User management and invitations in one workspace.
          </p>
        </div>
        <span className="text-xs rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">
          Org: {scopedOrgId || "none selected"}
        </span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Invite User</h2>
          <p className="text-xs text-slate-500 mt-1">
            Creates a pending invite and sends an email invite link.
          </p>
        </div>
        <form
          onSubmit={handleInviteSubmit}
          className="grid grid-cols-1 gap-3 md:grid-cols-4"
        >
          <input
            type="email"
            required
            value={inviteForm.email}
            onChange={(e) =>
              setInviteForm((prev) => ({ ...prev, email: e.target.value }))
            }
            placeholder="email@example.com"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2"
          />
          <select
            value={inviteForm.role}
            onChange={(e) =>
              setInviteForm((prev) => ({ ...prev, role: e.target.value }))
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={inviteForm.teamId}
            onChange={(e) =>
              setInviteForm((prev) => ({ ...prev, teamId: e.target.value }))
            }
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">No team assignment</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name || team.teamName || team.id}
              </option>
            ))}
          </select>
          <div className="md:col-span-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">{inviteStatus}</p>
            <button
              type="submit"
              disabled={inviteLoading || !scopedOrgId}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {inviteLoading ? "Sending..." : "Send Invite"}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={showDeactivated}
              onChange={(e) => setShowDeactivated(e.target.checked)}
            />
            Show deactivated
          </label>
        </div>

        {filteredUsers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No users found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">User</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isSelf = currentUser?.uid === u.id;
                  const isSuperAdminUser = String(u.role || "") === "super-admin";
                  const badge = getStatusBadge(u);
                  const canEditRole = !isSelf && !isSuperAdminUser;
                  const canDeactivate = !isSelf && !isSuperAdminUser && !u.deletedAt;
                  const canReactivate = !isSelf && !isSuperAdminUser && !!u.deletedAt;
                  return (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          {safeImageURL(u.photoURL) ? (
                            <img
                              src={safeImageURL(u.photoURL)}
                              alt=""
                              className="h-8 w-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-400 text-xs font-semibold text-white">
                              {getInitials(u.displayName || u.name, u.email)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-800">
                              {u.displayName || u.name || "Unnamed"}
                            </p>
                            <p className="truncate text-xs text-slate-500">{u.email || "N/A"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        {canEditRole ? (
                          <select
                            value={String(u.role || "coach")}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                          >
                            <option value="coach">coach</option>
                            <option value="athlete">athlete</option>
                            <option value="admin">admin</option>
                          </select>
                        ) : (
                          <span className="capitalize text-slate-700">{String(u.role || "n/a")}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-1 text-xs ${badge.classes}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {canDeactivate ? (
                            <button
                              type="button"
                              onClick={() => handleDeactivateUser(u.id)}
                              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                            >
                              Deactivate
                            </button>
                          ) : null}
                          {canReactivate ? (
                            <button
                              type="button"
                              onClick={() => handleReactivateUser(u.id)}
                              className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
                            >
                              Reactivate
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {invites.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Pending Invites</h2>
          {inviteStatus ? (
            <p className="mb-3 text-xs text-slate-500">{inviteStatus}</p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
	              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Team</th>
                  <th className="py-2 pr-3">Resends</th>
                  <th className="py-2 pr-3">Last Resent</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{invite.email}</td>
                    <td className="py-2 pr-3 capitalize">{invite.role || "n/a"}</td>
                    <td className="py-2 pr-3">{invite.teamId || "-"}</td>
                    <td className="py-2 pr-3">{Number(invite.resendCount || 0)}</td>
                    <td className="py-2 pr-3">{formatInviteTimestamp(invite.lastResentAt)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {(() => {
                          const resendAllowed = canResendInvite(invite);
                          return (
                        <button
                          type="button"
                          disabled={resendingInviteId === invite.id || !resendAllowed}
                          onClick={() => handleResendInvite(invite)}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                          title={resendAllowed ? "Resend invite email" : "Wait one minute between resend attempts"}
                        >
                          {resendingInviteId === invite.id ? "Sending..." : "Resend"}
                        </button>
                          );
                        })()}
                        <button
                          type="button"
                          onClick={() => handleRevokeInvite(invite.id)}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                        >
                          Revoke
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
