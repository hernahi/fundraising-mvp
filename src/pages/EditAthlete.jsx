// src/pages/EditAthlete.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import safeImageURL from "../utils/safeImage";
import { FaArrowLeft, FaSave, FaUser } from "react-icons/fa";

export default function EditAthlete() {
  const { athleteId } = useParams();
  const navigate = useNavigate();

  const [athlete, setAthlete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function fetchAthlete() {
      try {
        const ref = doc(db, "athletes", athleteId);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          setAthlete({ id: snap.id, ...snap.data() });
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
        age: athlete.age || "",
        position: athlete.position || "",
        photoURL: athlete.photoURL || "",
        bio: athlete.bio || "",
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to={`/athletes/${athlete.id}`}
          className="flex items-center gap-2 text-gray-700 hover:text-black"
        >
          <FaArrowLeft /> Back to Athlete
        </Link>

        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FaUser /> Edit Athlete
        </h1>
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
            src={safeImageURL(athlete.photoURL)}
            alt="Preview"
            className="w-32 h-32 rounded-full object-cover border"
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

        {/* Save */}
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg flex items-center gap-2 transition disabled:opacity-50"
        >
          <FaSave /> {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
