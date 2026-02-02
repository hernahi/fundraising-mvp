// src/pages/AthleteForm.jsx
import React, { useState, useEffect } from "react";
import { db } from "../firebase";
import {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useParams, useNavigate } from "react-router-dom";
import { uploadAthleteImage } from "../utils/uploadAthleteImage";

export default function AthleteForm() {
  const { athleteId } = useParams(); // If editing, id exists
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [imageFile, setImageFile] = useState(null);

  const [form, setForm] = useState({
    name: "",
    teamId: "",
    orgId: "demo-org",
    imgUrl: null,
    donations: 0,
  });

  // Load existing athlete if editing
  useEffect(() => {
    async function loadAthlete() {
      if (!athleteId) {
        setLoading(false);
        return;
      }

      const ref = doc(db, "athletes", athleteId);
      const snap = await getDoc(ref);

      if (snap.exists()) {
        setForm(snap.data());
      }

      setLoading(false);
    }

    loadAthlete();
  }, [athleteId]);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  function handleFileChange(e) {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);

    let finalImageUrl = form.imgUrl || null;

    // Upload NEW image if selected
    if (imageFile) {
      finalImageUrl = await uploadAthleteImage(
        imageFile,
        athleteId || form.userId || Date.now().toString()
      );
    }

    const ref = doc(db, "athletes", athleteId || crypto.randomUUID());

    const payload = {
      ...form,
      imgUrl: finalImageUrl,
      updatedAt: serverTimestamp(),
    };

    if (!athleteId) {
      // If new athlete
      payload.createdAt = serverTimestamp();
    }

    await setDoc(ref, payload, { merge: true });

    navigate("/athletes");
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">
        {athleteId ? "Edit Athlete" : "Add Athlete"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            className="border rounded w-full p-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Team ID
          </label>
          <input
            name="teamId"
            value={form.teamId}
            onChange={handleChange}
            className="border rounded w-full p-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Upload Image</label>
          <input type="file" accept="image/*" onChange={handleFileChange} />
        </div>

        {form.imgUrl && (
          <img
            src={form.imgUrl}
            alt="Athlete"
            className="w-32 h-32 object-cover rounded border"
          />
        )}

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          {athleteId ? "Save Changes" : "Create Athlete"}
        </button>
      </form>
    </div>
  );
}
