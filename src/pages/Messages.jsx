// src/pages/Messages.jsx
import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { useAuth } from "../context/AuthContext";
import HeaderActions from "../components/HeaderActions";
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

const SUBJECTS_BY_TEMPLATE = {
  week1a: "Can you support our fundraiser?",
  week1b: "A quick note from our team",
  week2: "Thank you for supporting our season",
  week3: "We are getting closer to our goal",
  week4: "Last chance to support our fundraiser",
  week5: "Final week to support our fundraiser",
  custom: "Fundraiser update",
};

export default function Messages() {
  const { profile, loading: authLoading } = useAuth();
  const role = (profile?.role || "").toLowerCase();
  const isAthlete = role === "athlete";
  const isCoach = role === "coach";
  const isAdmin = role === "admin" || role === "super-admin";
  const orgId = profile?.orgId || "";
  const athleteId = profile?.uid || "";

  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");

  const [contacts, setContacts] = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState([]);

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
  const [selectedTemplateKey, setSelectedTemplateKey] = useState("week1a");

  const [athleteRecord, setAthleteRecord] = useState(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [dedupeLoading, setDedupeLoading] = useState(false);

  useEffect(() => {
    if (authLoading || !profile?.orgId) return;

    const ref = collection(db, "messages");
    const qRef = isAthlete
      ? query(
          ref,
          where("orgId", "==", profile.orgId),
          where("athleteId", "==", athleteId),
          orderBy("createdAt", "desc")
        )
      : query(
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
  }, [authLoading, athleteId, isAthlete, profile]);

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

        const nextWeekTemplates = orgData.donorInviteTemplates || {};
        setOrgWeekTemplates(nextWeekTemplates);
        if (Object.keys(orgWeekDirty).length === 0) {
          setOrgWeekDrafts(nextWeekTemplates);
        }

        const nextWeekSubjects = orgData.donorInviteSubjects || {};
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

  const counts = useMemo(() => {
    const donated = contacts.filter((c) => c.status === "donated").length;
    const sent = contacts.filter((c) => c.status === "sent").length;
    return {
      total: contacts.length,
      donated,
      sent,
    };
  }, [contacts]);

  const canSend = counts.total >= 20 && !!athleteRecord?.campaignId;
  const isTestSend = counts.total < 20;

  const eligibleContacts = useMemo(
    () => contacts.filter((c) => c.status !== "donated"),
    [contacts]
  );

  const selectedRecipients =
    selectedContactIds.length > 0
      ? eligibleContacts.filter((c) => selectedContactIds.includes(c.id))
      : eligibleContacts;

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
      await addDoc(collection(db, "athlete_contacts"), {
        orgId,
        athleteId,
        name,
        email,
        emailLower: email,
        status: "draft",
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
    const nextTemplate = orgTemplate || DEFAULT_DONOR_INVITE_TEMPLATE;
    setTemplateDraft(nextTemplate);
    setTemplateDirty(true);
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
      await fn({
        campaignId: athleteRecord.campaignId,
        athleteId,
        contactIds,
        template: templateDraft,
        subject,
        phase: templateKey,
      });
    } catch (err) {
      console.error("Failed to send drip message:", err);
      alert("Failed to send messages. Please try again.");
    } finally {
      setSendLoading(false);
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
    <div className="p-6 space-y-6">
      <HeaderActions
        title="Messages"
        addLabel={null}
        exportLabel={null}
        onExport={null}
        lastUpdated={lastUpdated}
      />

      {(isCoach || isAdmin) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-6">
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
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">
                    Contacts
                  </h2>
                  <p className="text-sm text-slate-500">
                    Add at least 20 contacts to start your drip campaign.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={dedupeContacts}
                    disabled={dedupeLoading || contacts.length < 2}
                    className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
                  >
                    {dedupeLoading ? "De-duplicating..." : "De-duplicate"}
                  </button>
                  <div className="text-sm font-semibold text-slate-700">
                    {counts.total}/20
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
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
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Add
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4 text-sm text-slate-600">
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
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">
                          <input
                            type="checkbox"
                            checked={
                              eligibleContacts.length > 0 &&
                              selectedContactIds.length ===
                                eligibleContacts.length
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedContactIds(
                                  eligibleContacts.map((c) => c.id)
                                );
                              } else {
                                setSelectedContactIds([]);
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
                      {contacts.map((contact) => (
                        <tr
                          key={contact.id}
                          className="border-t border-slate-100"
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedContactIds.includes(contact.id)}
                              disabled={contact.status === "donated"}
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
                            <div className="text-xs text-slate-500">
                              {contact.email}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {contact.status || "draft"}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {contact.lastSentAt?.toDate
                              ? contact.lastSentAt.toDate().toLocaleString()
                              : "N/A"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => removeContact(contact.id)}
                              className="text-xs text-slate-400 hover:text-red-500"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">
                    Invite Message
                  </h2>
                  <p className="text-sm text-slate-500">
                    You can edit the template. Keep the core message intact for
                    best results.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetTemplate}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Use org template
                </button>
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

              <textarea
                value={templateDraft}
                onChange={(e) => {
                  setTemplateDraft(e.target.value);
                  setTemplateDirty(true);
                }}
                rows={10}
                className="mt-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              />

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={saveTemplate}
                  disabled={savingTemplate || selectedTemplateKey === "custom"}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {savingTemplate ? "Saving..." : "Save Template"}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-800">
                Drip Campaign
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Select recipients and the message you want to send.
              </p>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Auto-send at 6:30 PM
                    </p>
                    <p className="text-xs text-slate-500">
                      {orgTimeZone
                        ? `Org time zone: ${orgTimeZone}`
                        : "Org time zone not set yet."}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={Boolean(athleteRecord?.drip?.autoSendEnabled)}
                      onChange={async (e) => {
                        try {
                          const nextValue = e.target.checked;
                          await updateDoc(doc(db, "athletes", athleteId), {
                            drip: {
                              ...(athleteRecord?.drip || {}),
                              autoSendEnabled: nextValue,
                            },
                            updatedAt: serverTimestamp(),
                          });
                          setAthleteRecord((prev) => ({
                            ...(prev || {}),
                            drip: {
                              ...(prev?.drip || {}),
                              autoSendEnabled: nextValue,
                            },
                          }));
                        } catch (err) {
                          console.error("Failed to update drip toggle:", err);
                        }
                      }}
                    />
                    Auto-send
                  </label>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Next send:{" "}
                  {athleteRecord?.drip?.nextSendAt?.toDate
                    ? athleteRecord.drip.nextSendAt.toDate().toLocaleString()
                    : "Not scheduled yet"}
                </div>
                {!orgDripEnabled && (
                  <p className="mt-2 text-xs text-amber-600">
                    Org auto-send is paused. Turn it on in Settings when ready.
                  </p>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => sendDrip(selectedTemplateKey)}
                  disabled={sendLoading || (!canSend && !isTestSend)}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Send {TEMPLATE_OPTIONS.find((opt) => opt.key === selectedTemplateKey)?.label || "Message"} ({selectedRecipients.length} recipients)
                </button>
              </div>

              {!athleteRecord?.campaignId && (
                <p className="mt-3 text-xs text-amber-600">
                  Assign a campaign before starting the drip.
                </p>
              )}

              {counts.total < 20 && (
                <p className="mt-3 text-xs text-amber-600">
                  Add at least 20 contacts to start sending. Test sends are
                  limited to 3 recipients.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {loadingMessages ? (
        <ListLoadingSpinner />
      ) : messages.length === 0 ? (
        <ListEmptyState message="No outreach messages have been logged yet." />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <ul className="divide-y">
            {messages.map((m) => (
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
