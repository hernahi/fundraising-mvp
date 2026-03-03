import { useState } from "react";
import { useToast } from "../components/Toast";
import { mockUploadImage } from "../utils/imageMock";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../firebase/config";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { FaArrowLeft } from "react-icons/fa";

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
      <Link
        to="/donors"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-3"
      >
        <FaArrowLeft /> Back to Donors
      </Link>

      <div className="mb-4">
        <h1 className="text-3xl font-bold text-slate-800">New Donor</h1>
        <p className="mt-1 text-sm text-slate-500">
          Add a donor record to your organization.
        </p>
      </div>

      <form
        onSubmit={submit}
        className="max-w-lg space-y-4 rounded-xl bg-white p-6 shadow"
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

        <div className="flex justify-end gap-3 pt-2">
          <Link
            to="/donors"
            className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 text-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition disabled:opacity-60"
          >
            {saving ? "Saving..." : "Create Donor"}
          </button>
        </div>
      </form>
    </div>
  );
}
