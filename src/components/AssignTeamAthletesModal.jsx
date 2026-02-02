// src/components/AssignTeamAthletesModal.jsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";

export default function AssignTeamAthletesModal({
  orgId,
  teamId,
  allowUnassign = true,
  onClose,
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [athletes, setAthletes] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const qA = query(collection(db, "athletes"), where("orgId", "==", orgId));
        const snap = await getDocs(qA);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        if (!cancelled) {
          setAthletes(rows);
          // preselect athletes that are already on this team
          const pre = new Set(rows.filter((a) => a.teamId === teamId).map((a) => a.id));
          setSelected(pre);
        }
      } catch (e) {
        console.error("Failed to load org athletes:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (orgId && teamId) load();
    else setLoading(false);

    return () => {
      cancelled = true;
    };
  }, [orgId, teamId]);

  const filtered = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return athletes;
    return athletes.filter((a) => (a.name || "").toLowerCase().includes(q));
  }, [athletes, search]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const batch = writeBatch(db);
      const now = serverTimestamp();

      // For all athletes in org:
      // - if checked => set teamId = teamId
      // - if unchecked and was previously on this team => set teamId = null (if allowUnassign)
      for (const a of athletes) {
        const wasOnThisTeam = a.teamId === teamId;
        const shouldBeOnThisTeam = selected.has(a.id);

        if (shouldBeOnThisTeam && a.teamId !== teamId) {
          batch.update(doc(db, "athletes", a.id), { teamId, updatedAt: now });
        }

        if (!shouldBeOnThisTeam && wasOnThisTeam) {
          if (allowUnassign) {
            batch.update(doc(db, "athletes", a.id), { teamId: null, updatedAt: now });
          } else {
            // no-op if you require all athletes to always be assigned
          }
        }
      }

      await batch.commit();
      onClose?.(true);
    } catch (e) {
      console.error("Failed to save team athlete assignments:", e);
      onClose?.(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-xl w-full max-w-lg shadow-lg">
        <h2 className="text-lg font-bold mb-2 text-slate-800">Manage Team Athletes</h2>
        <p className="text-sm text-slate-600 mb-3">
          Checked athletes will be assigned to this team. Unchecked athletes currently on this team will be{" "}
          {allowUnassign ? "unassigned" : "left unchanged"}.
        </p>

        <input
          placeholder="Search athletes..."
          className="w-full border rounded-lg px-3 py-2 mb-3"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {loading ? (
          <div className="text-center p-3">Loading...</div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-2">
            {filtered.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                <span className="flex-1">
                  {a.name || "Unnamed Athlete"}
                  <span className="text-slate-400"> — </span>
                  <span className="text-slate-500">
                    {a.teamId ? (a.teamId === teamId ? "On this team" : `On team ${a.teamId}`) : "Unassigned"}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={() => onClose?.(false)}
            className="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded bg-yellow-400 text-slate-900 font-semibold hover:brightness-110"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
