// src/pages/EditTeam.jsx

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { db } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { safeImageURL } from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";
import { uploadTeamImage } from "../utils/uploadTeamImage";
import { FaArrowLeft } from "react-icons/fa";

export default function EditTeam() {
  const { teamId } = useParams();
  const { profile, isSuperAdmin, activeOrgId } = useAuth();
  const navigate = useNavigate();

  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [orgId, setOrgId] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [defaultAthleteGoalMinimum, setDefaultAthleteGoalMinimum] = useState("");
  const [avatar, setAvatar] = useState("");        // stored URL
  const [avatarPreview, setAvatarPreview] = useState(""); // preview on screen
  const [avatarFile, setAvatarFile] = useState(null);

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
        setOrgId(data.orgId || activeOrgId || profile?.orgId || "");
        setDescription(data.description || "");
        setAddress(data.address || "");
        setPhone(data.phone || "");
        setNotes(data.notes || "");
        setDefaultAthleteGoalMinimum(
          data.defaultAthleteGoalMinimum == null ? "" : String(data.defaultAthleteGoalMinimum)
        );
        const resolvedAvatar =
          data.avatar || data.photoURL || data.imgUrl || data.logo || "";
        setAvatar(resolvedAvatar);
        setAvatarPreview(safeImageURL(resolvedAvatar));
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
    setAvatarFile(file);
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
      const previousTeamName = String(team?.name || team?.teamName || "").trim();
      const normalizedTeamName = name.trim().replace(/\s+/g, " ");
      const normalizedDefaultAthleteGoalMinimum =
        defaultAthleteGoalMinimum === "" ? null : Math.max(0, Number(defaultAthleteGoalMinimum) || 0);
      let finalAvatar = String(avatar || "").trim();
      if (avatarFile) {
        finalAvatar = (await uploadTeamImage(avatarFile, teamId)) || finalAvatar;
      }

      await updateDoc(ref, {
        name: normalizedTeamName,
        teamName: normalizedTeamName,
        description: description.trim(),
        address: address.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
        defaultAthleteGoalMinimum: normalizedDefaultAthleteGoalMinimum,
        avatar: finalAvatar,
        photoURL: finalAvatar,
        imgUrl: finalAvatar,
        ...(isSuperAdmin && { orgId: orgId.trim() }), // super-admin only
      });

      if (normalizedTeamName && normalizedTeamName !== previousTeamName) {
        const normalizedOrgId = String(orgId || team?.orgId || activeOrgId || profile?.orgId || "").trim();
        const queries = [
          query(
            collection(db, "athletes"),
            where("orgId", "==", normalizedOrgId),
            where("teamId", "==", teamId)
          ),
          query(
            collection(db, "invites"),
            where("orgId", "==", normalizedOrgId),
            where("teamId", "==", teamId)
          ),
          query(
            collection(db, "campaigns"),
            where("orgId", "==", normalizedOrgId),
            where("teamId", "==", teamId)
          ),
          query(
            collection(db, "users"),
            where("orgId", "==", normalizedOrgId),
            where("teamId", "==", teamId)
          ),
          query(
            collection(db, "users"),
            where("orgId", "==", normalizedOrgId),
            where("teamIds", "array-contains", teamId)
          ),
          query(
            collection(db, "users"),
            where("orgId", "==", normalizedOrgId),
            where("assignedTeamIds", "array-contains", teamId)
          ),
        ];

        const snapshots = await Promise.all(
          queries.map((qRef) =>
            getDocs(qRef).catch(() => ({ docs: [] }))
          )
        );

        const docUpdates = new Map();
        snapshots.forEach((snap) => {
          (snap.docs || []).forEach((entry) => {
            const path = entry.ref.path;
            const collectionName = entry.ref.parent.id;
            let update = null;

            if (collectionName === "campaigns") {
              update = { teamName: normalizedTeamName };
            } else {
              update = { teamName: normalizedTeamName };
            }

            docUpdates.set(path, { ref: entry.ref, update });
          });
        });

        const updateEntries = Array.from(docUpdates.values());
        for (let i = 0; i < updateEntries.length; i += 400) {
          const batch = writeBatch(db);
          updateEntries.slice(i, i + 400).forEach(({ ref: nextRef, update }) => {
            batch.update(nextRef, update);
          });
          await batch.commit();
        }
      }

      navigate(`/teams/${teamId}`);
    } catch (e) {
      console.error("Error saving team:", e);
      alert("Failed to update team");
    } finally {
      setSaving(false);
    }
  }


  // Admin-only page
  if (!["admin", "super-admin"].includes(profile?.role || "")) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-semibold text-red-600">
          Access Restricted
        </h1>
        <p className="mt-2 text-gray-600">
          Only administrators and super-admins can edit teams.
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
      <Link
        to={`/teams/${teamId}`}
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800"
      >
        <FaArrowLeft /> Back to Team Details
      </Link>

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
            src={safeImageURL(
              avatarPreview,
              avatarFallback({ label: name || "Team", type: "team", size: 192 })
            )}
            alt="Team Avatar"
            className="w-20 h-20 rounded-full object-cover border shadow bg-white"
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
            disabled={!isSuperAdmin}
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

        <div>
          <label className="text-sm font-medium text-gray-700">
            Default Athlete Minimum Goal ($)
          </label>
          <input
            type="number"
            min="0"
            className="w-full mt-1 p-3 border rounded-lg"
            value={defaultAthleteGoalMinimum}
            onChange={(e) => setDefaultAthleteGoalMinimum(e.target.value)}
            placeholder="Optional minimum, ex: 250"
          />
          <p className="mt-1 text-xs text-slate-500">
            Athletes on this team can set a higher personal goal, but not lower than this amount unless a staff override says otherwise.
          </p>
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
