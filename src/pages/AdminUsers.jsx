import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
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
const INVITE_EXPIRY_DAYS = 14;
const MANAGED_ACCOUNT_ROLES = ["coach", "athlete", "admin"];

function getCoachScopedTeamIds(profile) {
  if (!profile) return [];
  const role = String(profile.role || "").toLowerCase();
  if (role !== "coach") return [];
  const fromArray = Array.isArray(profile.teamIds)
    ? profile.teamIds
    : Array.isArray(profile.assignedTeamIds)
      ? profile.assignedTeamIds
      : [];
  const normalized = fromArray
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const single = String(profile.teamId || "").trim();
  if (single) normalized.push(single);
  return Array.from(new Set(normalized));
}

async function fetchTeamsByIds(ids) {
  const uniqueIds = Array.from(
    new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))
  );
  if (uniqueIds.length === 0) return [];

  const teamRows = await Promise.all(
    uniqueIds.map(async (teamId) => {
      try {
        const snap = await getDoc(doc(db, "teams", teamId));
        return snap.exists() ? { id: snap.id, ...(snap.data() || {}) } : null;
      } catch {
        return null;
      }
    })
  );

  return teamRows.filter(Boolean);
}

function generateTemporaryPassword(length = 14) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

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

function isInviteExpired(invite) {
  const expiresAt = invite?.expiresAt;
  if (!expiresAt || typeof expiresAt?.toMillis !== "function") return false;
  return expiresAt.toMillis() <= Date.now();
}

function getInviteLifecycle(invite) {
  const raw = String(invite?.status || "").toLowerCase();
  if (raw === "accepted") return "accepted";
  if (raw === "revoked") return "revoked";
  if (raw === "expired") return "expired";
  if (raw === "pending" && isInviteExpired(invite)) return "expired";
  return "pending";
}

function getInviteLifecycleBadge(invite) {
  const lifecycle = getInviteLifecycle(invite);
  if (lifecycle === "accepted") {
    return { label: "Accepted", classes: "bg-emerald-100 text-emerald-800" };
  }
  if (lifecycle === "revoked") {
    return { label: "Revoked", classes: "bg-rose-100 text-rose-800" };
  }
  if (lifecycle === "expired") {
    return { label: "Expired", classes: "bg-amber-100 text-amber-800" };
  }
  return { label: "Pending", classes: "bg-blue-100 text-blue-800" };
}

function canResendInvite(invite) {
  if (getInviteLifecycle(invite) !== "pending") return false;
  const lastResentAt = invite?.lastResentAt;
  if (!lastResentAt || typeof lastResentAt?.toMillis !== "function") return true;
  return Date.now() - lastResentAt.toMillis() >= INVITE_RESEND_COOLDOWN_MS;
}

