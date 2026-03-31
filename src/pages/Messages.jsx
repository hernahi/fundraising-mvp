// src/pages/Messages.jsx
import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";
import ListLoadingSpinner from "../components/ListLoadingSpinner";
import ListEmptyState from "../components/ListEmptyState";
import AvatarCircle from "../components/AvatarCircle";

import { db, functions } from "../firebase/config";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "../firebase/firestore";

const DEFAULT_DONOR_INVITE_TEMPLATE = `Hi there,

{{athleteName}} is fundraising with {{teamName}} for {{campaignName}}.
Every gift helps cover the season and keeps the team strong.

{{personalMessage}}

Donate here: {{donateUrl}}

Thank you for supporting our community.`;

const TEMPLATE_OPTIONS = [
  { key: "week1a", label: "Week 1 (First) Message" },
  { key: "week1b", label: "Week 1 (Second) Message" },
  { key: "week2", label: "Week 2 Message" },
  { key: "week3", label: "Week 3 Message" },
  { key: "week4", label: "Week 4 Message" },
  { key: "week5", label: "Week 5 Message" },
  { key: "custom", label: "Custom Message" },
];

const PHASE_LABELS = TEMPLATE_OPTIONS.reduce((acc, item) => {
  acc[item.key] = item.label;
  return acc;
}, {});

const SUBJECTS_BY_TEMPLATE = {
  week1a: "Can you support our fundraiser?",
  week1b: "A quick note from our team",
  week2: "Thank you for supporting our season",
  week3: "We are getting closer to our goal",
  week4: "Last chance to support our fundraiser",
  week5: "Final week to support our fundraiser",
  lateIntro: "A personal fundraiser update from our team",
  custom: "Fundraiser update",
};

const DRIP_TEMPLATE_KEYS = TEMPLATE_OPTIONS.filter(
  (option) => option.key !== "custom"
).map((option) => option.key);

function buildDefaultWeekTemplates(baseTemplate) {
  const seed = String(baseTemplate || DEFAULT_DONOR_INVITE_TEMPLATE).trim();
  const templates = {};
  DRIP_TEMPLATE_KEYS.forEach((key) => {
    templates[key] = seed;
  });
  return templates;
}

const DEFAULT_WEEK_SUBJECTS = DRIP_TEMPLATE_KEYS.reduce((acc, key) => {
  acc[key] = SUBJECTS_BY_TEMPLATE[key] || "Fundraiser update";
  return acc;
}, {});

function getCoachScopedTeamIds(profile) {
  if (!profile) return [];
  const role = String(profile.role || "").toLowerCase();
  if (role !== "coach") return [];
  const fromArray = Array.isArray(profile.teamIds)
    ? profile.teamIds
    : Array.isArray(profile.assignedTeamIds)
      ? profile.assignedTeamIds
      : [];
  const normalized = fromArray
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const single = String(profile.teamId || "").trim();
  if (single) normalized.push(single);
  return Array.from(new Set(normalized));
}

