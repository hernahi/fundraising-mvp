import { useState } from "react";
import { useToast } from "../components/Toast";
import { mockUploadImage } from "../utils/imageMock";
import { useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../firebase/config";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";

export default function AddAthlete() {
  const { push } = useToast();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const presetTeamId = searchParams.get("teamId") || "";

  const [form, setForm] = useState({
    name: "",
    teamId: presetTeamId,
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

    setSaving(true);

    try {
      const isLive = import.meta.env.VITE_USE_FIREBASE === "true";

      if (isLive) {
        await addDoc(collection(db, "athletes"), {
          name: form.name.trim(),
          teamId: form.teamId || "",
          orgId: profile?.orgId || "",
          avatar: form.imgUrl || "",
          donations: 0,
          status: "active",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      push(
        isLive
          ? "Athlete created successfully!"
          : "Mock mode: Athlete added locally",
        "success"
      );

      navigate("/athletes");
    } catch (err) {
      console.error(err);
      push("Failed to create athlete", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-slate-800 border-b-2 border-yellow-400 pb-1">
        New Athlete
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
            placeholder="Jane Doe"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1">Team ID</label>
          <input
            name="teamId"
            value={form.teamId}
            onChange={onChange}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            placeholder="TEAM_ID"
          />
        </div>

        <div>
          <label className="block text-sm text-slate-600 mb-1">
            Profile Image (local preview)
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
          {saving ? "Saving…" : "Create Athlete"}
        </button>
      </form>
    </div>
  );
}