export default function AdminUsers() {
  const { user: currentUser, profile, isSuperAdmin, activeOrgId, activeOrgName } = useAuth();
  const role = String(profile?.role || "").toLowerCase();
  const isManager = role === "admin" || role === "super-admin" || role === "coach";
  const isAdmin = role === "admin" || role === "super-admin";
  const isCoach = role === "coach";
  const scopedOrgId = String(
    isSuperAdmin ? activeOrgId || "" : activeOrgId || profile?.orgId || ""
  ).trim();
  const coachTeamIds = useMemo(
    () => getCoachScopedTeamIds(profile),
    [profile?.role, profile?.teamId, JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || [])]
  );
  const orgDisplayLabel = isSuperAdmin
    ? activeOrgName || scopedOrgId || "none selected"
    : profile?.orgName || scopedOrgId || "none selected";

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
    directAccess: false,
    setTeamCoach: true,
    targetUid: "",
  });
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteStatus, setInviteStatus] = useState("");
  const [resendingInviteId, setResendingInviteId] = useState("");
  const [cleaningInviteId, setCleaningInviteId] = useState("");
  const [createForm, setCreateForm] = useState({
    email: "",
    displayName: "",
    role: role === "coach" ? "athlete" : "coach",
    teamId: "",
    password: generateTemporaryPassword(),
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createStatus, setCreateStatus] = useState("");

  useEffect(() => {
    if (!isManager) return undefined;

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
  }, [isManager, isSuperAdmin, scopedOrgId]);

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
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
      },
      (err) => console.error("Invites listener error:", err)
    );
    return () => unsub();
  }, [isAdmin, isSuperAdmin, scopedOrgId]);

  useEffect(() => {
    async function loadTeams() {
      if (!isManager || !scopedOrgId) return;
      try {
        let rows = [];
        if (isCoach) {
          if (coachTeamIds.length === 0) {
            setTeams([]);
            return;
          }
          rows = (await fetchTeamsByIds(coachTeamIds)).filter(
            (team) => String(team?.orgId || "").trim() === scopedOrgId
          );
        } else {
          const snap = await getDocs(
            query(collection(db, "teams"), where("orgId", "==", scopedOrgId))
          );
          rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
        }
        rows = rows.sort((a, b) =>
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
  }, [isManager, isCoach, scopedOrgId, JSON.stringify(coachTeamIds)]);

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

  const teamNameById = useMemo(() => {
    const map = new Map();
    for (const team of teams) {
      const id = String(team?.id || "").trim();
      if (!id) continue;
      map.set(id, String(team.name || team.teamName || team.id || id));
    }
    return map;
  }, [teams]);

  const resolveTeamName = (teamId) => {
    const normalizedId = String(teamId || "").trim();
    if (!normalizedId) return "";
    return teamNameById.get(normalizedId) || normalizedId;
  };

  const getUserTeamLabel = (userRow) => {
    const singleTeamId = String(userRow?.teamId || "").trim();
    if (singleTeamId) {
      return teamNameById.get(singleTeamId) || singleTeamId;
    }
    const multiTeamIds = Array.isArray(userRow?.teamIds)
      ? userRow.teamIds
      : Array.isArray(userRow?.assignedTeamIds)
        ? userRow.assignedTeamIds
        : [];
    const labels = multiTeamIds
      .map((id) => String(id || "").trim())
      .filter(Boolean)
      .map((id) => teamNameById.get(id) || id);
    if (!labels.length) return "-";
    return labels.join(", ");
  };

  if (!isManager) {
    return <div className="p-6 text-red-600">Access restricted.</div>;
  }

  const availableManagedRoles = role === "coach"
    ? MANAGED_ACCOUNT_ROLES.filter((r) => r !== "admin")
    : MANAGED_ACCOUNT_ROLES;
  const availableRowRoles = isSuperAdmin
    ? [...MANAGED_ACCOUNT_ROLES, "super-admin"]
    : MANAGED_ACCOUNT_ROLES;

  async function handleInviteSubmit(e) {
    e.preventDefault();
    setInviteStatus("");
    setInviteLoading(true);
    try {
      if (!scopedOrgId) {
        throw new Error("Select an active organization before inviting users.");
      }
      const email = String(inviteForm.email || "").trim().toLowerCase();
      const normalizedTeamId =
        String(inviteForm.teamId || "").trim() === "unassigned-team"
          ? ""
          : String(inviteForm.teamId || "").trim();
      if (!email) {
        throw new Error("Email is required.");
      }
      if (!INVITE_ROLES.includes(inviteForm.role)) {
        throw new Error("Invalid role selected.");
      }

      if (inviteForm.directAccess) {
        const grantExistingUserAccess = httpsCallable(
          functions,
          "grantExistingUserAccess"
        );
        const result = await grantExistingUserAccess({
          email,
          targetUid: String(inviteForm.targetUid || "").trim() || null,
          role: inviteForm.role,
          orgId: scopedOrgId,
          teamId: normalizedTeamId || null,
          setTeamCoach:
            inviteForm.role === "coach" &&
            Boolean(normalizedTeamId) &&
            Boolean(inviteForm.setTeamCoach),
        });
        const grantedUid = String(result?.data?.uid || "").trim();
        setInviteForm({
          email: "",
          role: "coach",
          teamId: "",
          directAccess: false,
          setTeamCoach: true,
          targetUid: "",
        });
        setInviteStatus(
          grantedUid
            ? `Direct access granted (${grantedUid}).`
            : "Direct access granted."
        );
        return;
      }

      const inviteRef = await addDoc(collection(db, "invites"), {
        email,
        role: inviteForm.role,
        orgId: scopedOrgId,
        orgName: String(profile?.orgName || scopedOrgId || "").trim(),
        teamId: normalizedTeamId || null,
        teamName: normalizedTeamId ? resolveTeamName(normalizedTeamId) : "",
        status: "pending",
        expiresAt: Timestamp.fromDate(
          new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
        ),
        invitedBy: currentUser?.uid || "",
        createdAt: serverTimestamp(),
      });

      const appUrl = window.location.origin;
      const sendInviteEmail = httpsCallable(functions, "sendInviteEmail");
      await sendInviteEmail({
        toEmail: email,
        inviteId: inviteRef.id,
        appUrl,
        mode: "initial",
      });

      setInviteForm({
        email: "",
        role: "coach",
        teamId: "",
        directAccess: false,
        setTeamCoach: true,
        targetUid: "",
      });
      setInviteStatus("Invite sent.");
    } catch (err) {
      console.error("Invite failed:", err);
      setInviteStatus(
        String(err?.message || "").trim() || "Failed to send invite."
      );
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleCreateManagedAccount(e) {
    e.preventDefault();
    setCreateStatus("");
    setCreateLoading(true);
    try {
      if (!scopedOrgId) {
        throw new Error("Select an active organization before creating accounts.");
      }
      const email = String(createForm.email || "").trim().toLowerCase();
      const normalizedTeamId =
        String(createForm.teamId || "").trim() === "unassigned-team"
          ? ""
          : String(createForm.teamId || "").trim();
      const managedRole = String(createForm.role || "").trim().toLowerCase();
      const password = String(createForm.password || "");
      if (!email) throw new Error("Email is required.");
      if (!availableManagedRoles.includes(managedRole)) {
        throw new Error("Role is not allowed for your account.");
      }
      if (password.length < 10) {
        throw new Error("Temporary password must be at least 10 characters.");
      }

      const createManagedUserAccount = httpsCallable(functions, "createManagedUserAccount");
      const res = await createManagedUserAccount({
        email,
        displayName: String(createForm.displayName || "").trim(),
        role: managedRole,
        orgId: scopedOrgId,
        teamId: normalizedTeamId || null,
        password,
      });
      const createdUid = String(res?.data?.uid || "").trim();
      setCreateStatus(
        createdUid
          ? `Account created (${createdUid}). Share temporary password securely.`
          : "Account created. Share temporary password securely."
      );
      setCreateForm({
        email: "",
        displayName: "",
        role: role === "coach" ? "athlete" : "coach",
        teamId: "",
        password: generateTemporaryPassword(),
      });
    } catch (err) {
      console.error("Create managed account failed:", err);
      setCreateStatus(
        String(err?.message || "").trim() || "Failed to create account."
      );
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleRevokeInvite(inviteId) {
    if (!window.confirm("Revoke this invite?")) return;
    try {
      const revokeInvite = httpsCallable(functions, "revokeInvite");
      await revokeInvite({ inviteId });
      setInviteStatus("Invite revoked.");
    } catch (err) {
      console.error("Revoke invite failed:", err);
      setInviteStatus("Failed to revoke invite.");
    }
  }

  async function handleCleanupInvite(invite) {
    const inviteId = String(invite?.id || "").trim();
    if (!inviteId) return;
    if (!window.confirm("Delete this revoked invite record permanently?")) return;
    try {
      setCleaningInviteId(inviteId);
      setInviteStatus("");
      const cleanupInvite = httpsCallable(functions, "cleanupInvite");
      await cleanupInvite({ inviteId });
      setInviteStatus("Revoked invite cleaned up.");
    } catch (err) {
      console.error("Cleanup invite failed:", err);
      setInviteStatus("Failed to clean up invite.");
    } finally {
      setCleaningInviteId("");
    }
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
        mode: "resend",
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

  async function handleSetSuperAdmin(targetUser, enabled) {
    const targetId = String(targetUser?.id || "").trim();
    if (!isSuperAdmin || !targetId || targetId === currentUser?.uid) return;
    const prompt = enabled
      ? `Grant super-admin access to ${targetUser?.email || targetUser?.displayName || targetId}?`
      : `Remove super-admin access from ${targetUser?.email || targetUser?.displayName || targetId} and return them to admin?`;
    if (!window.confirm(prompt)) return;
    await updateDoc(doc(db, "users", targetId), {
      role: enabled ? "super-admin" : "admin",
      status: "active",
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
          Org: {orgDisplayLabel}
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
          <label className="md:col-span-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(inviteForm.directAccess)}
              onChange={(e) =>
                setInviteForm((prev) => ({
                  ...prev,
                  directAccess: e.target.checked,
                }))
              }
            />
            Grant direct access now (skip invite onboarding) for existing auth account.
          </label>
          {inviteForm.directAccess &&
          inviteForm.role === "coach" &&
          inviteForm.teamId ? (
            <label className="md:col-span-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={Boolean(inviteForm.setTeamCoach)}
                onChange={(e) =>
                  setInviteForm((prev) => ({
                    ...prev,
                    setTeamCoach: e.target.checked,
                  }))
                }
              />
              Set this coach as primary coach for selected team.
            </label>
          ) : null}
          {inviteForm.directAccess ? (
            <input
              type="text"
              value={inviteForm.targetUid}
              onChange={(e) =>
                setInviteForm((prev) => ({
                  ...prev,
                  targetUid: e.target.value,
                }))
              }
              placeholder="Auth UID override (optional, for account mismatch debugging)"
              className="md:col-span-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700"
            />
          ) : null}
          <div className="md:col-span-4 flex items-center justify-between">
            <p className="text-xs text-slate-500">{inviteStatus}</p>
            <button
              type="submit"
              disabled={inviteLoading || !scopedOrgId}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {inviteLoading
                ? inviteForm.directAccess
                  ? "Granting..."
                  : "Sending..."
                : inviteForm.directAccess
                  ? "Grant Access"
                  : "Send Invite"}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Create Account</h2>
          <p className="text-xs text-slate-500 mt-1">
            Creates a login account immediately without invite flow. Invite functionality remains unchanged.
          </p>
        </div>
        <form
          onSubmit={handleCreateManagedAccount}
          className="grid grid-cols-1 gap-3 md:grid-cols-5"
        >
          <input
            type="email"
            required
            value={createForm.email}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="newuser@email.com"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2"
          />
          <input
            type="text"
            value={createForm.displayName}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, displayName: e.target.value }))}
            placeholder="Display name (optional)"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          />
          <select
            value={createForm.role}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, role: e.target.value }))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            {availableManagedRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={createForm.teamId}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, teamId: e.target.value }))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">No team assignment</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name || team.teamName || team.id}
              </option>
            ))}
          </select>
          <input
            type="text"
            required
            value={createForm.password}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-3"
          />
          <button
            type="button"
            onClick={() =>
              setCreateForm((prev) => ({ ...prev, password: generateTemporaryPassword() }))
            }
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
          >
            Regenerate Password
          </button>
          <div className="md:col-span-5 flex items-center justify-between">
            <p className="text-xs text-slate-500">{createStatus}</p>
            <button
              type="submit"
              disabled={createLoading || !scopedOrgId}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {createLoading ? "Creating..." : "Create Account"}
            </button>
          </div>
        </form>
      </div>

      {isSuperAdmin ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm space-y-2">
          <h2 className="text-sm font-semibold text-blue-900">Super Admin Access</h2>
          <p className="text-xs text-blue-800">
            Use the Users table below to grant or revoke platform-wide access. This is intentionally limited to existing super-admins.
          </p>
          <p className="text-xs text-blue-700">
            Revoking super-admin returns the user to <span className="font-semibold">admin</span> so they do not lose app access unexpectedly.
          </p>
        </div>
      ) : null}

      {isAdmin ? (
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
                  <th className="py-2 pr-3">Team</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isSelf = currentUser?.uid === u.id;
                  const isSuperAdminUser = String(u.role || "") === "super-admin";
                  const badge = getStatusBadge(u);
                  const canEditRole =
                    !isSelf && (isSuperAdmin ? true : !isSuperAdminUser);
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
                            {availableRowRoles.map((rowRole) => (
                              <option key={rowRole} value={rowRole}>
                                {rowRole}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="capitalize text-slate-700">{String(u.role || "n/a")}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 max-w-[220px]">
                        <span className="line-clamp-2 text-slate-700" title={getUserTeamLabel(u)}>
                          {getUserTeamLabel(u)}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-1 text-xs ${badge.classes}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {isSuperAdmin && !isSelf && !isSuperAdminUser ? (
                            <button
                              type="button"
                              onClick={() => handleSetSuperAdmin(u, true)}
                              className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700"
                            >
                              Make Super Admin
                            </button>
                          ) : null}
                          {isSuperAdmin && !isSelf && isSuperAdminUser ? (
                            <button
                              type="button"
                              onClick={() => handleSetSuperAdmin(u, false)}
                              className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700"
                            >
                              Remove Super Admin
                            </button>
                          ) : null}
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
      ) : null}

      {isAdmin && invites.length > 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Invites</h2>
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
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Expires</th>
                  <th className="py-2 pr-3">Resends</th>
                  <th className="py-2 pr-3">Last Resent</th>
                  <th className="py-2 pr-3">Last Delivery</th>
                  <th className="py-2 pr-3">Error</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">{invite.email}</td>
                    <td className="py-2 pr-3 capitalize">{invite.role || "n/a"}</td>
                    <td className="py-2 pr-3">
                      {(() => {
                        const teamId = String(invite.teamId || "").trim();
                        if (!teamId) return "unassigned-team";
                        return teamNameById.get(teamId) || teamId;
                      })()}
                    </td>
                    <td className="py-2 pr-3">
                      {(() => {
                        const badge = getInviteLifecycleBadge(invite);
                        return (
                          <span className={`rounded-full px-2 py-1 text-xs ${badge.classes}`}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-2 pr-3">{formatInviteTimestamp(invite.expiresAt)}</td>
                    <td className="py-2 pr-3">{Number(invite.resendCount || 0)}</td>
                    <td className="py-2 pr-3">{formatInviteTimestamp(invite.lastResentAt)}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-col">
                        <span className="capitalize text-slate-700">
                          {String(invite.lastDeliveryStatus || "unknown").replace(/_/g, " ")}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatInviteTimestamp(invite.lastDeliveryAt)}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 max-w-[260px]">
                      {invite.lastDeliveryError ? (
                        <span className="line-clamp-2 text-xs text-rose-700" title={String(invite.lastDeliveryError)}>
                          {String(invite.lastDeliveryError)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {(() => {
                          const lifecycle = getInviteLifecycle(invite);
                          const resendAllowed = canResendInvite(invite);
                          return (
                        <button
                          type="button"
                          disabled={resendingInviteId === invite.id || !resendAllowed}
                          onClick={() => handleResendInvite(invite)}
                          className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                          title={
                            resendAllowed
                              ? "Resend invite email"
                              : lifecycle !== "pending"
                                ? "Only pending, unexpired invites can be resent"
                                : "Wait one minute between resend attempts"
                          }
                        >
                          {resendingInviteId === invite.id ? "Sending..." : "Resend"}
                        </button>
                          );
                        })()}
                        {getInviteLifecycle(invite) === "pending" ? (
                          <button
                            type="button"
                            onClick={() => handleRevokeInvite(invite.id)}
                            className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
                          >
                            Revoke
                          </button>
                        ) : null}
                        {getInviteLifecycle(invite) === "revoked" ? (
                          <button
                            type="button"
                            onClick={() => handleCleanupInvite(invite)}
                            disabled={cleaningInviteId === invite.id}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-60"
                          >
                            {cleaningInviteId === invite.id ? "Cleaning..." : "Cleanup"}
                          </button>
                        ) : null}
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
