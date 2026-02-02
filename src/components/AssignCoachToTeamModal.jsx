// src/components/AssignCoachToTeamModal.jsx
import { useEffect, useMemo, useState } from "react";
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { useToast } from "./Toast";
import ListLoadingSpinner from "./ListLoadingSpinner";

export default function AssignCoachToTeamModal({ teamId, orgId, currentCoachId = null, onClose }) {
        let push = null;
      try {
        const toast = useToast?.();
        push = toast?.push || null;
      } catch {
        push = null;
      }

      const notify = (msg, type = "info") => {
        if (push) push(msg, type);
        else alert(msg);
      };

  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState([]);
  const [selectedCoach, setSelectedCoach] = useState(currentCoachId || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const ref = collection(db, "users");
        const q = query(ref, where("role", "==", "coach"), where("orgId", "==", orgId));
        const snap = await getDocs(q);

        if (!cancelled) {
          setCoaches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
      } catch (err) {
        console.error("Failed to load coaches:", err);
        notify("Failed to load coaches", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (orgId) load();
    else {
      setLoading(false);
      setCoaches([]);
    }

    return () => {
      cancelled = true;
    };
  }, [orgId, push]);

  const selectedLabel = useMemo(() => {
    const c = coaches.find((x) => x.id === selectedCoach);
    return c ? (c.displayName || c.email || c.id) : "";
  }, [coaches, selectedCoach]);

  const saveCoachId = async (coachIdOrNull) => {
    if (!teamId) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "teams", teamId), {
        coachId: coachIdOrNull,
        updatedAt: serverTimestamp(),
      });

      notify(coachIdOrNull ? `Coach assigned: ${selectedLabel || "selected coach"}` : "Coach unassigned", "success");
      onClose?.(true);
    } catch (err) {
      console.error("Assign failed:", err);
      notify("Failed to update team coach", "error");
      onClose?.(false);
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedCoach) {
      notify("Please select a coach", "warning");
      return;
    }
    await saveCoachId(selectedCoach);
  };

  const handleUnassign = async () => {
    await saveCoachId(null);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold text-slate-800 mb-4">Assign Coach to Team</h2>

        {loading ? (
          <ListLoadingSpinner />
        ) : (
          <>
            <label className="block text-sm font-medium text-slate-700 mb-2">Select a Coach</label>

            <select
              className="w-full border rounded-lg p-2"
              value={selectedCoach}
              onChange={(e) => setSelectedCoach(e.target.value)}
              disabled={saving}
            >
              <option value="">-- Select Coach --</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName || c.email || c.id}
                </option>
              ))}
            </select>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => onClose?.(false)}
                className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg"
                disabled={saving}
              >
                Cancel
              </button>

              <button
                onClick={handleUnassign}
                className="px-4 py-2 bg-slate-200 text-slate-900 rounded-lg hover:bg-slate-300"
                disabled={saving}
                title="Remove coach assignment"
              >
                Unassign
              </button>

              <button
                onClick={handleAssign}
                className="px-4 py-2 bg-yellow-400 text-slate-900 rounded-lg hover:bg-yellow-500"
                disabled={saving}
              >
                {saving ? "Saving..." : "Assign"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
