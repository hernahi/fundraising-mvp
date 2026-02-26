// src/pages/AddTeam.jsx

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { safeImageURL } from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";

export default function AddTeam() {
  const { profile, isSuperAdmin, activeOrgId } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState(activeOrgId || profile?.orgId || "");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) {
      setOrgId(profile?.orgId || activeOrgId || "");
    }
  }, [isSuperAdmin, profile?.orgId, activeOrgId]);

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

    const effectiveOrgId = (isSuperAdmin ? orgId : (profile?.orgId || activeOrgId || orgId)).trim();
    if (!effectiveOrgId) {
      alert("Organization ID is required.");
      return;
    }

    try {
      setSaving(true);

      await addDoc(collection(db, "teams"), {
        name: name.trim(),
        orgId: effectiveOrgId,
        description: description.trim(),
        address: address.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
        avatar: avatar || "",
        createdAt: serverTimestamp(),
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
  if (!["admin", "super-admin"].includes(profile?.role || "")) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-red-600">
          Access Restricted
        </h1>
        <p className="mt-2 text-gray-600">
          Only administrators and super-admins can create new teams.
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
            src={safeImageURL(
              avatarPreview,
              avatarFallback({ label: name || "Team", type: "team", size: 192 })
            )}
            alt="Team Avatar Preview"
            className="w-20 h-20 rounded-full object-cover border shadow bg-white"
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
            disabled={!isSuperAdmin}
            className="w-full mt-1 p-3 border rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
          />
          {!isSuperAdmin && (
            <p className="mt-1 text-xs text-gray-500">
              Org is locked to your admin account.
            </p>
          )}
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

        {/* ADDRESS (OPTIONAL) */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Team Address (Optional)
          </label>
          <input
            type="text"
            className="w-full mt-1 p-3 border rounded-lg"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, City, ST 00000"
          />
        </div>

        {/* PHONE (OPTIONAL) */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Team Phone (Optional)
          </label>
          <input
            type="text"
            className="w-full mt-1 p-3 border rounded-lg"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 555-5555"
          />
        </div>

        {/* NOTES (OPTIONAL) */}
        <div>
          <label className="text-sm font-medium text-gray-700">
            Notes (Optional)
          </label>
          <textarea
            className="w-full mt-1 p-3 border rounded-lg h-28"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra context about this team..."
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
