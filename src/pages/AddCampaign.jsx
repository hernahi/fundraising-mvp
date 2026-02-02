import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { db } from "../firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

export default function AddCampaign() {
  const navigate = useNavigate();
  const { push } = useToast();

  const [form, setForm] = useState({
    name: "",
    org: "",
    description: "",
    goal: "",
    videoUrl: "",
    isPublic: false,
    imageURL: "",
  });

  const [loading, setLoading] = useState(false);

  const onChange = (e) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return push("Campaign name required", "warning");

    setLoading(true);
    try {
      if (import.meta.env.VITE_USE_FIREBASE === "true") {
        const ref = await addDoc(collection(db, "campaigns"), {
          name: form.name,
          org: form.org || "",
          description: form.description || "",
          goal: Number(form.goal) || 0,
          videoUrl: form.videoUrl || "",
          isPublic: form.isPublic === true,
          imageURL: form.imageURL || "",
          donations: 0,
          createdAt: serverTimestamp(),
        });

        const url = `${window.location.origin}/c/${ref.id}`;
        navigator.clipboard.writeText(url).catch(() => {});

        push("Campaign created & link copied!", "success");
        navigate(`/c/${ref.id}`);
      } else {
        push("Mock: Campaign created", "success");
        navigate("/");
      }
    } catch (err) {
      console.error(err);
      push("Failed to create campaign", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 border-b-2 border-yellow-400 pb-1">
        New Campaign
      </h1>

      <form onSubmit={submit} className="mt-4 bg-white p-5 rounded-xl shadow space-y-4 max-w-lg">

        <div>
          <label className="text-sm text-slate-600">Campaign Name</label>
          <input
            name="name"
            value={form.name}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-yellow-300"
            placeholder="Downey Football 2025"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Organization (Optional)</label>
          <input
            name="org"
            value={form.org}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-yellow-300"
            placeholder="Downey High School"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Goal (Optional)</label>
          <input
            name="goal"
            value={form.goal}
            onChange={onChange}
            type="number"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-yellow-300"
            placeholder="10000"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Story / Description (Optional)</label>
          <textarea
            name="description"
            value={form.description}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 h-28 focus:ring-2 focus:ring-yellow-300"
            placeholder="Help support our season..."
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">YouTube Video URL (Optional)</label>
          <input
            name="videoUrl"
            value={form.videoUrl}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-yellow-300"
            placeholder="https://youtu.be/VIDEO_ID"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Campaign Image URL (Optional)</label>
          <input
            name="imageURL"
            value={form.imageURL}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-yellow-300"
            placeholder="/campaigns/your-image.jpg"
          />
        </div>

        <p className="text-xs text-slate-500">
          Tip: place images in `public/` and use a path like
          `/campaigns/your-image.jpg`.
        </p>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="isPublic"
            checked={form.isPublic}
            onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Make this campaign public (donation page visible)
        </label>

        <button
          type="submit"
          disabled={loading}
          className="bg-yellow-400 text-slate-900 font-semibold px-6 py-2 rounded-lg hover:brightness-110 disabled:opacity-60"
        >
          {loading ? "Creating…" : "Create Campaign"}
        </button>
      </form>
    </div>
  );
}
