import { useEffect, useState } from "react";
import { useToast } from "./Toast";
import { useAuth } from "../context/AuthContext";
import { db } from "../firebase/config";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import ListLoadingSpinner from "./ListLoadingSpinner";

export default function AddCoachModal({ isOpen, onClose, onCreated }) {
  const { push } = useToast();
  const { profile, loading: authLoading } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [teams, setTeams] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || authLoading || !profile) return;

    const teamsRef = collection(db, "teams");
    const teamsQuery = query(
      teamsRef,
      where("orgId", "==", profile.orgId),
      orderBy("name", "asc")
    );
    const unsubTeams = onSnapshot(teamsQuery, (snap) => {
      setTeams(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const campaignsRef = collection(db, "campaigns");
    const campaignsQuery = query(
      campaignsRef,
      where("orgId", "==", profile.orgId),
      orderBy("name", "asc")
    );
    const unsubCampaigns = onSnapshot(campaignsQuery, (snap) => {
      setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubTeams();
      unsubCampaigns();
    };
  }, [isOpen, authLoading, profile]);

  const resetForm = () => {
    setName("");
    setEmail("");
    setSelectedTeams([]);
    setSelectedCampaigns([]);
  };

  const handleClose = () => {
    resetForm();
    onClose && onClose();
  };

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) {
      push("Name and email are required.", "warning");
      return;
    }
    if (!profile) return;

    try {
      setSaving(true);
      const docRef = await addDoc(collection(db, "coaches"), {
        name: name.trim(),
        email: email.trim(),
        orgId: profile.orgId,
        teams: selectedTeams,
        campaigns: selectedCampaigns,
        createdAt: new Date().toISOString(),
      });

      push("Coach created successfully!", "success");
      onCreated && onCreated(docRef.id);
      handleClose();
    } catch (err) {
      console.error("Failed to create coach:", err);
      push("Failed to create coach.", "error");
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  if (authLoading || !profile) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-6 w-full max-w-lg">
          <ListLoadingSpinner />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">
          Add Coach
        </h2>

        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              className="mt-1 w-full border rounded-lg p-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Coach name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              className="mt-1 w-full border rounded-lg p-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="coach@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Teams
            </label>
            <select
              multiple
              className="w-full border rounded-lg p-2"
              value={selectedTeams}
              onChange={(e) =>
                setSelectedTeams(
                  Array.from(e.target.selectedOptions, (o) => o.value)
                )
              }
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Campaigns
            </label>
            <select
              multiple
              className="w-full border rounded-lg p-2"
              value={selectedCampaigns}
              onChange={(e) =>
                setSelectedCampaigns(
                  Array.from(e.target.selectedOptions, (o) => o.value)
                )
              }
            >
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-yellow-400 text-slate-900 rounded-lg hover:bg-yellow-500 disabled:opacity-60 transition"
          >
            {saving ? "Saving..." : "Save Coach"}
          </button>
        </div>
      </div>
    </div>
  );
}