export default function Messages() {
  const { profile, loading: authLoading } = useAuth();
  const role = (profile?.role || "").toLowerCase();
  const isAthlete = role === "athlete";
  const isCoach = role === "coach";
  const isAdmin = role === "admin" || role === "super-admin";
  const orgId = profile?.orgId || "";
  const athleteId = profile?.uid || "";
  const coachTeamIds = useMemo(() => getCoachScopedTeamIds(profile), [
    profile?.role,
    profile?.teamId,
    JSON.stringify(profile?.teamIds || profile?.assignedTeamIds || []),
  ]);

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");

  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [contactFilter, setContactFilter] = useState("all");
  const [editingContactId, setEditingContactId] = useState("");
  const [editingEmail, setEditingEmail] = useState("");

  const [orgTemplate, setOrgTemplate] = useState(
    DEFAULT_DONOR_INVITE_TEMPLATE
  );
  const [orgTemplateDraft, setOrgTemplateDraft] = useState(
    DEFAULT_DONOR_INVITE_TEMPLATE
  );
  const [orgTemplateDirty, setOrgTemplateDirty] = useState(false);
  const [savingOrgTemplate, setSavingOrgTemplate] = useState(false);
  const [orgWeekTemplates, setOrgWeekTemplates] = useState({});
  const [orgWeekDrafts, setOrgWeekDrafts] = useState({});
  const [orgWeekDirty, setOrgWeekDirty] = useState({});
  const [orgWeekSubjects, setOrgWeekSubjects] = useState({});
  const [orgWeekSubjectDrafts, setOrgWeekSubjectDrafts] = useState({});
  const [orgWeekSubjectDirty, setOrgWeekSubjectDirty] = useState({});
  const [orgTimeZone, setOrgTimeZone] = useState("");
  const [orgDripEnabled, setOrgDripEnabled] = useState(false);

  const [templateDraft, setTemplateDraft] = useState("");
  const [templateDirty, setTemplateDirty] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [personalNoteDraft, setPersonalNoteDraft] = useState("");
  const [personalNoteDirty, setPersonalNoteDirty] = useState(false);
  const [savingPersonalNote, setSavingPersonalNote] = useState(false);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("week1a");
  const [logChannelFilter, setLogChannelFilter] = useState("all");
  const [logWindowFilter, setLogWindowFilter] = useState("all");

  const [athleteRecord, setAthleteRecord] = useState(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [customSubject, setCustomSubject] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [customSendLoading, setCustomSendLoading] = useState(false);
  const [dedupeLoading, setDedupeLoading] = useState(false);
  const [orgAthletes, setOrgAthletes] = useState([]);
  const [testAthleteId, setTestAthleteId] = useState("");
  const [testPhase, setTestPhase] = useState("week1a");
  const [testEmail, setTestEmail] = useState("");
  const [testRecipientName, setTestRecipientName] = useState("");
  const [testPreviewLoading, setTestPreviewLoading] = useState(false);
  const [testSendLoading, setTestSendLoading] = useState(false);
  const [testPreviewData, setTestPreviewData] = useState(null);
  const [testStatus, setTestStatus] = useState("");

  useEffect(() => {
    if (authLoading || !profile?.orgId) return;

    const ref = collection(db, "messages");
    if (isAthlete) {
      const qRef = query(
        ref,
        where("orgId", "==", profile.orgId),
        where("athleteId", "==", athleteId),
        orderBy("createdAt", "desc")
      );
      const unsub = onSnapshot(
        qRef,
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }));
          setMessages(rows);
          setLoadingMessages(false);
          setLastUpdated(new Date().toLocaleTimeString());
        },
        (err) => {
          console.error("Messages listener error:", err);
          setLoadingMessages(false);
        }
      );
      return () => unsub();
    }

    if (isCoach) {
      if (coachTeamIds.length === 0) {
        setMessages([]);
        setLoadingMessages(false);
        return;
      }

      const chunkSize = 10;
      const chunks = [];
      for (let i = 0; i < coachTeamIds.length; i += chunkSize) {
        chunks.push(coachTeamIds.slice(i, i + chunkSize));
      }

      const rowsByChunk = new Map();

      const applyMerged = () => {
        const dedupe = new Map();
        rowsByChunk.forEach((rows) => {
          rows.forEach((row) => dedupe.set(row.id, row));
        });
        const merged = Array.from(dedupe.values()).sort((a, b) => {
          const aTime =
            a.createdAt?.toDate?.()?.getTime?.() ||
            (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const bTime =
            b.createdAt?.toDate?.()?.getTime?.() ||
            (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return bTime - aTime;
        });
        setMessages(merged);
        setLoadingMessages(false);
        setLastUpdated(new Date().toLocaleTimeString());
      };

      const unsubs = chunks.map((chunk, index) => {
        const teamConstraint =
          chunk.length === 1
            ? where("teamId", "==", chunk[0])
            : where("teamId", "in", chunk);
        const qRef = query(
          ref,
          where("orgId", "==", profile.orgId),
          teamConstraint,
          orderBy("createdAt", "desc")
        );
        return onSnapshot(
          qRef,
          (snap) => {
            rowsByChunk.set(
              index,
              snap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
              }))
            );
            applyMerged();
          },
          (err) => {
            console.error("Messages listener error:", err);
            setLoadingMessages(false);
          }
        );
      });

      return () => unsubs.forEach((unsub) => unsub());
    }

    const qRef = query(
      ref,
      where("orgId", "==", profile.orgId),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setMessages(rows);
        setLoadingMessages(false);
        setLastUpdated(new Date().toLocaleTimeString());
      },
      (err) => {
        console.error("Messages listener error:", err);
        setLoadingMessages(false);
      }
    );

    return () => unsub();
  }, [authLoading, athleteId, isAthlete, isCoach, profile, coachTeamIds]);

  useEffect(() => {
    if (!isAthlete || !orgId || !athleteId) return;

    const ref = collection(db, "athlete_contacts");
    const qRef = query(
      ref,
      where("orgId", "==", orgId),
      where("athleteId", "==", athleteId)
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
          const aTime =
            a.createdAt?.toDate?.()?.getTime?.() ||
            (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const bTime =
            b.createdAt?.toDate?.()?.getTime?.() ||
            (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return bTime - aTime;
        });
        setContacts(rows);
        setLoadingContacts(false);
      },
      (err) => {
        console.error("Contacts listener error:", err);
        setLoadingContacts(false);
      }
    );

    return () => unsub();
  }, [athleteId, isAthlete, orgId]);

  useEffect(() => {
    if (!orgId) return;

    const loadOrgTemplate = async () => {
      try {
        const snap = await getDoc(doc(db, "organizations", orgId));
        const orgData = snap.exists ? snap.data() || {} : {};
        const nextTemplate =
          orgData.donorInviteTemplate || DEFAULT_DONOR_INVITE_TEMPLATE;
        setOrgTemplate(nextTemplate);
        if (!orgTemplateDirty) {
          setOrgTemplateDraft(nextTemplate);
        }

        const nextWeekTemplates = {
          ...buildDefaultWeekTemplates(nextTemplate),
          ...(orgData.donorInviteTemplates || {}),
        };
        setOrgWeekTemplates(nextWeekTemplates);
        if (Object.keys(orgWeekDirty).length === 0) {
          setOrgWeekDrafts(nextWeekTemplates);
        }

        const nextWeekSubjects = {
          ...DEFAULT_WEEK_SUBJECTS,
          ...(orgData.donorInviteSubjects || {}),
        };
        setOrgWeekSubjects(nextWeekSubjects);
        if (Object.keys(orgWeekSubjectDirty).length === 0) {
          setOrgWeekSubjectDrafts(nextWeekSubjects);
        }

        setOrgTimeZone(
          orgData.orgTimeZone || orgData.timeZone || orgData.timezone || ""
        );
        setOrgDripEnabled(Boolean(orgData.dripGlobalEnabled));
      } catch (err) {
        console.error("Failed to load org template:", err);
      }
    };

    loadOrgTemplate();
  }, [orgId, orgTemplateDirty, orgWeekDirty]);

  useEffect(() => {
    if (!isAdmin || !orgId) {
      setOrgAthletes([]);
      return;
    }

    const loadOrgAthletes = async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "athletes"), where("orgId", "==", orgId))
        );
        const rows = snap.docs
          .map((entry) => ({ id: entry.id, ...entry.data() }))
          .sort((a, b) =>
            String(a.name || a.displayName || "").localeCompare(
              String(b.name || b.displayName || "")
            )
          );
        setOrgAthletes(rows);
        if (!testAthleteId && rows[0]?.id) {
          setTestAthleteId(rows[0].id);
        }
      } catch (err) {
        console.error("Failed to load org athletes for testing:", err);
      }
    };

    loadOrgAthletes();
  }, [isAdmin, orgId, testAthleteId]);

  useEffect(() => {
    if (!isAthlete || !athleteId) return;

    const loadAthlete = async () => {
      try {
        const snap = await getDoc(doc(db, "athletes", athleteId));
        if (snap.exists()) {
          setAthleteRecord({ id: snap.id, ...snap.data() });
        }
      } catch (err) {
        console.error("Failed to load athlete record:", err);
      }
    };

    loadAthlete();
  }, [athleteId, isAthlete]);

  useEffect(() => {
    if (!isAthlete) return;
    if (templateDirty) return;

    const personalTemplates = athleteRecord?.donorInviteTemplates || {};

    if (selectedTemplateKey === "custom") {
      setTemplateDraft("");
      return;
    }

    const fallbackTemplate =
      orgWeekTemplates[selectedTemplateKey] ||
      orgTemplate ||
      DEFAULT_DONOR_INVITE_TEMPLATE;

    const defaultTemplate =
      personalTemplates[selectedTemplateKey] || fallbackTemplate;

    setTemplateDraft(defaultTemplate);
  }, [
    athleteRecord,
    isAthlete,
    orgTemplate,
    orgWeekTemplates,
    selectedTemplateKey,
    templateDirty,
  ]);

  useEffect(() => {
    if (!isAthlete) return;
    if (personalNoteDirty) return;
    setPersonalNoteDraft(athleteRecord?.inviteMessage || "");
  }, [athleteRecord?.inviteMessage, isAthlete, personalNoteDirty]);

  const counts = useMemo(() => {
    const donated = contacts.filter((c) => c.status === "donated").length;
    const sent = contacts.filter((c) => c.status === "sent").length;
    const bounced = contacts.filter(
      (c) => c.status === "bounced" || c.status === "complained"
    ).length;
    return {
      total: contacts.length,
      donated,
      sent,
      bounced,
    };
  }, [contacts]);

  const canSend = counts.total >= 20 && !!athleteRecord?.campaignId;
  const isTestSend = counts.total < 20;

  const eligibleContacts = useMemo(
    () =>
      contacts.filter(
        (c) =>
          c.status !== "donated" &&
          c.status !== "bounced" &&
          c.status !== "complained"
      ),
    [contacts]
  );

  const selectedRecipients =
    selectedContactIds.length > 0
      ? eligibleContacts.filter((c) => selectedContactIds.includes(c.id))
      : eligibleContacts;

  const selectedRecipientSummary = useMemo(() => {
    if (selectedContactIds.length > 0) {
      return `${selectedRecipients.length} selected recipient${selectedRecipients.length === 1 ? "" : "s"}`;
    }
    return `${selectedRecipients.length} eligible recipient${selectedRecipients.length === 1 ? "" : "s"} (all)`;
  }, [selectedContactIds.length, selectedRecipients.length]);

  const customSenderLabel = useMemo(() => {
    const athleteName = String(
      athleteRecord?.name || athleteRecord?.displayName || profile?.displayName || "Your athlete"
    ).trim();
    const teamName = String(athleteRecord?.teamName || profile?.teamName || "").trim();
    if (athleteName && teamName) {
      return `${athleteName} via ${teamName}`;
    }
    if (athleteName) {
      return `${athleteName} via Fundraising MVP`;
    }
    return "Fundraising MVP";
  }, [
    athleteRecord?.displayName,
    athleteRecord?.name,
    athleteRecord?.teamName,
    profile?.displayName,
    profile?.teamName,
  ]);

  const correctedDraftContacts = useMemo(
    () =>
      contacts.filter(
        (c) =>
          c.status === "draft" &&
          (Boolean(c.correctedAt) ||
            Number(c.bounceCount || 0) > 0 ||
            c.lastDeliveryEvent === "bounced" ||
            c.lastDeliveryEvent === "failed" ||
            c.lastDeliveryEvent === "complained")
      ),
    [contacts]
  );

  const visibleContacts = useMemo(() => {
    if (contactFilter === "bounced") {
      return contacts.filter(
        (c) => c.status === "bounced" || c.status === "complained"
      );
    }

    if (contactFilter === "corrected") {
      return correctedDraftContacts;
    }

    return contacts;
  }, [contactFilter, contacts, correctedDraftContacts]);

  const visibleEligibleIds = useMemo(
    () =>
      visibleContacts
        .filter(
          (c) =>
            c.status !== "donated" &&
            c.status !== "bounced" &&
            c.status !== "complained"
        )
        .map((c) => c.id),
    [visibleContacts]
  );

  const dripLastPhase = athleteRecord?.drip?.lastPhaseSent || "";
  const dripNextPhase = athleteRecord?.drip?.nextPhase || "";
  const dripLastSentAt = athleteRecord?.drip?.lastSentAt?.toDate
    ? athleteRecord.drip.lastSentAt.toDate().toLocaleString()
    : "Not sent yet";
  const dripNextSendAt = athleteRecord?.drip?.nextSendAt?.toDate
    ? athleteRecord.drip.nextSendAt.toDate().toLocaleString()
    : "Not scheduled yet";

  const dripStatus = useMemo(() => {
    if (!athleteRecord?.campaignId) {
      return {
        label: "Needs campaign",
        className: "bg-amber-50 border border-amber-200 text-amber-700",
      };
    }

    if (counts.total < 20) {
      return {
        label: "Needs 20 contacts",
        className: "bg-amber-50 border border-amber-200 text-amber-700",
      };
    }

    if (!orgDripEnabled) {
      return {
        label: "Org paused",
        className: "bg-slate-50 border border-slate-200 text-slate-700",
      };
    }

    if (!athleteRecord?.drip?.autoSendEnabled) {
      return {
        label: "Paused (athlete)",
        className: "bg-slate-50 border border-slate-200 text-slate-700",
      };
    }

    return {
      label: "Active",
      className: "bg-emerald-50 border border-emerald-200 text-emerald-700",
    };
  }, [
    athleteRecord?.campaignId,
    athleteRecord?.drip?.autoSendEnabled,
    counts.total,
    orgDripEnabled,
  ]);
  const messageStats = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    let email = 0;
    let sms = 0;
    let week = 0;

    messages.forEach((m) => {
      const channel = String(m.channel || "").toLowerCase();
      if (channel === "email") email += 1;
      if (channel === "sms") sms += 1;

      const ts =
        m.createdAt?.toDate?.()?.getTime?.() ||
        (m.createdAt?.seconds ? m.createdAt.seconds * 1000 : 0);
      if (ts >= weekAgo) week += 1;
    });

    return {
      total: messages.length,
      email,
      sms,
      week,
    };
  }, [messages]);
  const athleteReadinessSteps = useMemo(
    () => [
      {
        key: "campaign",
        label: "Campaign assigned",
        done: Boolean(athleteRecord?.campaignId),
        detail: athleteRecord?.campaignId
          ? "Ready for fundraising outreach"
          : "Coach/admin still needs to assign a campaign",
        actionTo: athleteId ? `/athletes/${athleteId}` : "/athletes",
        actionLabel: "Review My Profile",
      },
      {
        key: "contacts",
        label: "Supporters added",
        done: counts.total >= 20,
        detail:
          counts.total >= 20
            ? `${counts.total} contacts ready`
            : `${counts.total}/20 contacts added`,
        actionTo: "#contacts",
        actionLabel: "Add Contacts",
      },
      {
        key: "outreach",
        label: "Outreach sent",
        done: messageStats.total > 0,
        detail:
          messageStats.total > 0
            ? `${messageStats.total} message${messageStats.total === 1 ? "" : "s"} sent`
            : "No outreach sent yet",
        actionTo: "#drip-campaign",
        actionLabel: "Send Message",
      },
    ],
    [athleteId, athleteRecord?.campaignId, counts.total, messageStats.total]
  );
  const readinessBlocker = useMemo(() => {
    if (!athleteRecord?.campaignId) {
      return {
        title: "You still need a campaign assignment",
        detail: "Your coach or admin must assign you to a campaign before you can start fundraising outreach.",
        actionLabel: "Review My Profile",
        actionTo: athleteId ? `/athletes/${athleteId}` : "/athletes",
        tone: "amber",
      };
    }

    if (counts.total < 20) {
      return {
        title: "You need more supporter contacts",
        detail: `Add ${20 - counts.total} more contact${20 - counts.total === 1 ? "" : "s"} so you are ready to start sending.`,
        actionLabel: "Add Contacts",
        actionTo: "#contacts",
        tone: "amber",
      };
    }

    if (messageStats.total === 0) {
      return {
        title: "You are ready to send your first message",
        detail: "Your campaign and supporter list are ready. Choose a template and send your first outreach message now.",
        actionLabel: "Send Message",
        actionTo: "#drip-campaign",
        tone: "blue",
      };
    }

    return {
      title: "Your fundraising setup is on track",
      detail: "Keep refining your supporter list, fixing bounced emails, and sending follow-up messages.",
      actionLabel: "Review Drip Campaign",
      actionTo: "#drip-campaign",
      tone: "green",
    };
  }, [athleteId, athleteRecord?.campaignId, counts.total, messageStats.total]);
  const readinessBlockerClasses =
    readinessBlocker.tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : readinessBlocker.tone === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-800"
      : "border-amber-200 bg-amber-50 text-amber-800";

  const filteredMessages = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    return messages.filter((m) => {
      const channel = String(m.channel || "").toLowerCase();
      const ts =
        m.createdAt?.toDate?.()?.getTime?.() ||
        (m.createdAt?.seconds ? m.createdAt.seconds * 1000 : 0);

      const channelOk =
        logChannelFilter === "all" || channel === logChannelFilter;
      const windowOk = logWindowFilter === "all" || ts >= weekAgo;

      return channelOk && windowOk;
    });
  }, [logChannelFilter, logWindowFilter, messages]);
  const athleteTemplatePreview = useMemo(() => {
    if (!isAthlete) return templateDraft;

    const athleteName =
      athleteRecord?.name || athleteRecord?.displayName || "Your athlete profile";
    const teamName = athleteRecord?.teamName || "your team";
    const campaignName = athleteRecord?.campaignName || "your fundraiser";
    const donateUrl =
      athleteRecord?.campaignId && athleteId
        ? `${window.location.origin}/donate/${athleteRecord.campaignId}/athlete/${athleteId}`
        : "";
    let preview = templateDraft
      .replace(/{{\s*athleteName\s*}}/g, athleteName)
      .replace(/{{\s*ATHLETE_NAME\s*}}/g, athleteName)
      .replace(/{{\s*senderName\s*}}/g, athleteName)
      .replace(/{{\s*SENDER_NAME\s*}}/g, athleteName)
      .replace(/{{\s*teamName\s*}}/g, teamName)
      .replace(/{{\s*TEAM_NAME\s*}}/g, teamName)
      .replace(/{{\s*campaignName\s*}}/g, campaignName)
      .replace(/{{\s*CAMPAIGN_NAME\s*}}/g, campaignName)
      .replace(/{{\s*donateUrl\s*}}/g, donateUrl)
      .replace(/{{\s*DONATION_LINK\s*}}/g, donateUrl)
      .replace(/{{\s*donationLink\s*}}/g, donateUrl)
      .replace(/{{\s*personalMessage\s*}}/g, personalNoteDraft.trim());
      preview = preview.replace(/{{\s*PERSONAL_MESSAGE\s*}}/g, personalNoteDraft.trim());

    if (
      !/{{\s*(personalMessage|PERSONAL_MESSAGE)\s*}}/.test(templateDraft) &&
      personalNoteDraft.trim()
    ) {
      preview = `${preview}\n\n${personalNoteDraft.trim()}`;
    }

    if (
      !/{{\s*(donateUrl|DONATION_LINK|donationLink)\s*}}/.test(templateDraft) &&
      donateUrl
    ) {
      preview = `${preview}\n\nDonate here: ${donateUrl}`;
    }

    return preview.replace(/\n{3,}/g, "\n\n").trim();
  }, [
    athleteId,
    athleteRecord?.campaignId,
    athleteRecord?.campaignName,
    athleteRecord?.displayName,
    athleteRecord?.name,
    athleteRecord?.teamName,
    isAthlete,
    personalNoteDraft,
    templateDraft,
  ]);
  const testPhaseOptions = useMemo(
    () => [...TEMPLATE_OPTIONS.filter((option) => option.key !== "custom"), { key: "lateIntro", label: "Late Contact Intro" }],
    []
  );

  const addContact = async () => {
    const name = contactName.trim();
    const email = contactEmail.trim().toLowerCase();

    if (!email) {
      alert("Please enter an email address.");
      return;
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      alert("Please enter a valid email address.");
      return;
    }

    try {
      const joinedAfterPhase = athleteRecord?.drip?.lastPhaseSent || "";
      await addDoc(collection(db, "athlete_contacts"), {
        orgId,
        athleteId,
        name,
        email,
        emailLower: email,
        status: "draft",
        lateIntroPending: Boolean(joinedAfterPhase),
        joinedAfterPhase: joinedAfterPhase || null,
        createdAt: serverTimestamp(),
      });
      setContactName("");
      setContactEmail("");
    } catch (err) {
      console.error("Failed to add contact:", err);
      alert("Failed to add contact. Please try again.");
    }
  };

  const dedupeContacts = async () => {
    if (!contacts.length) return;
    setDedupeLoading(true);

    try {
      const grouped = new Map();

      contacts.forEach((contact) => {
        const key =
          contact.emailLower ||
          (contact.email ? contact.email.toLowerCase() : "");
        if (!key) return;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(contact);
      });

      const batch = writeBatch(db);
      let deletes = 0;

      grouped.forEach((group) => {
        if (group.length < 2) return;
        const sorted = [...group].sort((a, b) => {
          const aTime =
            a.createdAt?.toDate?.()?.getTime?.() ||
            (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const bTime =
            b.createdAt?.toDate?.()?.getTime?.() ||
            (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return bTime - aTime;
        });

        sorted.slice(1).forEach((dup) => {
          batch.delete(doc(db, "athlete_contacts", dup.id));
          deletes += 1;
        });
      });

      if (deletes > 0) {
        await batch.commit();
      }
    } catch (err) {
      console.error("Failed to de-duplicate contacts:", err);
      alert("Failed to de-duplicate contacts. Please try again.");
    } finally {
      setDedupeLoading(false);
    }
  };

  const removeContact = async (contactId) => {
    if (!contactId) return;
    try {
      await deleteDoc(doc(db, "athlete_contacts", contactId));
    } catch (err) {
      console.error("Failed to delete contact:", err);
    }
  };

  const saveContactEmail = async (contact) => {
    const nextEmail = editingEmail.trim().toLowerCase();
    if (!nextEmail) {
      alert("Please enter an email address.");
      return;
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail);
    if (!emailOk) {
      alert("Please enter a valid email address.");
      return;
    }

    try {
      await updateDoc(doc(db, "athlete_contacts", contact.id), {
        email: nextEmail,
        emailLower: nextEmail,
        status: "draft",
        deliveryStatus: "corrected",
        correctedAt: serverTimestamp(),
        correctedFromEmail: contact.email || "",
        lastDeliveryError: "",
        updatedAt: serverTimestamp(),
      });
      setEditingContactId("");
      setEditingEmail("");
    } catch (err) {
      console.error("Failed to update contact email:", err);
      alert("Failed to update email. Please try again.");
    }
  };

  const saveTemplate = async () => {
    if (!athleteId || selectedTemplateKey === "custom") return;
    try {
      setSavingTemplate(true);
      await updateDoc(doc(db, "athletes", athleteId), {
        donorInviteTemplates: {
          ...(athleteRecord?.donorInviteTemplates || {}),
          [selectedTemplateKey]: templateDraft.trim(),
        },
        updatedAt: serverTimestamp(),
      });
      setTemplateDirty(false);
    } catch (err) {
      console.error("Failed to save template:", err);
    } finally {
      setSavingTemplate(false);
    }
  };

  const savePersonalNote = async () => {
    if (!athleteId) return;
    try {
      setSavingPersonalNote(true);
      await updateDoc(doc(db, "athletes", athleteId), {
        inviteMessage: personalNoteDraft.trim(),
        updatedAt: serverTimestamp(),
      });
      setPersonalNoteDirty(false);
    } catch (err) {
      console.error("Failed to save personal note:", err);
      alert("Failed to save your note. Please try again.");
    } finally {
      setSavingPersonalNote(false);
    }
  };

  const saveOrgTemplate = async () => {
    if (!orgId) return;
    try {
      setSavingOrgTemplate(true);
      await updateDoc(doc(db, "organizations", orgId), {
        donorInviteTemplate: orgTemplateDraft.trim(),
        donorInviteTemplates: {
          ...orgWeekDrafts,
        },
        donorInviteSubjects: {
          ...orgWeekSubjectDrafts,
        },
        updatedAt: serverTimestamp(),
      });
      setOrgTemplate(orgTemplateDraft.trim());
      setOrgWeekTemplates({ ...orgWeekDrafts });
      setOrgWeekSubjects({ ...orgWeekSubjectDrafts });
      setOrgTemplateDirty(false);
      setOrgWeekDirty({});
      setOrgWeekSubjectDirty({});
    } catch (err) {
      console.error("Failed to save org template:", err);
      alert("Failed to save org template. Please try again.");
    } finally {
      setSavingOrgTemplate(false);
    }
  };

  const resetTemplate = async () => {
    const nextTemplate =
      selectedTemplateKey === "custom"
        ? ""
        : orgWeekTemplates[selectedTemplateKey] ||
          orgTemplate ||
          DEFAULT_DONOR_INVITE_TEMPLATE;
    setTemplateDraft(nextTemplate);
    setTemplateDirty(true);
  };

  const runTestPreview = async () => {
    if (!testAthleteId) {
      setTestStatus("Choose an athlete first.");
      return;
    }

    try {
      setTestPreviewLoading(true);
      setTestStatus("");
      const fn = httpsCallable(functions, "previewDripTemplate");
      const response = await fn({
        athleteId: testAthleteId,
        phase: testPhase,
        recipientName: testRecipientName.trim(),
      });
      setTestPreviewData(response?.data || null);
      setTestStatus("Preview loaded.");
    } catch (err) {
      console.error("Failed to preview drip template:", err);
      setTestStatus(err?.message || "Failed to load preview.");
    } finally {
      setTestPreviewLoading(false);
    }
  };

  const runTestSend = async () => {
    if (!testAthleteId || !testEmail.trim()) {
      setTestStatus("Choose an athlete and enter a test email.");
      return;
    }

    try {
      setTestSendLoading(true);
      setTestStatus("");
      const fn = httpsCallable(functions, "sendTestDripEmail");
      const response = await fn({
        athleteId: testAthleteId,
        phase: testPhase,
        toEmail: testEmail.trim(),
        recipientName: testRecipientName.trim(),
      });
      setTestPreviewData(response?.data || testPreviewData);
      setTestStatus(`Test email sent to ${testEmail.trim()}.`);
    } catch (err) {
      console.error("Failed to send test drip email:", err);
      setTestStatus(err?.message || "Failed to send test email.");
    } finally {
      setTestSendLoading(false);
    }
  };

  const sendDrip = async (templateKey) => {
    if (!athleteRecord?.campaignId) {
      alert("No campaign assigned to this athlete yet.");
      return;
    }

    if (selectedRecipients.length === 0) {
      alert("No eligible contacts to send.");
      return;
    }

    if (isTestSend && selectedRecipients.length > 3) {
      alert("Test sends are limited to 3 recipients until you have 20 contacts.");
      return;
    }

    if (!canSend && !isTestSend) {
      alert("Add at least 20 contacts before starting the drip campaign.");
      return;
    }

    const contactIds = selectedRecipients.map((c) => c.id);
    const subject =
      orgWeekSubjects[templateKey] ||
      SUBJECTS_BY_TEMPLATE[templateKey] ||
      "Fundraiser update";

    try {
      setSendLoading(true);
      const fn = httpsCallable(functions, "sendAthleteDripMessage");
      const response = await fn({
        campaignId: athleteRecord.campaignId,
        athleteId,
        contactIds,
        template: templateDraft,
        subject,
        phase: templateKey,
      });

      const sent = Number(response?.data?.sent || 0);
      const failed = Number(response?.data?.failed || 0);
      if (sent > 0 && failed > 0) {
        alert(`Sent to ${sent} recipient(s). ${failed} failed.`);
      } else if (sent > 0) {
        alert(`Sent to ${sent} recipient(s).`);
      }
    } catch (err) {
      console.error("Failed to send drip message:", err);
      alert(err?.message || "Failed to send messages. Please try again.");
    } finally {
      setSendLoading(false);
    }
  };

  const sendCustomMessage = async () => {
    if (!isAthlete) {
      return;
    }

    if (selectedRecipients.length === 0) {
      alert("No eligible contacts to send.");
      return;
    }

    if (!customSubject.trim()) {
      alert("Add a subject before sending.");
      return;
    }

    if (!customBody.trim()) {
      alert("Add a message before sending.");
      return;
    }

    const contactIds = selectedRecipients.map((contact) => contact.id);

    try {
      setCustomSendLoading(true);
      const fn = httpsCallable(functions, "sendAthleteCustomMessage");
      const response = await fn({
        athleteId,
        campaignId: athleteRecord?.campaignId || null,
        contactIds,
        subject: customSubject.trim(),
        body: customBody.trim(),
      });

      const sent = Number(response?.data?.sent || 0);
      const failed = Number(response?.data?.failed || 0);
      if (sent > 0 && failed > 0) {
        alert(`Custom message sent to ${sent} recipient(s). ${failed} failed.`);
      } else if (sent > 0) {
        alert(`Custom message sent to ${sent} recipient(s).`);
      }
    } catch (err) {
      console.error("Failed to send custom message:", err);
      alert(err?.message || "Failed to send your custom message. Please try again.");
    } finally {
      setCustomSendLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="p-6">
        <ListLoadingSpinner />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-6 md:space-y-7">
      <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
            Messages
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage outreach templates, contacts, and drip sends.
          </p>
        </div>
        {lastUpdated ? (
          <div className="text-xs text-slate-400">
            Last synced: {lastUpdated}
          </div>
        ) : null}
      </div>

      {isAthlete && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:p-5 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">
                Fundraising Setup
              </h2>
              <p className="text-sm text-slate-500">
                Work top to bottom so you do not get stuck: campaign, contacts, then outreach.
              </p>
            </div>
            <Link
              to={athleteId ? `/athletes/${athleteId}` : "/athletes"}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open My Athlete Page
            </Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {athleteReadinessSteps.map((step) => (
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
                {step.actionTo.startsWith("#") ? (
                  <a
                    href={step.actionTo}
                    className="mt-3 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {step.actionLabel}
                  </a>
                ) : (
                  <Link
                    to={step.actionTo}
                    className="mt-3 inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {step.actionLabel}
                  </Link>
                )}
              </div>
            ))}
          </div>
          <div className={`mt-4 rounded-lg border px-4 py-3 ${readinessBlockerClasses}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">{readinessBlocker.title}</div>
                <p className="mt-1 text-xs opacity-90">{readinessBlocker.detail}</p>
              </div>
              {readinessBlocker.actionTo.startsWith("#") ? (
                <a
                  href={readinessBlocker.actionTo}
                  className="inline-flex items-center justify-center rounded-md border border-current/20 bg-white px-3 py-2 text-xs font-semibold hover:bg-white/80"
                >
                  {readinessBlocker.actionLabel}
                </a>
              ) : (
                <Link
                  to={readinessBlocker.actionTo}
                  className="inline-flex items-center justify-center rounded-md border border-current/20 bg-white px-3 py-2 text-xs font-semibold hover:bg-white/80"
                >
                  {readinessBlocker.actionLabel}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 px-3 py-3 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Total Messages
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-800">
            {messageStats.total}
          </div>
        </div>
        <div className="rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 px-3 py-3 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Email
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-800">
            {messageStats.email}
          </div>
        </div>
        <div className="rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 px-3 py-3 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            SMS
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-800">
            {messageStats.sms}
          </div>
        </div>
        <div className="rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 px-3 py-3 shadow-sm">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Last 7 Days
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-800">
            {messageStats.week}
          </div>
        </div>
      </div>

      {(isCoach || isAdmin) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
          {isAdmin && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">
                  Drip Template Testing
                </h2>
                <p className="text-sm text-slate-500">
                  Preview or send a test drip email without advancing campaign state.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Athlete
                  </label>
                  <select
                    value={testAthleteId}
                    onChange={(e) => setTestAthleteId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="">Select athlete</option>
                    {orgAthletes.map((athlete) => (
                      <option key={athlete.id} value={athlete.id}>
                        {athlete.name || athlete.displayName || athlete.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Phase
                  </label>
                  <select
                    value={testPhase}
                    onChange={(e) => setTestPhase(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {testPhaseOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Test Email
                  </label>
                  <input
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    type="email"
                    placeholder="you@example.com"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Recipient Name (optional)
                  </label>
                  <input
                    value={testRecipientName}
                    onChange={(e) => setTestRecipientName(e.target.value)}
                    type="text"
                    placeholder="Jamie Smith"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={runTestPreview}
                  disabled={testPreviewLoading}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {testPreviewLoading ? "Loading Preview..." : "Preview Render"}
                </button>
                <button
                  type="button"
                  onClick={runTestSend}
                  disabled={testSendLoading}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {testSendLoading ? "Sending Test..." : "Send Test Email"}
                </button>
              </div>

              {testStatus ? (
                <div className="text-xs text-slate-500">{testStatus}</div>
              ) : null}

              {testPreviewData ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                  <div className="text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">Athlete:</span> {testPreviewData.athleteName}{" "}
                    <span className="font-semibold text-slate-700">• Team:</span> {testPreviewData.teamName}{" "}
                    <span className="font-semibold text-slate-700">• Phase:</span> {PHASE_LABELS[testPreviewData.phase] || testPreviewData.phase}
                    {testPreviewData.recipientName ? (
                      <>
                        {" "}
                        <span className="font-semibold text-slate-700">• Recipient:</span> {testPreviewData.recipientName}
                      </>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Subject</div>
                    <div className="mt-1 text-sm font-medium text-slate-800">
                      {testPreviewData.subject}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Resolved Body</div>
                    <pre className="mt-1 whitespace-pre-wrap text-sm text-slate-700 font-sans">
                      {testPreviewData.bodyText}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              Org Invite Template
            </h2>
            <p className="text-sm text-slate-500">
              Coaches can customize the boilerplate used by athletes.
            </p>
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Default Template (fallback)
            </label>
            <textarea
              value={orgTemplateDraft}
              onChange={(e) => {
                setOrgTemplateDraft(e.target.value);
                setOrgTemplateDirty(true);
              }}
              rows={8}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {TEMPLATE_OPTIONS.filter((opt) => opt.key !== "custom").map(
              (option) => (
                <div key={option.key}>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    {option.label}
                  </label>
                  <input
                    value={orgWeekSubjectDrafts[option.key] || ""}
                    onChange={(e) => {
                      setOrgWeekSubjectDrafts((prev) => ({
                        ...prev,
                        [option.key]: e.target.value,
                      }));
                      setOrgWeekSubjectDirty((prev) => ({
                        ...prev,
                        [option.key]: true,
                      }));
                    }}
                    placeholder={
                      SUBJECTS_BY_TEMPLATE[option.key] || "Subject"
                    }
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  />
                  <textarea
                    value={orgWeekDrafts[option.key] || ""}
                    onChange={(e) => {
                      setOrgWeekDrafts((prev) => ({
                        ...prev,
                        [option.key]: e.target.value,
                      }));
                      setOrgWeekDirty((prev) => ({
                        ...prev,
                        [option.key]: true,
                      }));
                    }}
                    rows={6}
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  />
                </div>
              )
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={saveOrgTemplate}
              disabled={
                savingOrgTemplate ||
                (!orgTemplateDirty &&
                  Object.keys(orgWeekDirty).length === 0 &&
                  Object.keys(orgWeekSubjectDirty).length === 0)
              }
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {savingOrgTemplate ? "Saving..." : "Save Org Template"}
            </button>
          </div>
        </div>
      )}

      {isAthlete && (
        <div className="grid gap-6 md:gap-7 lg:grid-cols-[1.2fr_1fr]">
          <div className="min-w-0 space-y-6">
            <div id="contacts" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">
                    Contacts
                  </h2>
                  <p className="text-sm text-slate-500">
                    Start here: add supporter contacts, clean up bounced emails, then send outreach.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:gap-3 sm:justify-end">
                  <select
                    value={contactFilter}
                    onChange={(e) => setContactFilter(e.target.value)}
                    className="w-full sm:w-auto rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700"
                  >
                    <option value="all">All contacts</option>
                    <option value="bounced">Bounced only</option>
                    <option value="corrected">Corrected drafts</option>
                  </select>
                  <button
                    type="button"
                    onClick={dedupeContacts}
                    disabled={dedupeLoading || contacts.length < 2}
                    className="whitespace-nowrap rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-600 hover:text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {dedupeLoading ? "De-duplicating..." : "De-duplicate"}
                  </button>
                  <div className="rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-700">
                    {counts.total}/20
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] md:grid-cols-[1fr_1.2fr_auto]">
                <input
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="Name (optional)"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="Email address"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={addContact}
                  className="w-full sm:w-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Add
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 text-sm text-slate-600">
                <div>
                  <div className="text-xs uppercase text-slate-400">
                    Sent
                  </div>
                  <div className="font-semibold text-slate-800">
                    {counts.sent}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-400">
                    Donated
                  </div>
                  <div className="font-semibold text-slate-800">
                    {counts.donated}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-400">
                    Eligible
                  </div>
                  <div className="font-semibold text-slate-800">
                    {eligibleContacts.length}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-400">
                    Bounced
                  </div>
                  <div className="font-semibold text-red-600">
                    {counts.bounced}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-400">
                    Selected
                  </div>
                  <div className="font-semibold text-slate-800">
                    {selectedContactIds.length}
                  </div>
                </div>
              </div>

              {loadingContacts ? (
                <div className="mt-4">
                  <ListLoadingSpinner />
                </div>
              ) : contacts.length === 0 ? (
                <div className="mt-4 text-sm text-slate-500">
                  No contacts yet.
                </div>
              ) : (
                <div className="mt-4">
                  {counts.bounced > 0 && (
                    <p className="mb-2 text-xs text-amber-700">
                      {counts.bounced} address(es) bounced. Remove and re-add with the corrected email before sending again.
                    </p>
                  )}
                  {contactFilter !== "all" && visibleContacts.length === 0 && (
                    <p className="mb-2 text-xs text-slate-500">
                      No contacts match the selected filter.
                    </p>
                  )}
                  <div className="lg:hidden space-y-3">
                    <label className="mb-2 inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={
                          visibleEligibleIds.length > 0 &&
                          visibleEligibleIds.every((id) =>
                            selectedContactIds.includes(id)
                          )
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedContactIds((prev) =>
                              Array.from(new Set([...prev, ...visibleEligibleIds]))
                            );
                          } else {
                            setSelectedContactIds((prev) =>
                              prev.filter((id) => !visibleEligibleIds.includes(id))
                            );
                          }
                        }}
                      />
                      Select all visible eligible contacts
                    </label>
                    {visibleContacts.map((contact) => (
                      <div
                        key={contact.id}
                        className="rounded-lg border border-slate-200 bg-white p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800">
                              {contact.name || "Supporter"}
                            </div>
                            {editingContactId === contact.id ? (
                              <input
                                value={editingEmail}
                                onChange={(e) => setEditingEmail(e.target.value)}
                                className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700"
                              />
                            ) : (
                              <div className="text-xs text-slate-500 break-all">
                                {contact.email}
                              </div>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            checked={selectedContactIds.includes(contact.id)}
                            disabled={
                              contact.status === "donated" ||
                              contact.status === "bounced" ||
                              contact.status === "complained"
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedContactIds((prev) => [
                                  ...prev,
                                  contact.id,
                                ]);
                              } else {
                                setSelectedContactIds((prev) =>
                                  prev.filter((id) => id !== contact.id)
                                );
                              }
                            }}
                          />
                        </div>
                        <div className="mt-2 text-xs">
                          <span className="font-medium text-slate-600">Status: </span>
                          <span className="text-slate-700">
                            {contact.status === "bounced" ||
                            contact.status === "complained"
                              ? "bounced - update email"
                              : contact.status || "draft"}
                          </span>
                          {contact.lastDeliveryError ? (
                            <div className="mt-1 text-[11px] text-red-600 break-words">
                              {String(contact.lastDeliveryError).slice(0, 120)}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Last sent:{" "}
                          {contact.lastSentAt?.toDate
                            ? contact.lastSentAt.toDate().toLocaleString()
                            : "N/A"}
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2">
                          {(contact.status === "bounced" ||
                            contact.status === "complained" ||
                            editingContactId === contact.id) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (editingContactId === contact.id) {
                                  saveContactEmail(contact);
                                  return;
                                }
                                setEditingContactId(contact.id);
                                setEditingEmail(contact.email || "");
                              }}
                              className="w-full rounded border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700"
                            >
                              {editingContactId === contact.id ? "Save" : "Edit"}
                            </button>
                          )}
                          {editingContactId === contact.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingContactId("");
                                setEditingEmail("");
                              }}
                              className="w-full rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeContact(contact.id)}
                            className="w-full rounded border border-red-200 px-3 py-2 text-xs font-semibold text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden lg:block overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">
                            <input
                              type="checkbox"
                              checked={
                                visibleEligibleIds.length > 0 &&
                                visibleEligibleIds.every((id) =>
                                  selectedContactIds.includes(id)
                                )
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedContactIds((prev) =>
                                    Array.from(
                                      new Set([...prev, ...visibleEligibleIds])
                                    )
                                  );
                                } else {
                                  setSelectedContactIds((prev) =>
                                    prev.filter(
                                      (id) => !visibleEligibleIds.includes(id)
                                    )
                                  );
                                }
                              }}
                            />
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Contact
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Status
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            Last Sent
                          </th>
                          <th className="px-3 py-2 text-right font-medium">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleContacts.map((contact) => (
                          <tr
                            key={contact.id}
                            className="border-t border-slate-100"
                          >
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                checked={selectedContactIds.includes(contact.id)}
                                disabled={
                                  contact.status === "donated" ||
                                  contact.status === "bounced" ||
                                  contact.status === "complained"
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedContactIds((prev) => [
                                      ...prev,
                                      contact.id,
                                    ]);
                                  } else {
                                    setSelectedContactIds((prev) =>
                                      prev.filter((id) => id !== contact.id)
                                    );
                                  }
                                }}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">
                                {contact.name || "Supporter"}
                              </div>
                              {editingContactId === contact.id ? (
                                <input
                                  value={editingEmail}
                                  onChange={(e) => setEditingEmail(e.target.value)}
                                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700"
                                />
                              ) : (
                                <div className="text-xs text-slate-500">
                                  {contact.email}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {contact.status === "bounced" ||
                              contact.status === "complained"
                                ? "bounced - update email"
                                : contact.status || "draft"}
                              {contact.lastDeliveryError ? (
                                <div className="text-[11px] text-red-600 mt-1 break-words">
                                  {String(contact.lastDeliveryError).slice(0, 120)}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-slate-600">
                              {contact.lastSentAt?.toDate
                                ? contact.lastSentAt.toDate().toLocaleString()
                                : "N/A"}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex items-center gap-2">
                                {(contact.status === "bounced" ||
                                  contact.status === "complained" ||
                                  editingContactId === contact.id) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (editingContactId === contact.id) {
                                        saveContactEmail(contact);
                                        return;
                                      }
                                      setEditingContactId(contact.id);
                                      setEditingEmail(contact.email || "");
                                    }}
                                    className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                                  >
                                    {editingContactId === contact.id ? "Save" : "Edit"}
                                  </button>
                                )}
                                {editingContactId === contact.id && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingContactId("");
                                      setEditingEmail("");
                                    }}
                                    className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                                  >
                                    Cancel
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeContact(contact.id)}
                                  className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
                                >
                                  Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div id="drip-campaign" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">
                    Invite Message
                  </h2>
                  <p className="text-sm text-slate-500">
                    The campaign message stays consistent across the team. Add a short personal note if you want to make it feel more personal for friends and family.
                  </p>
                  {isAthlete && (
                    <p className="mt-1 text-xs text-slate-500">
                      How this works: 1) choose the phase template, 2) add your optional note, 3) review the final preview below, 4) save your note.
                    </p>
                  )}
                </div>
                {!isAthlete && (
                  <button
                    type="button"
                    onClick={resetTemplate}
                    className="w-full sm:w-auto rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:text-slate-700 hover:bg-slate-50"
                  >
                    Use org template
                  </button>
                )}
              </div>

              <div className="mt-4">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  Template
                </label>
                <select
                  value={selectedTemplateKey}
                  onChange={(e) => {
                    setSelectedTemplateKey(e.target.value);
                    setTemplateDirty(false);
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  {TEMPLATE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {isAthlete ? (
                <>
                  <div className="mt-4">
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Personal Note (Optional)
                    </label>
                    <textarea
                      value={personalNoteDraft}
                      onChange={(e) => {
                        setPersonalNoteDraft(e.target.value);
                        setPersonalNoteDirty(true);
                      }}
                      rows={4}
                      maxLength={280}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      placeholder="Add a short personal note for family, friends, or close supporters."
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      This note is appended to the team message. It is for friendly context, not for rewriting the main campaign content.
                    </p>
                  </div>

                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-slate-400">
                      Final Email Preview (Base Message + Your Personal Note)
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap break-words break-all text-sm text-slate-700 font-sans">
                      {athleteTemplatePreview}
                    </pre>
                  </div>

                  <div className="mt-3 flex justify-stretch sm:justify-end">
                    <button
                      type="button"
                      onClick={savePersonalNote}
                      disabled={savingPersonalNote}
                      className="w-full sm:w-auto rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {savingPersonalNote ? "Saving..." : "Save Personal Note"}
                    </button>
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-4">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold text-slate-800">
                        Send One-Off Custom Message
                      </h3>
                      <p className="text-xs text-slate-500">
                        Use this for a personal update outside the regular drip. Pick one recipient, several, or leave the contact list unselected to send to all eligible contacts.
                      </p>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                        <div className="font-semibold text-slate-700">
                          Sending as
                        </div>
                        <p className="mt-1">
                          {customSenderLabel}
                        </p>
                        <p className="mt-2 text-slate-500">
                          Delivered from the platform's authenticated no-reply email to protect deliverability.
                        </p>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                        <div className="font-semibold text-slate-700">
                          Recipients
                        </div>
                        <p className="mt-1">{selectedRecipientSummary}</p>
                        <p className="mt-2 text-slate-500">
                          Check contacts above to target a single person or a smaller group.
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="text-xs uppercase tracking-wide text-slate-400">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={customSubject}
                        onChange={(e) => setCustomSubject(e.target.value)}
                        maxLength={140}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        placeholder="Quick update from me"
                      />
                    </div>

                    <div className="mt-4">
                      <label className="text-xs uppercase tracking-wide text-slate-400">
                        Message
                      </label>
                      <textarea
                        value={customBody}
                        onChange={(e) => setCustomBody(e.target.value)}
                        rows={6}
                        maxLength={5000}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        placeholder="Write a short personal update. You can optionally use {{recipientFirstName}} for a friendlier greeting."
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        Keep it short and personal. Plain-language emails generally perform better than heavily formatted messages.
                      </p>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-slate-500">
                        This sends immediately to {selectedRecipientSummary.toLowerCase()}.
                      </p>
                      <button
                        type="button"
                        onClick={sendCustomMessage}
                        disabled={
                          customSendLoading ||
                          !customSubject.trim() ||
                          !customBody.trim() ||
                          selectedRecipients.length === 0
                        }
                        className="w-full sm:w-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        {customSendLoading ? "Sending..." : "Send Custom Message"}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <textarea
                    value={templateDraft}
                    onChange={(e) => {
                      setTemplateDraft(e.target.value);
                      setTemplateDirty(true);
                    }}
                    rows={10}
                    className="mt-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  />

                  <div className="mt-3 flex justify-stretch sm:justify-end">
                    <button
                      type="button"
                      onClick={saveTemplate}
                      disabled={savingTemplate || selectedTemplateKey === "custom"}
                      className="w-full sm:w-auto rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {savingTemplate ? "Saving..." : "Save Template"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-6">
            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-slate-800">
                  Campaign Automation
                </h2>
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${dripStatus.className}`}
                >
                  {dripStatus.label}
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Once your campaign is assigned and you have at least 20 eligible contacts, the system handles the outreach cadence for you.
              </p>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Auto-send at 6:30 PM
                    </p>
                    <p className="text-xs text-slate-500">
                      {orgTimeZone
                        ? `Org time zone: ${orgTimeZone}. Auto-send starts after 20 eligible contacts.`
                        : "Org time zone not set yet. Auto-send starts after 20 eligible contacts."}
                    </p>
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Next send: {dripNextSendAt}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  New contacts added after outreach has started receive one catch-up intro email, then join the next scheduled drip phase.
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs text-slate-600">
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <span className="text-slate-400">Last sent phase: </span>
                    <span className="font-medium text-slate-700">
                      {PHASE_LABELS[dripLastPhase] || "None yet"}
                    </span>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <span className="text-slate-400">Next phase: </span>
                    <span className="font-medium text-slate-700">
                      {PHASE_LABELS[dripNextPhase] || "Pending schedule"}
                    </span>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 sm:col-span-2">
                    <span className="text-slate-400">Last sent at: </span>
                    <span className="font-medium text-slate-700">
                      {dripLastSentAt}
                    </span>
                  </div>
                </div>

                {!orgDripEnabled && (
                  <p className="mt-2 text-xs text-amber-600">
                    Org auto-send is paused. Turn it on in Settings when ready.
                  </p>
                )}
                {correctedDraftContacts.length > 0 && (
                  <p className="mt-2 text-xs text-blue-600">
                    {correctedDraftContacts.length} corrected contact{correctedDraftContacts.length === 1 ? "" : "s"} will be included automatically in upcoming sends.
                  </p>
                )}
              </div>

              {!athleteRecord?.campaignId && (
                <p className="mt-3 text-xs text-amber-600">
                  Assign a campaign before starting the drip.
                </p>
              )}

              {counts.total < 20 && (
                <p className="mt-3 text-xs text-amber-600">
                  Add at least 20 eligible contacts before auto-send will start. Test sends are limited to 3 recipients.
                </p>
              )}

              {isAthlete && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
                  Recommended flow: add contacts, fix any bounced emails, and let automation handle the drip once you meet the minimum requirements.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Message Log</h2>
            <p className="text-sm text-slate-500">
              Review sent outreach across your current scope.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setLogChannelFilter("all")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                logChannelFilter === "all"
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setLogChannelFilter("email")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                logChannelFilter === "email"
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => setLogChannelFilter("sms")}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                logChannelFilter === "sms"
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              SMS
            </button>
            <button
              type="button"
              onClick={() =>
                setLogWindowFilter((prev) => (prev === "week" ? "all" : "week"))
              }
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                logWindowFilter === "week"
                  ? "border-slate-800 bg-slate-800 text-white"
                  : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              This Week
            </button>
          </div>
        </div>
      </div>

      {loadingMessages ? (
        <ListLoadingSpinner />
      ) : filteredMessages.length === 0 ? (
        <ListEmptyState message="No outreach messages have been logged yet." />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <ul className="divide-y">
            {filteredMessages.map((m) => (
              <li
                key={m.id}
                className="px-4 py-4 flex gap-3 hover:bg-slate-50 transition"
              >
                <div className="mt-1">
                  <AvatarCircle
                    name={m.toName || m.to || "Recipient"}
                    imgUrl={m.toImgUrl || m.toPhotoURL || null}
                    size="sm"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">
                      {m.subject || "Message"}
                    </p>
                    <span className="text-[11px] text-slate-400 shrink-0">
                      {m.createdAt?.toDate
                        ? m.createdAt.toDate().toLocaleString()
                        : ""}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 mb-1">
                    {m.channel === "sms"
                      ? "SMS"
                      : m.channel === "email"
                      ? "Email"
                      : "Outreach"}
                  </p>

                  <p className="text-sm text-slate-700 line-clamp-2">
                    {m.body || "No preview available."}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
