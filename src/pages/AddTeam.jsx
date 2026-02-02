// src/pages/AddTeam.jsx

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { collection, addDoc } from "firebase/firestore";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { safeImageURL } from "../utils/safeImage";

export default function AddTeam() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState(profile?.orgId || "");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");

  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------
  // Image Upload (local preview only — storage later)
  // ---------------------------------------------------
  function handleAvatarChange(e) {
    const file = e.target.files[0];
    if (!file) return;

    const localURL = URL.createObjectURL(file);
    setAvatarPreview(localURL);
    setAvatar(localURL);
  }

  // ---------------------------------------------------
  // SAVE NEW TEAM
  // ---------------------------------------------------
  async function createTeam() {
    if (!name.trim()) {
      alert("Team name cannot be empty.");
      return;
    }

    if (!orgId.trim()) {
      alert("Organization ID is required.");
      return;
    }

    try {
      setSaving(true);

      await addDoc(collection(db, "teams"), {
        name,
        orgId,
        description,
        avatar: avatar || "",
        createdAt: new Date().toISOString(),
      });

      navigate("/teams");
    } catch (err) {
      console.error("Error creating team:", err);
      alert("Failed to create team.");
    }

    setSaving(false);
  }

  // ---------------------------------------------------
  // Admin-only access
  // ---------------------------------------------------
  if (profile?.role !== "admin") {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-red-600">
          Access Restricted
        </h1>
        <p className="mt-2 text-gray-600">
          Only administrators can create new teams.
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

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">

      {/* PAGE HEADER */}
      <div>
        <h1 className="text-3xl font-bold">Create New Team</h1>
        <p className="text-gray-500 mt-1">
          Add a new team under your organization.
        </p>
      </div>

      <div className="p-6 bg-white border rounded-xl shadow space-y-6">

        {/* IMAGE PREVIEW */}
        <div className="flex flex-col items-center">
          <img
            src={safeImageURL(avatarPreview)}
            alt="Team Avatar Preview"
            className="w-28 h-28 rounded-full object-cover border shadow bg-white"
          />

          <label className="mt-4 cursor-pointer text-blue-600 hover:underline">
            Upload Avatar
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
          <label className="text-sm font-medium text-gray-700">Team Name</label>
          <input
            type="text"
            className="w-full mt-1 p-3 border rounded-lg"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* ORG ID */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Organization ID
          </label>
          <input
            type="text"
            className="w-full mt-1 p-3 border rounded-lg"
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
            to="/teams"
            className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
          >
            Cancel
          </Link>

          <button
            onClick={createTeam}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
          >
            {saving ? "Creating..." : "Create Team"}
          </button>
        </div>

      </div>
    </div>
  );
}
