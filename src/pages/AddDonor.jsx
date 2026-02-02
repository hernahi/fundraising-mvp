import { useState } from "react";
import { useToast } from "../components/Toast";
import { mockUploadImage } from "../utils/imageMock";
import { useNavigate } from "react-router-dom";
import { db } from "../firebase/config";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";

export default function AddDonor() {
  const { push } = useToast();
  const navigate = useNavigate();
  const { user, profile, activeOrgId, loading: authLoading } = useAuth();
  const orgId = activeOrgId || profile?.orgId;

  const [form, setForm] = useState({
    name: "",
    email: "",
    campaign: "",
    imgUrl: "",
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const onChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    setFile(f || null);

    if (f) {
      const url = await mockUploadImage(f);
      setForm((prev) => ({ ...prev, imgUrl: url }));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return push("Name is required", "warning");
    if (authLoading || !orgId) {
      push("Missing org context. Please try again.", "error");
      return;
    }

    setSaving(true);

    try {
      const isLive = import.meta.env.VITE_USE_FIREBASE === "true";

      if (isLive) {
        await addDoc(collection(db, "donors"), {
          orgId,
          name: form.name,
          email: form.email || "",
          campaign: form.campaign || "",
          imgUrl: form.imgUrl || "",
          amount: 0,
          totalDonations: 0,
          lastDonationDate: "",
          createdBy: user?.uid || "",
          createdAt: serverTimestamp(),
        });
      }

      push(
        isLive
          ? "Donor created successfully!"
          : "Mock mode: Donor added locally",
        "success"
      );

      navigate("/donors");
    } catch (err) {
      console.error(err);
      push("Failed to create donor", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 border-b-2 border-yellow-400 pb-1">
        New Donor
      </h1>

      <form
        onSubmit={submit}
        className="mt-4 space-y-4 max-w-lg bg-white p-4 rounded-xl shadow"
      >
        <div>
          <label className="block text-sm text-slate-600 mb-1">Full Name</label>
          <input
            name="name"
            value={form.name}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            placeholder="John Smith"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1">
            Email (optional)
          </label>
          <input
            name="email"
            value={form.email}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            placeholder="john@example.com"
            type="email"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1">Campaign</label>
          <input
            name="campaign"
            value={form.campaign}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            placeholder="2025 Season"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1">
            Donor Avatar (local preview)
          </label>
          <input type="file" accept="image/*" onChange={onFile} />

          {form.imgUrl && (
            <img
              src={form.imgUrl}
              alt="preview"
              className="mt-3 w-24 h-24 rounded-full object-cover border border-slate-200"
            />
          )}

          <p className="text-xs text-slate-500 mt-1">
            Dev-only preview. Image not uploaded yet.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-yellow-400 hover:brightness-110 text-slate-900 font-semibold px-5 py-2 rounded-lg transition disabled:opacity-60"
        >
          {saving ? "Saving..." : "Create Donor"}
        </button>
      </form>
    </div>
  );
}
