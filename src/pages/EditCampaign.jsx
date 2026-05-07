import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import safeImageURL from "../utils/safeImage";
import { avatarFallback } from "../utils/avatarFallback";
import { FaArrowLeft, FaSave, FaImage } from "react-icons/fa";
import { useAuth } from "../context/AuthContext";

function getTeamImageUrl(team = {}) {
  return String(team.avatar || team.photoURL || team.imgUrl || team.logo || "").trim();
}

export default function EditCampaign() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const role = String(profile?.role || "").toLowerCase();
  const canManageCampaign = role === "admin" || role === "super-admin" || role === "coach";

  const [form, setForm] = useState({
    name: "",
    description: "",
    goalAmount: "",
    imageURL: "",
    videoUrl: "",
    startDate: "",
    endDate: "",
    isPublic: false,
    showDefaultWelcomeMessage: true,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imagePreview, setImagePreview] = useState("");
  const [campaignTeamName, setCampaignTeamName] = useState("");
  const [campaignTeamImageURL, setCampaignTeamImageURL] = useState("");

  // Load existing campaign
  useEffect(() => {
    if (!canManageCampaign) {
      setLoading(false);
      return;
    }

    async function loadCampaign() {
      try {
        const ref = doc(db, "campaigns", campaignId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setLoading(false);
          return;
        }

        const data = snap.data();
        const explicitTeamName = String(
          data.teamName || (Array.isArray(data.teamNames) ? data.teamNames[0] : "") || ""
        ).trim();
        let nextTeamName = explicitTeamName;
        let nextTeamImageURL = "";
        const fallbackTeamId = String(
          data.teamId || (Array.isArray(data.teamIds) ? data.teamIds[0] : "") || ""
        ).trim();
        if (fallbackTeamId) {
          try {
            const teamSnap = await getDoc(doc(db, "teams", fallbackTeamId));
            if (teamSnap.exists()) {
              const teamData = teamSnap.data() || {};
              if (!nextTeamName) {
                nextTeamName = String(teamData.name || teamData.teamName || "").trim();
              }
              nextTeamImageURL = getTeamImageUrl(teamData);
            }
          } catch (teamErr) {
            console.warn("Failed to resolve campaign team details:", teamErr);
          }
        }
        const resolvedImageURL = String(data.imageURL || "").trim() || nextTeamImageURL;

        setForm({
          name: data.name || "",
          description: data.description || "",
          goalAmount: data.goalAmount || "",
          imageURL: resolvedImageURL,
          videoUrl: data.videoUrl || data.youtubeUrl || "",
          startDate: data.startDate || "",
          endDate: data.endDate || "",
          isPublic: data.isPublic === true,
          showDefaultWelcomeMessage: data.showDefaultWelcomeMessage !== false,
        });
        setCampaignTeamName(nextTeamName);
        setCampaignTeamImageURL(nextTeamImageURL);
        setImagePreview(resolvedImageURL);

        setLoading(false);
      } catch (err) {
        console.error("Error loading campaign:", err);
        setLoading(false);
      }
    }

    loadCampaign();
  }, [campaignId, canManageCampaign]);

  // Update form fields
  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const welcomeTeamName = campaignTeamName || "This team";
  const welcomeExample = `${welcomeTeamName} family, friends, and fans - Thank you so much for taking the time to view our fundraiser page.`;
  const imageFallback = avatarFallback({
    label: campaignTeamName || form.name || "Team",
    type: "team",
    size: 256,
  });

  // Save updates
  async function handleSave() {
    setSaving(true);
    try {
      const ref = doc(db, "campaigns", campaignId);
      await updateDoc(ref, {
        name: form.name,
        description: form.description,
        goalAmount: Number(form.goalAmount) || 0,
        imageURL: form.imageURL,
        videoUrl: form.videoUrl || "",
        startDate: form.startDate,
        endDate: form.endDate,
        isPublic: form.isPublic === true,
        showDefaultWelcomeMessage: form.showDefaultWelcomeMessage !== false,
      });

      navigate(`/campaigns/${campaignId}`);
    } catch (err) {
      console.error("Error saving campaign:", err);
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading campaign...</div>;
  if (!canManageCampaign) {
    return (
      <div className="p-6 max-w-3xl">
        <Link
          to={`/campaigns/${campaignId}`}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
        >
          <FaArrowLeft /> Back to Campaign
        </Link>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
          You can view this campaign, but only coaches and administrators can edit it.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link
        to={`/campaigns/${campaignId}`}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
      >
        <FaArrowLeft /> Back to Campaign
      </Link>

      {/* Page title */}
      <div>
        <h1 className="text-3xl font-bold text-gray-800">Edit Campaign</h1>
        <p className="mt-1 text-sm text-gray-500">
          Update the campaign content, visibility, and schedule.
        </p>
      </div>

      {/* Form container */}
      <div className="bg-white p-6 rounded-xl shadow space-y-6">

        {/* Image Preview */}
        <div className="flex flex-col md:flex-row items-center gap-6">
          <img
            src={safeImageURL(imagePreview || form.imageURL || campaignTeamImageURL, imageFallback)}
            alt="Campaign"
            className="w-full md:w-64 h-40 rounded-lg object-contain bg-slate-100 border p-1"
          />

          <div className="flex-1">
            <label className="block font-medium text-gray-700">Campaign Image URL</label>
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={form.imageURL}
                onChange={(e) => {
                  updateField("imageURL", e.target.value);
                  setImagePreview(e.target.value);
                }}
                className="flex-1 px-3 py-2 border rounded-lg"
                placeholder="/campaigns/your-image.jpg"
              />
              <button
                type="button"
                onClick={() => {
                  updateField("imageURL", "");
                  setImagePreview(campaignTeamImageURL);
                }}
                className="px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
              >
                <FaImage />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Tip: place images in `public/` and use a path like
              `/campaigns/your-image.jpg`.
            </p>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block font-medium text-gray-700">Campaign Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            className="w-full px-3 py-2 border rounded-lg mt-1"
            placeholder="Ex: Spring Fundraiser"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block font-medium text-gray-700">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            className="w-full px-3 py-2 border rounded-lg mt-1"
            rows={4}
            placeholder="Describe the purpose of this campaign..."
          />
        </div>

        {/* Video */}
        <div>
          <label className="block font-medium text-gray-700">YouTube Video URL (Optional)</label>
          <input
            type="text"
            value={form.videoUrl}
            onChange={(e) => updateField("videoUrl", e.target.value)}
            className="w-full px-3 py-2 border rounded-lg mt-1"
            placeholder="https://youtu.be/VIDEO_ID"
          />
        </div>

        {/* Goal */}
        <div>
          <label className="block font-medium text-gray-700">Goal Amount ($)</label>
          <input
            type="number"
            value={form.goalAmount}
            onChange={(e) => updateField("goalAmount", e.target.value)}
            className="w-full px-3 py-2 border rounded-lg mt-1"
            placeholder="5000"
          />
        </div>

        {/* Public Toggle */}
        <div className="flex items-center gap-2">
          <input
            id="campaign-public"
            type="checkbox"
            checked={form.isPublic}
            onChange={(e) => updateField("isPublic", e.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="campaign-public" className="text-sm text-gray-700">
            Make this campaign public (donation page visible)
          </label>
        </div>

        <div className="flex items-start gap-2">
          <input
            id="campaign-default-welcome"
            type="checkbox"
            checked={form.showDefaultWelcomeMessage}
            onChange={(e) => updateField("showDefaultWelcomeMessage", e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="campaign-default-welcome" className="text-sm text-gray-700">
            Show public welcome line under the team name for {welcomeTeamName}
            <div className="mt-1 text-xs text-gray-500">
              Example: &quot;{welcomeExample}&quot;
            </div>
          </label>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block font-medium text-gray-700">Start Date</label>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => updateField("startDate", e.target.value)}
              className="w-full px-3 py-2 border rounded-lg mt-1"
            />
          </div>

          <div>
            <label className="block font-medium text-gray-700">End Date</label>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => updateField("endDate", e.target.value)}
              className="w-full px-3 py-2 border rounded-lg mt-1"
            />
          </div>
        </div>

        {/* Save button */}
        <div className="flex justify-end gap-3">
          <Link
            to={`/campaigns/${campaignId}`}
            className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 text-slate-700"
          >
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <FaSave />
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
