import { useEffect, useState } from "react";
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

export default function AssignTeamsToCampaignModal({
  campaign,
  orgId,
  onClose,
  onSaved,
}) {
  const [teams, setTeams] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTeams() {
      try {
        const q = query(
          collection(db, "teams"),
          where("orgId", "==", orgId)
        );
        const snap = await getDocs(q);
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        setTeams(rows);

        // Preselect existing campaign teams
        const initial = new Set(campaign.teamIds || []);
        setSelected(initial);
      } catch (err) {
        console.error("Failed to load teams:", err);
      } finally {
        setLoading(false);
      }
    }

    loadTeams();
  }, [campaign.teamIds, orgId]);

  const toggle = (teamId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(teamId) ? next.delete(teamId) : next.add(teamId);
      return next;
    });
  };

  const save = async () => {
    try {
      const batch = writeBatch(db);
      const ref = doc(db, "campaigns", campaign.id);

      batch.update(ref, {
        teamIds: Array.from(selected),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      onSaved(Array.from(selected));
      onClose();
    } catch (err) {
      console.error("Failed to save campaign teams:", err);
      alert("Failed to update campaign teams.");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h2 className="text-xl font-semibold mb-4">
          Assign Teams to Campaign
        </h2>

        {loading && <p>Loading teams…</p>}

        {!loading && (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {teams.map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-3 p-2 border rounded-lg cursor-pointer hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
                <span>{t.name}</span>
              </label>
            ))}

            {teams.length === 0 && (
              <p className="text-gray-500">
                No teams found for this organization.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
