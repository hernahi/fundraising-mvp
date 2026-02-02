import { useEffect, useState } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

import { useAuth } from "../context/AuthContext";

export default function Users() {
  const { profile } = useAuth();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (!profile?.orgId) return;

    const fetchUsers = async () => {
      setLoading(true);
      setError("");

      try {
        const q = query(
          collection(db, "users"),
          where("orgId", "==", profile.orgId)
        );

        const snap = await getDocs(q);
        const docs = snap.docs || [];

        const rows = docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        setUsers(rows);
      } catch (err) {
        console.error("Failed to fetch users:", err);
        setError("Unable to load users.");
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [profile?.orgId]);

  // Frontend gate (rules will mirror later)
  if (profile?.role !== "admin") {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold text-slate-900">
          Access Denied
        </h1>
        <p className="text-sm text-slate-500 mt-2">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Users
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Users in your organization
          </p>
        </div>

        {/* Placeholder for C6.2 */}
        <button
          disabled
          className="text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
        >
          Invite User
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                Role
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-6 text-sm text-slate-500"
                >
                  Loading users…
                </td>
              </tr>
            )}

            {!loading && users.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-6 text-sm text-slate-500"
                >
                  No users found.
                </td>
              </tr>
            )}

            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 text-sm text-slate-900">
                  {u.name || "—"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {u.email || "—"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700 capitalize">
                  {u.role || "—"}
                </td>
              </tr>
            ))}

            {error && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-6 text-sm text-red-600"
                >
                  {error}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
