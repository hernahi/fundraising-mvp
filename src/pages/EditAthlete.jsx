// src/pages/EditAthlete.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import safeImageURL from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";
import { FaArrowLeft, FaSave, FaUser } from "react-icons/fa";

function formatGradeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/(st|nd|rd|th)\b/i.test(raw)) return raw;
  if (!/^\d+$/.test(raw)) return raw;

  const gradeNumber = Number(raw);
  const teenRemainder = gradeNumber % 100;
  if (teenRemainder >= 11 && teenRemainder <= 13) {
    return `${gradeNumber}th`;
  }

  const remainder = gradeNumber % 10;
  if (remainder === 1) return `${gradeNumber}st`;
  if (remainder === 2) return `${gradeNumber}nd`;
  if (remainder === 3) return `${gradeNumber}rd`;
  return `${gradeNumber}th`;
}

function normalizeAthleteForEdit(id, data = {}) {
  return {
    id,
    ...data,
    name: data.name || data.displayName || "",
    age: data.age ?? "",
    position: data.position || data.role || "",
    grade: data.grade || "",
    jerseyNumber: data.jerseyNumber || data.jerseyNo || "",
    goal: data.goal ?? data.personalGoal ?? "",
    photoURL: data.photoURL || data.avatar || data.imgUrl || "",
    bio: data.bio || data.story || data.description || "",
    supporterMessage: data.supporterMessage || data.fundraisingMessage || "",
  };
}

export default function EditAthlete() {
  const { athleteId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [athlete, setAthlete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const role = String(profile?.role || "").toLowerCase();
  const canManageAnyAthlete = role === "admin" || role === "super-admin" || role === "coach";
  const canEditSelf = role === "athlete" && profile?.uid === athleteId;
  const canEditAthlete = canManageAnyAthlete || canEditSelf;

  useEffect(() => {
    async function fetchAthlete() {
      try {
        const ref = doc(db, "athletes", athleteId);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          setAthlete(normalizeAthleteForEdit(snap.id, snap.data() || {}));
        }
      } catch (err) {
        console.error("Error loading athlete:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchAthlete();
  }, [athleteId]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);

    try {
      const ref = doc(db, "athletes", athlete.id);
      await updateDoc(ref, {
        name: athlete.name || "",
        displayName: athlete.name || "",
        age: athlete.age || "",
        position: athlete.position || "",
        grade: formatGradeLabel(athlete.grade),
        jerseyNumber: athlete.jerseyNumber || "",
        goal: athlete.goal === "" ? null : Number(athlete.goal) || 0,
        photoURL: athlete.photoURL || "",
        avatar: athlete.photoURL || "",
        bio: athlete.bio || "",
        supporterMessage: athlete.supporterMessage || "",
      });

      navigate(`/athletes/${athlete.id}`);
    } catch (err) {
      console.error("Error updating athlete:", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading athlete...</div>;
  if (!athlete) return <div className="p-6">Athlete not found.</div>;
  if (!canEditAthlete) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          You can only edit your own athlete profile.
        </div>
        <div className="mt-4">
          <Link
            to={`/athletes/${athleteId}`}
            className="inline-flex items-center gap-2 rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <FaArrowLeft /> Back to Athlete
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link
        to={`/athletes/${athlete.id}`}
        className="inline-flex items-center gap-2 text-gray-700 hover:text-black"
      >
        <FaArrowLeft /> Back to Athlete
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FaUser /> Edit Athlete
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Update the athlete profile details shown across the app.
        </p>
      </div>

      <form
        onSubmit={handleSave}
        className="bg-white shadow rounded-xl p-6 space-y-6"
      >
        {/* GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Name */}
          <div>
            <label className="block font-medium mb-1">Full Name</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={athlete.name || ""}
              onChange={(e) =>
                setAthlete({ ...athlete, name: e.target.value })
              }
            />
          </div>

          {/* Age */}
          <div>
            <label className="block font-medium mb-1">Age</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2"
              value={athlete.age || ""}
              onChange={(e) =>
                setAthlete({ ...athlete, age: e.target.value })
              }
            />
          </div>

          {/* Position */}
          <div>
            <label className="block font-medium mb-1">Role / Position</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={athlete.position || ""}
              onChange={(e) =>
                setAthlete({ ...athlete, position: e.target.value })
              }
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Grade</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={athlete.grade || ""}
              onChange={(e) =>
                setAthlete({ ...athlete, grade: e.target.value })
              }
              onBlur={() =>
                setAthlete((prev) => ({
                  ...prev,
                  grade: formatGradeLabel(prev.grade),
                }))
              }
              placeholder="Ex: 9th Grade"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Jersey Number</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={athlete.jerseyNumber || ""}
              onChange={(e) =>
                setAthlete({ ...athlete, jerseyNumber: e.target.value })
              }
              placeholder="Ex: 12"
            />
          </div>

          <div>
            <label className="block font-medium mb-1">Personal Goal ($)</label>
            <input
              type="number"
              min="0"
              className="w-full border rounded-lg px-3 py-2"
              value={athlete.goal ?? ""}
              onChange={(e) =>
                setAthlete({ ...athlete, goal: e.target.value })
              }
              placeholder="Ex: 500"
            />
          </div>

          {/* Photo URL */}
          <div>
            <label className="block font-medium mb-1">Photo URL</label>
            <input
              type="text"
              className="w-full border rounded-lg px-3 py-2"
              value={athlete.photoURL || ""}
              onChange={(e) =>
                setAthlete({ ...athlete, photoURL: e.target.value })
              }
            />
          </div>
        </div>

        {/* Preview */}
        <div className="mt-4">
          <label className="block font-medium mb-2">Preview Image</label>
          <img
            src={safeImageURL(
              athlete.photoURL,
              avatarFallback({ label: athlete.name || "Athlete", type: "athlete", size: 192 })
            )}
            alt="Preview"
            className="w-24 h-24 rounded-full object-cover border"
          />
        </div>

        {/* Bio */}
        <div>
          <label className="block font-medium mb-1">Athlete Bio</label>
          <textarea
            className="w-full border rounded-lg px-3 py-2 h-32"
            value={athlete.bio || ""}
            onChange={(e) =>
              setAthlete({ ...athlete, bio: e.target.value })
            }
          ></textarea>
        </div>

        <div>
          <label className="block font-medium mb-1">Supporter Message</label>
          <textarea
            className="w-full border rounded-lg px-3 py-2 h-24"
            value={athlete.supporterMessage || ""}
            onChange={(e) =>
              setAthlete({ ...athlete, supporterMessage: e.target.value })
            }
            placeholder="Share a short message donors will see on your public page."
          ></textarea>
        </div>

        {/* Save */}
        <div className="flex justify-end gap-3">
          <Link
            to={`/athletes/${athlete.id}`}
            className="px-4 py-3 bg-gray-200 rounded-lg hover:bg-gray-300 text-slate-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg flex items-center gap-2 transition disabled:opacity-50"
          >
            <FaSave /> {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
