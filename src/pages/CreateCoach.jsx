import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import HeaderActions from "../components/HeaderActions";
import { useToast } from "../components/Toast";
import ListLoadingSpinner from "../components/ListLoadingSpinner";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
} from "firebase/firestore";

export default function CreateCoach() {
  const navigate = useNavigate();
  const { push } = useToast();
  const { profile, loading: authLoading } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [teams, setTeams] = useState([]);
  const [campaigns, setCampaigns] = useState([]);

  const [selectedTeams, setSelectedTeams] = useState([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState([]);
  const [saving, setSaving] = useState(false);

  // Load teams + campaigns for dropdowns
  useEffect(() => {
    if (authLoading || !profile) return;

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
  }, [authLoading, profile]);

  const handleSave = async () => {
    if (!name.trim() || !email.trim()) {
      push("Name and email are required.", "warning");
      return;
    }

    if (!profile) return;

    try {
      setSaving(true);
      await addDoc(collection(db, "coaches"), {
        name: name.trim(),
        email: email.trim(),
        orgId: profile.orgId,
        teams: selectedTeams,
        campaigns: selectedCampaigns,
        createdAt: new Date().toISOString(),
      });

      push("Coach created successfully!", "success");
      navigate("/coaches");
    } catch (err) {
      console.error("Failed to create coach:", err);
      push("Failed to create coach.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !profile) {
    return (
      <div className="p-6">
        <ListLoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <HeaderActions
        title="Add Coach"
        addLabel={<Link to="/coaches">← Back to Coaches</Link>}
        exportLabel=""
        onExport={null}
        lastUpdated=""
      />

      <div className="bg-white border border-slate-200 rounded-xl shadow p-6 space-y-6">
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

        <div className="flex justify-end gap-3">
          <button
            onClick={() => navigate("/coaches")}
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
