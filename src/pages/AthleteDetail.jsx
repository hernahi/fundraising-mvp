// src/pages/AthleteDetail.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import safeImageURL from "../utils/safeImage";
import avatarFallback from "../utils/avatarFallback";
import { FaArrowLeft, FaEdit, FaTrophy, FaUser } from "react-icons/fa";

export default function AthleteDetail() {
  const { athleteId } = useParams();
  const { profile } = useAuth();
  const [athlete, setAthlete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteTemplate, setInviteTemplate] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [savingMessage, setSavingMessage] = useState(false);
  const [messageDirty, setMessageDirty] = useState(false);
  const [athleteDonations, setAthleteDonations] = useState([]);
  const [contactCount, setContactCount] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [campaigns, setCampaigns] = useState([]);
  const [assignCampaignId, setAssignCampaignId] = useState("");
  const [savingCampaign, setSavingCampaign] = useState(false);

  const role = (profile?.role || "").toLowerCase();
  const isSelf =
    role === "athlete" && profile?.uid === athleteId;
  const canEditProfile = isSelf || role === "admin" || role === "super-admin" || role === "coach";
  const canAssignCampaign =
    role === "admin" || role === "super-admin" || role === "coach";

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

  useEffect(() => {
    if (!profile?.orgId || !canAssignCampaign) {
      setCampaigns([]);
      return;
    }

    const loadCampaigns = async () => {
      try {
        const campaignQuery = query(
          collection(db, "campaigns"),
          where("orgId", "==", profile.orgId)
        );
        const snap = await getDocs(campaignQuery);
        setCampaigns(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error("Failed to load campaigns:", err);
      }
    };

    loadCampaigns();
  }, [canAssignCampaign, profile?.orgId]);

  useEffect(() => {
    setAssignCampaignId(athlete?.campaignId || "");
  }, [athlete?.campaignId]);

  useEffect(() => {
    async function loadTemplate() {
      if (!isSelf || !profile?.orgId) return;
      try {
        const ref = doc(db, "organizations", profile.orgId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setInviteTemplate(snap.data()?.donorInviteTemplate || "");
        }
      } catch (err) {
        console.error("Failed to load donor invite template:", err);
      }
    }

    loadTemplate();
  }, [isSelf, profile?.orgId]);

  useEffect(() => {
    if (!isSelf || !athlete) return;
    if (messageDirty) return;
    setInviteMessage(athlete.inviteMessage || inviteTemplate || "");
  }, [athlete, inviteTemplate, isSelf, messageDirty]);

  useEffect(() => {
    if (!profile?.orgId || !athleteId) {
      setAthleteDonations([]);
      return;
    }

    const donorQuery = query(
      collection(db, "donations"),
      where("orgId", "==", profile.orgId),
      where("athleteId", "==", athleteId),
      where("status", "==", "paid"),
      orderBy("createdAt", "desc"),
      limit(100)
    );

    const unsubscribe = onSnapshot(
      donorQuery,
      (snap) => {
        setAthleteDonations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error("Failed to load athlete donations:", err);
        setAthleteDonations([]);
      }
    );

    return () => unsubscribe();
  }, [athleteId, profile?.orgId]);

  useEffect(() => {
    if (!isSelf || !profile?.orgId || !athleteId) {
      setContactCount(0);
      setMessageCount(0);
      return;
    }

    async function loadAthleteReadiness() {
      try {
        const [contactsSnap, messagesSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, "athlete_contacts"),
              where("orgId", "==", profile.orgId),
              where("athleteId", "==", athleteId)
            )
          ),
          getDocs(
            query(
              collection(db, "messages"),
              where("orgId", "==", profile.orgId),
              where("athleteId", "==", athleteId)
            )
          ),
        ]);
        setContactCount(contactsSnap.size || 0);
        setMessageCount(messagesSnap.size || 0);
      } catch (err) {
        console.error("Failed to load athlete readiness:", err);
      }
    }

    loadAthleteReadiness();
  }, [athleteId, isSelf, profile?.orgId]);

  const donateLink = useMemo(() => {
    if (!athlete?.campaignId) return "";
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/donate/${athlete.campaignId}/athlete/${athlete.id}`;
  }, [athlete?.campaignId, athlete?.id]);

  const assignedCampaign = campaigns.find((c) => c.id === athlete?.campaignId);
  const totalRaisedCents = athleteDonations.reduce(
    (sum, donor) => sum + Number(donor.amount || 0),
    0
  );
  const totalRaisedDollars = (totalRaisedCents / 100).toFixed(2);
  const goalAmount = Number(athlete?.goal || 0);
  const computedStats = useMemo(() => {
    const uniqueCampaigns = new Set();
    const uniqueSupporters = new Set();
    let totalAmount = 0;

    for (const d of athleteDonations) {
      if (d.campaignId) uniqueCampaigns.add(d.campaignId);
      const supporterKey =
        d.donorEmail ||
        d.donorName ||
        d.id;
      uniqueSupporters.add(supporterKey);
      totalAmount += Number(d.amount || 0);
    }

    return {
      campaignCount: uniqueCampaigns.size,
      supporters: uniqueSupporters.size,
      totalRaised: (totalAmount / 100).toFixed(2),
    };
  }, [athleteDonations]);
  const goalProgress = goalAmount > 0
    ? Math.min(
        100,
        Math.round((Number(computedStats.totalRaised || 0) / goalAmount) * 100)
      )
    : null;
  const readinessSteps = [
    {
      key: "campaign",
      label: "Campaign assigned",
      done: Boolean(athlete?.campaignId),
      detail: athlete?.campaignId
        ? "Ready for fundraising outreach"
        : "Coach/admin still needs to assign a campaign",
      actionLabel: "Review My Profile",
      actionTo: athleteId ? `/athletes/${athleteId}` : "/athletes",
    },
    {
      key: "contacts",
      label: "Supporters added",
      done: contactCount >= 20,
      detail:
        contactCount >= 20
          ? `${contactCount} contacts ready`
          : `${contactCount}/20 contacts added`,
      actionLabel: "Add Contacts",
      actionTo: "/messages",
    },
    {
      key: "outreach",
      label: "Outreach sent",
      done: messageCount > 0,
      detail:
        messageCount > 0
          ? `${messageCount} message${messageCount === 1 ? "" : "s"} sent`
          : "No outreach sent yet",
      actionLabel: "Send Message",
      actionTo: "/messages",
    },
  ];
  const readinessBlocker = useMemo(() => {
    if (!athlete?.campaignId) {
      return {
        title: "You still need a campaign assignment",
        detail: "Your coach or admin must assign you to a campaign before you can start fundraising outreach.",
        actionLabel: "Review My Profile",
        actionTo: athleteId ? `/athletes/${athleteId}` : "/athletes",
        tone: "amber",
      };
    }

    if (contactCount < 20) {
      return {
        title: "You need more supporter contacts",
        detail: `Add ${20 - contactCount} more contact${20 - contactCount === 1 ? "" : "s"} so you are ready to start sending.`,
        actionLabel: "Add Contacts",
        actionTo: "/messages",
        tone: "amber",
      };
    }

    if (messageCount === 0) {
      return {
        title: "You are ready to send your first message",
        detail: "Your campaign and supporter list are ready. Send your first outreach message to begin fundraising.",
        actionLabel: "Send Message",
        actionTo: "/messages",
        tone: "blue",
      };
    }

    return {
      title: "Your fundraising setup is on track",
      detail: "Keep adding supporters, sending follow-ups, and tracking donations as they come in.",
      actionLabel: "Open Messages",
      actionTo: "/messages",
      tone: "green",
    };
  }, [athlete?.campaignId, athleteId, contactCount, messageCount]);
  const readinessBlockerClasses =
    readinessBlocker.tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : readinessBlocker.tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  if (loading) return <div className="p-4 md:p-6">Loading athlete...</div>;
  if (!athlete) return <div className="p-4 md:p-6">Athlete not found.</div>;

  return (
    <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto">
      <Link
        to="/athletes"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-3"
      >
        <FaArrowLeft /> Back to Athletes
      </Link>

      {/* Header Section */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FaUser /> {athlete.name}
        </h1>
        {canEditProfile && (
          <Link
            to={`/athletes/${athlete.id}/edit`}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition w-full sm:w-auto text-center"
          >
            <FaEdit className="inline mr-2" />
            {isSelf ? "Edit My Profile" : "Edit Athlete"}
          </Link>
        )}
      </div>

      {isSelf && (
        <div className="mb-8 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 md:px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                Fundraising Setup
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Work top to bottom so you do not get stuck: campaign, contacts, then outreach.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                to="/messages"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 text-center"
              >
                Open Messages
              </Link>
              {donateLink && (
                <a
                  href={donateLink}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 text-center"
                >
                  View Donation Page
                </a>
              )}
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {readinessSteps.map((step) => (
              <div
                key={step.key}
                className="rounded-lg border border-slate-200 bg-white px-3 py-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-slate-800">
                    {step.label}
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                      step.done
                        ? "bg-green-100 text-green-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {step.done ? "Done" : "Next"}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-500">{step.detail}</p>
                <Link
                  to={step.actionTo}
                  className="mt-3 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {step.actionLabel}
                </Link>
              </div>
            ))}
          </div>
          <div className={`mt-4 rounded-lg border px-4 py-3 ${readinessBlockerClasses}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">{readinessBlocker.title}</div>
                <p className="mt-1 text-xs opacity-90">{readinessBlocker.detail}</p>
              </div>
              <Link
                to={readinessBlocker.actionTo}
                className="inline-flex items-center justify-center rounded-md border border-current/20 bg-white px-3 py-2 text-xs font-semibold hover:bg-white/80"
              >
                {readinessBlocker.actionLabel}
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Athlete Card */}
      <div className="bg-white rounded-xl shadow p-4 md:p-6 lg:p-7 grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6">
        {/* Avatar */}
        <div className="flex flex-col items-center">
          <img
            src={safeImageURL(
              athlete.photoURL,
              avatarFallback({ label: athlete.name || "Athlete", type: "athlete", size: 192 })
            )}
            alt="Athlete"
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover border"
          />
          <h2 className="mt-4 text-xl font-medium">{athlete.name}</h2>
          <p className="text-gray-500">{athlete.position || "Athlete"}</p>
        </div>

        {/* Details */}
        <div className="md:col-span-2 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-700 mb-1">Team</h3>
            <Link
              to={`/teams/${athlete.teamId}`}
              className="text-blue-600 hover:underline"
            >
              View Team
            </Link>
          </div>

          <div>
            <h3 className="font-semibold text-gray-700 mb-1">Assigned Campaign</h3>
            {canAssignCampaign ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <select
                  value={assignCampaignId}
                  onChange={(e) => setAssignCampaignId(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Not assigned</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.title || c.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    if (!athlete?.id) return;
                    try {
                      setSavingCampaign(true);
                      await updateDoc(doc(db, "athletes", athlete.id), {
                        campaignId: assignCampaignId || null,
                        updatedAt: serverTimestamp(),
                      });
                    } catch (err) {
                      console.error("Failed to assign campaign:", err);
                    } finally {
                      setSavingCampaign(false);
                    }
                  }}
                  disabled={savingCampaign}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {savingCampaign ? "Saving..." : "Save"}
                </button>
              </div>
            ) : (
              <p className="text-gray-700">
                {assignedCampaign?.name || assignedCampaign?.title || "Not assigned"}
              </p>
            )}
            {isSelf && !athlete?.campaignId && (
              <p className="mt-2 text-xs text-amber-600">
                Your coach or admin needs to assign you to a campaign before you can send fundraising outreach.
              </p>
            )}
          </div>

          <div>
            <h3 className="font-semibold text-gray-700 mb-1">Organization</h3>
            <p>{athlete.orgName || "Unknown organization"}</p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-700 mb-1">Age</h3>
            <p>{athlete.age || "N/A"}</p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-700 mb-1">About</h3>
            <p className="text-gray-700">
              {athlete.bio || "No athlete bio available."}
            </p>
          </div>

          {goalAmount > 0 && (
            <div>
              <h3 className="font-semibold text-gray-700 mb-1">
                Recommended Goal
              </h3>
              <p>${goalAmount.toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>

      {/* Stats Section */}
      <div className="mt-8 md:mt-10 bg-white rounded-xl shadow p-4 md:p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <FaTrophy /> {isSelf ? "My Fundraising Progress" : "Performance / Stats"}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          {isSelf ? (
            <>
              <StatCard
                label="Personal Goal"
                value={goalAmount > 0 ? `$${goalAmount.toLocaleString()}` : "Not Set"}
              />
              <StatCard
                label="Raised So Far"
                value={`$${computedStats.totalRaised}`}
              />
              <StatCard
                label="Goal Progress"
                value={goalProgress == null ? "No Goal" : `${goalProgress}%`}
              />
            </>
          ) : (
            <>
              <StatCard label="Campaigns Participated" value={computedStats.campaignCount} />
              <StatCard label="Funds Raised" value={`$${computedStats.totalRaised}`} />
              <StatCard label="Supporters" value={computedStats.supporters} />
            </>
          )}
        </div>
      </div>

      {isSelf && (
        <div className="mt-8 md:mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {/* Invite Donors */}
          <div className="min-w-0 bg-white rounded-xl shadow p-4 md:p-6">
            <h2 className="text-xl font-semibold mb-2">Invite Donors</h2>
            <p className="text-sm text-gray-600 mb-4">
              Add supporter emails below, personalize the note, then send outreach. Use one email per line.
            </p>
            <textarea
              className="w-full min-h-[120px] rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder="supporter1@email.com&#10;supporter2@email.com"
              disabled={inviteLoading}
            />

            <label className="block text-sm font-medium text-gray-700 mt-4">
              Message (optional)
            </label>
            <textarea
              className="w-full min-h-[160px] rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
              value={inviteMessage}
              onChange={(e) => {
                setInviteMessage(e.target.value);
                setMessageDirty(true);
              }}
              placeholder="Add a personal note here..."
              disabled={inviteLoading || savingMessage}
            />

            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                className="rounded-md border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                disabled={savingMessage || inviteLoading}
                onClick={async () => {
                  if (!athlete?.id) return;
                  try {
                    setSavingMessage(true);
                    await updateDoc(doc(db, "athletes", athlete.id), {
                      inviteMessage: inviteMessage.trim(),
                      updatedAt: serverTimestamp(),
                    });
                    setMessageDirty(false);
                  } catch (err) {
                    console.error("Failed to save invite message:", err);
                  } finally {
                    setSavingMessage(false);
                  }
                }}
              >
                {savingMessage ? "Saving..." : "Save Message"}
              </button>

              <button
                className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                disabled={inviteLoading}
                onClick={async () => {
                  if (!athlete?.campaignId) {
                    alert("No campaign assigned to this athlete yet.");
                    return;
                  }
                  if (!inviteEmails.trim()) {
                    alert("Please enter at least one email address.");
                    return;
                  }
                  try {
                    setInviteLoading(true);
                    const fn = httpsCallable(functions, "sendDonorInvite");
                    await fn({
                      campaignId: athlete.campaignId,
                      athleteId: athlete.id,
                      emails: inviteEmails,
                      message: inviteMessage,
                    });
                    setInviteEmails("");
                  } catch (err) {
                    console.error("Failed to send donor invites:", err);
                    alert("Failed to send invites. Please try again.");
                  } finally {
                    setInviteLoading(false);
                  }
                }}
              >
                {inviteLoading ? "Sending..." : "Send Invites"}
              </button>
            </div>

            {donateLink && (
              <div className="mt-4 min-w-0 text-xs text-slate-500">
                Donation page:{" "}
                <a
                  className="inline-block max-w-full break-all text-blue-600 hover:underline"
                  href={donateLink}
                >
                  {donateLink}
                </a>
              </div>
            )}
          </div>

          {/* My Donors */}
          <div className="min-w-0 bg-white rounded-xl shadow p-4 md:p-6">
            <h2 className="text-xl font-semibold mb-2">My Donors</h2>
            <p className="text-sm text-gray-600 mb-4">
              Track who has already supported you. Total raised: ${totalRaisedDollars}
            </p>
            {athleteDonations.length === 0 ? (
              <p className="text-sm text-gray-500">
                No donations yet.
              </p>
            ) : (
              <div className="space-y-3">
                {athleteDonations.map((donor) => (
                  <div
                    key={donor.id}
                    className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium text-slate-800">
                        {donor.donorName || "Anonymous"}
                      </div>
                      <div className="text-xs text-slate-500">
                        {donor.createdAt?.toDate
                          ? donor.createdAt.toDate().toLocaleDateString()
                          : "Just now"}
                      </div>
                    </div>
                    <div className="font-semibold text-slate-700">
                      ${(Number(donor.amount || 0) / 100).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="p-4 bg-gray-50 border rounded-xl text-center">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-gray-600">{label}</div>
    </div>
  );
}
