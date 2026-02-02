import { useEffect, useState } from "react";
import { db } from "../firebase/config";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  deleteDoc,
  doc
} from "firebase/firestore";

export default function AssignAthletesModal({ campaignId, onClose }) {
  const [athletes, setAthletes] = useState([]);
  const [assigned, setAssigned] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const load = async () => {
      // All athletes
      const aSnap = await getDocs(collection(db, "athletes"));
      const list = aSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAthletes(list);

      // Assigned athletes pivot
      const pSnap = await getDocs(
        query(collection(db, "campaignAthletes"), where("campaignId", "==", campaignId))
      );
      setAssigned(new Set(pSnap.docs.map(d => d.data().athleteId)));
      setLoading(false);
    };
    load();
  }, [campaignId]);

  const toggle = (id) => {
    setAssigned(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);

    const pSnap = await getDocs(
      query(collection(db, "campaignAthletes"), where("campaignId", "==", campaignId))
    );

    // Clear existing
    await Promise.all(pSnap.docs.map(d => deleteDoc(doc(db, "campaignAthletes", d.id))));

    // Write new
    await Promise.all(
      Array.from(assigned).map(aid =>
        addDoc(collection(db, "campaignAthletes"), {
          campaignId,
          athleteId: aid
        })
      )
    );

    setSaving(false);
    onClose(true);
  };

  const filtered = athletes.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-xl w-full max-w-lg shadow-lg">
        <h2 className="text-lg font-bold mb-3 text-slate-800">
          Assign Athletes
        </h2>

        <input
          placeholder="Search athletes..."
          className="w-full border rounded-lg px-3 py-2 mb-3"
          value={search}
          onChange={e=>setSearch(e.target.value)}
        />

        {loading ? (
          <div className="text-center p-3">Loading...</div>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-2">
            {filtered.map(a => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assigned.has(a.id)}
                  onChange={() => toggle(a.id)}
                />
                <span>{a.name} — {a.team}</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-slate-200 hover:bg-slate-300"
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
