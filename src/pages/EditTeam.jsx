// src/pages/EditTeam.jsx

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  doc,
  getDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { safeImageURL } from "../utils/safeImage";

export default function EditTeam() {
  const { teamId } = useParams();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState("");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState("");        // stored URL
  const [avatarPreview, setAvatarPreview] = useState(""); // preview on screen

  const [saving, setSaving] = useState(false);

  // -------------------------------
  // LOAD TEAM ON PAGE LOAD
  // -------------------------------
  useEffect(() => {
    async function loadTeam() {
      try {
        const ref = doc(db, "teams", teamId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          console.error("Team not found");
          return navigate("/teams");
        }

        const data = snap.data();
        setTeam(data);

        setName(data.name || "");
        setOrgId(data.orgId || "");
        setDescription(data.description || "");
        setAvatar(data.avatar || "");
        setAvatarPreview(safeImageURL(data.avatar));
      } catch (e) {
        console.error("Error loading team:", e);
      }

      setLoading(false);
    }

    loadTeam();
  }, [teamId, navigate]);


  // -------------------------------
  // HANDLE LOCAL AVATAR PREVIEW
  // -------------------------------
  function handleAvatarChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    const localURL = URL.createObjectURL(file);
    setAvatarPreview(localURL);

    // In a real system we upload to storage here — for now store raw file name
    setAvatar(localURL);
  }


  // -------------------------------
  // SAVE TEAM
  // -------------------------------
  async function saveChanges() {
    if (!name.trim()) {
      alert("Team name cannot be empty.");
      return;
    }

    try {
      setSaving(true);

      const ref = doc(db, "teams", teamId);

      await updateDoc(ref, {
        name,
        description,
        avatar,
        ...(profile?.role === "admin" && { orgId }), // admin-only
      });

      navigate(`/teams/${teamId}`);
    } catch (e) {
      console.error("Error saving team:", e);
      alert("Failed to update team");
    }

    setSaving(false);
  }


  // Admin-only page
  if (profile?.role !== "admin") {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-red-600">
          Access Restricted
        </h1>
        <p className="mt-2 text-gray-600">
          Only administrators can edit teams.
        </p>
        <Link
          to="/teams"
          className="inline-block mt-4 px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
        >
          Back to Teams
        </Link>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-gray-600 text-lg">Loading team...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">

      {/* PAGE HEADER */}
      <div>
        <h1 className="text-3xl font-bold">Edit Team</h1>
        <p className="text-gray-500 mt-1">
          Update team details below.
        </p>
      </div>

      <div className="p-6 bg-white border rounded-xl shadow space-y-6">

        {/* IMAGE PREVIEW */}
        <div className="flex flex-col items-center">
          <img
            src={avatarPreview}
            alt="Team Avatar"
            className="w-28 h-28 rounded-full object-cover border shadow bg-white"
          />

          <label className="mt-4 cursor-pointer text-blue-600 hover:underline">
            Change Avatar
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </label>
        </div>

        {/* TEAM NAME */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Team Name
          </label>
          <input
            type="text"
            className="w-full mt-1 p-3 border rounded-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* ORG ID (Admin-only) */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Organization ID
          </label>
          <input
            type="text"
            disabled={profile?.role !== "admin"}
            className="w-full mt-1 p-3 border rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          />
        </div>

        {/* DESCRIPTION */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            className="w-full mt-1 p-3 border rounded-lg h-32"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex justify-end gap-3 mt-6">
          <Link
            to={`/teams/${teamId}`}
            className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            Cancel
          </Link>

          <button
            onClick={saveChanges}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>

      </div>
    </div>
  );
}
