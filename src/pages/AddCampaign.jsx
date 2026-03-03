import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { db } from "../firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { FaArrowLeft } from "react-icons/fa";

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
      <Link
        to="/campaigns"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-3"
      >
        <FaArrowLeft /> Back to Campaigns
      </Link>

      <div className="mb-4">
        <h1 className="text-3xl font-bold text-slate-800">New Campaign</h1>
        <p className="mt-1 text-sm text-slate-500">
          Set up a campaign and prepare it for team fundraising.
        </p>
      </div>

      <form onSubmit={submit} className="max-w-lg space-y-4 rounded-xl bg-white p-6 shadow">

        <div>
          <label className="text-sm text-slate-600">Campaign Name</label>
          <input
            name="name"
            value={form.name}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            placeholder="Downey Football 2025"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Organization (Optional)</label>
          <input
            name="org"
            value={form.org}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
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
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            placeholder="10000"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Story / Description (Optional)</label>
          <textarea
            name="description"
            value={form.description}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 h-28 focus:ring-2 focus:ring-blue-200"
            placeholder="Help support our season..."
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">YouTube Video URL (Optional)</label>
          <input
            name="videoUrl"
            value={form.videoUrl}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
            placeholder="https://youtu.be/VIDEO_ID"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600">Campaign Image URL (Optional)</label>
          <input
            name="imageURL"
            value={form.imageURL}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-blue-200"
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

        <div className="flex justify-end gap-3 pt-2">
          <Link
            to="/campaigns"
            className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 text-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create Campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
