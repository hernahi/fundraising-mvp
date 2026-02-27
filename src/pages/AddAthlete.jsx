import { useState } from "react";
import { useToast } from "../components/Toast";
import { mockUploadImage } from "../utils/imageMock";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { db } from "../firebase/config";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import safeImageURL from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";
import { FaArrowLeft } from "react-icons/fa";

export default function AddAthlete() {
  const { push } = useToast();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const presetTeamId = searchParams.get("teamId") || "";
  const returnTo = searchParams.get("returnTo") || "/athletes";
  const returnLabel = searchParams.get("returnLabel") || "Back to Athletes";

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

      navigate(returnTo);
    } catch (err) {
      console.error(err);
      push("Failed to create athlete", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6">
      <Link
        to={returnTo}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-3"
      >
        <FaArrowLeft /> {returnLabel}
      </Link>

      <h1 className="text-2xl font-bold text-slate-800 border-b-2 border-slate-300 pb-1">
        Manual Athlete Add
      </h1>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        Preferred flow: use Athlete Onboarding to invite and activate athletes.
        <Link
          to="/coach/invite"
          className="ml-2 font-medium text-blue-700 hover:text-blue-800 underline"
        >
          Go to Athlete Onboarding
        </Link>
      </div>

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
              src={safeImageURL(
                form.imgUrl,
                avatarFallback({ label: form.name || "Athlete", type: "athlete", size: 160 })
              )}
              alt="preview"
              className="mt-3 w-20 h-20 rounded-full object-cover border border-slate-200"
            />
          )}

          <p className="text-xs text-slate-500 mt-1">
            Dev-only preview. Image not uploaded yet.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-slate-900 hover:bg-slate-800 text-white font-semibold px-5 py-2 rounded-lg transition disabled:opacity-60"
        >
          {saving ? "Saving…" : "Create Athlete Manually"}
        </button>
      </form>
    </div>
  );
}
