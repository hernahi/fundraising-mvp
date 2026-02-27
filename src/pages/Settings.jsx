// src/pages/Settings.jsx
import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useAuth } from "../context/AuthContext";
import { db, functions } from "../firebase/config";
import AvatarCircle from "../components/AvatarCircle";

export default function Settings() {
  const { profile, user } = useAuth();
  const [orgTimeZone, setOrgTimeZone] = useState("");
  const [timeZoneDraft, setTimeZoneDraft] = useState("");
  const [savingTimeZone, setSavingTimeZone] = useState(false);
  const [orgDripEnabled, setOrgDripEnabled] = useState(false);
  const [orgSettingsLoaded, setOrgSettingsLoaded] = useState(false);
  const [savingDrip, setSavingDrip] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [sendingTestSummary, setSendingTestSummary] = useState(false);
  const [testSummaryStatus, setTestSummaryStatus] = useState("");
  const [notificationPrefs, setNotificationPrefs] = useState({
    emailNotifications: true,
    smsNotifications: false,
    weeklyDigest: false,
    defaultCampaignSort: "recent",
    summaryEnabled: false,
    summaryFrequency: "off",
    summaryEmailEnabled: false,
    summarySmsEnabled: false,
  });

  const name =
    profile?.displayName || profile?.name || profile?.email || "User";
  const email = profile?.email || "N/A";
  const role = profile?.role || "N/A";
  const orgId = profile?.orgId || "N/A";
  const teamId = profile?.teamId || "N/A";
  const roleLower = (profile?.role || "").toLowerCase();
  const isOrgAdmin = roleLower === "admin" || roleLower === "super-admin";
  const canReceiveSummary = ["admin", "super-admin", "coach"].includes(roleLower);
  const browserTimeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const timeZoneOptions = Array.from(
    new Set([
      "America/Los_Angeles",
      "America/Denver",
      "America/Chicago",
      "America/New_York",
      "America/Phoenix",
      "America/Anchorage",
      "Pacific/Honolulu",
      "UTC",
      browserTimeZone,
    ])
  );

  useEffect(() => {
    async function loadOrgSettings() {
      if (!profile?.orgId) return;

      try {
        const ref = doc(db, "organizations", profile.orgId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          const nextTimeZone =
            data.orgTimeZone || data.timeZone || data.timezone || "";
          setOrgTimeZone(nextTimeZone);
          setTimeZoneDraft(nextTimeZone || browserTimeZone);
          setOrgDripEnabled(Boolean(data.dripGlobalEnabled));

          if (isOrgAdmin && !nextTimeZone && browserTimeZone) {
            await updateDoc(ref, {
              orgTimeZone: browserTimeZone,
              updatedAt: serverTimestamp(),
            });
            setOrgTimeZone(browserTimeZone);
            setTimeZoneDraft(browserTimeZone);
          }
        }
      } catch (err) {
        console.error("Failed to load org settings:", err);
      } finally {
        setOrgSettingsLoaded(true);
      }
    }

    loadOrgSettings();
  }, [browserTimeZone, isOrgAdmin, profile?.orgId]);

  const dripStatusRaw = profile?.orgId
    ? orgSettingsLoaded
      ? orgDripEnabled
        ? "On"
        : "Off"
      : "Loading..."
    : "N/A";
  const dripStatusLabel = dripStatusRaw;

  useEffect(() => {
    async function loadUserPreferences() {
      const uid = user?.uid || profile?.uid;
      if (!uid) return;
      try {
        const userSnap = await getDoc(doc(db, "users", uid));
        if (!userSnap.exists()) return;
        const data = userSnap.data() || {};
        const prefs = data.preferences || {};
        const role = String(data.role || profile?.role || "").toLowerCase();
        const summaryDefaults = ["admin", "super-admin", "coach"].includes(role)
          ? {
              summaryEnabled: true,
              summaryFrequency: "daily",
              summaryEmailEnabled: true,
              summarySmsEnabled: false,
            }
          : {
              summaryEnabled: false,
              summaryFrequency: "off",
              summaryEmailEnabled: false,
              summarySmsEnabled: false,
            };
        setNotificationPrefs((prev) => ({
          ...prev,
          ...summaryDefaults,
          ...prefs,
        }));
      } catch (err) {
        console.error("Failed to load user preferences:", err);
      }
    }

    loadUserPreferences();
  }, [profile?.uid, user?.uid]);

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
              Settings
            </h1>
            <p className="text-sm text-slate-500">
              Account profile, workspace controls, and org messaging defaults.
            </p>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            Account &amp; Workspace
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SettingStat label="Role" value={role || "N/A"} />
          <SettingStat label="Org" value={orgId || "N/A"} mono />
          <SettingStat label="Team" value={teamId || "N/A"} mono />
          <SettingStat
            label={roleLower === "coach" ? "Auto-Drip" : "Drip Status"}
            value={dripStatusLabel}
          />
        </div>
        {roleLower === "coach" && (
          <p className="-mt-3 text-xs text-slate-500">
            Auto-Drip is controlled by your organization admin.
          </p>
        )}

        {/* PROFILE CARD */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex items-center gap-4">
          <AvatarCircle
            name={name}
            imgUrl={profile?.photoURL || profile?.imgUrl}
            size="lg"
          />
          <div className="min-w-0">
            <p className="text-base font-semibold text-slate-900 truncate">
              {name}
            </p>
            <p className="text-sm text-slate-600 truncate">{email}</p>
            <p className="text-xs text-slate-400 mt-1">
              Signed in as <span className="font-medium">{role}</span>
            </p>
          </div>
        </div>

        {/* ORG / TEAM INFO */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">
            Workspace
          </h2>
          <dl className="space-y-2 text-sm">
            <DetailRow label="Organization ID" value={orgId} />
            <DetailRow label="Team ID" value={teamId} />
            <DetailRow
              label="Role"
              value={roleLower === "admin" ? "Administrator" : role}
            />
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">
            Notifications &amp; Preferences
          </h2>
          <div className="space-y-4">
            <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-700">Email Notifications</span>
              <input
                type="checkbox"
                checked={Boolean(notificationPrefs.emailNotifications)}
                onChange={(e) =>
                  setNotificationPrefs((prev) => ({
                    ...prev,
                    emailNotifications: e.target.checked,
                  }))
                }
              />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-700">SMS Notifications</span>
              <input
                type="checkbox"
                checked={Boolean(notificationPrefs.smsNotifications)}
                onChange={(e) =>
                  setNotificationPrefs((prev) => ({
                    ...prev,
                    smsNotifications: e.target.checked,
                  }))
                }
              />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-700">Weekly Digest</span>
              <input
                type="checkbox"
                checked={Boolean(notificationPrefs.weeklyDigest)}
                onChange={(e) =>
                  setNotificationPrefs((prev) => ({
                    ...prev,
                    weeklyDigest: e.target.checked,
                  }))
                }
              />
            </label>
            {canReceiveSummary && (
              <>
                <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-700">Daily Digest / Report Emails</span>
                  <input
                    type="checkbox"
                    checked={Boolean(notificationPrefs.summaryEnabled)}
                    onChange={(e) =>
                      setNotificationPrefs((prev) => ({
                        ...prev,
                        summaryEnabled: e.target.checked,
                        summaryFrequency: e.target.checked
                          ? prev.summaryFrequency === "off"
                            ? "daily"
                            : prev.summaryFrequency
                          : "off",
                        summaryEmailEnabled: e.target.checked,
                        summarySmsEnabled: false,
                      }))
                    }
                  />
                </label>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Digest Frequency
                  </label>
                  <select
                    value={notificationPrefs.summaryFrequency || "off"}
                    onChange={(e) =>
                      setNotificationPrefs((prev) => ({
                        ...prev,
                        summaryFrequency: e.target.value,
                        summaryEnabled: e.target.value !== "off",
                        summaryEmailEnabled: e.target.value !== "off",
                        summarySmsEnabled: false,
                      }))
                    }
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="off">Off</option>
                    <option value="daily">Daily Digest (Email)</option>
                    <option value="weekly">Weekly Report (Email)</option>
                  </select>
                </div>
                <p className="text-xs text-slate-500">
                  Default for new coach/admin accounts is Daily Digest. SMS
                  summaries are disabled for now and will be enabled after SMS
                  provider rollout.
                </p>
              </>
            )}
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Default Campaign Sort
              </label>
              <select
                value={notificationPrefs.defaultCampaignSort || "recent"}
                onChange={(e) =>
                  setNotificationPrefs((prev) => ({
                    ...prev,
                    defaultCampaignSort: e.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="recent">Recent</option>
                <option value="name">Name</option>
                <option value="goal">Goal Amount</option>
              </select>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                disabled={savingPrefs}
                onClick={async () => {
                  const uid = user?.uid || profile?.uid;
                  if (!uid) return;
                  try {
                    setSavingPrefs(true);
                    await updateDoc(doc(db, "users", uid), {
                      preferences: {
                        ...notificationPrefs,
                      },
                      updatedAt: serverTimestamp(),
                    });
                  } catch (err) {
                    console.error("Failed to save user preferences:", err);
                  } finally {
                    setSavingPrefs(false);
                  }
                }}
                className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {savingPrefs ? "Saving..." : "Save Preferences"}
              </button>
            </div>
            {canReceiveSummary && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Summary Test
                    </p>
                    <p className="text-xs text-slate-500">
                      Send a test digest email immediately to your account.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={sendingTestSummary}
                    onClick={async () => {
                      try {
                        setSendingTestSummary(true);
                        setTestSummaryStatus("");
                        const fn = httpsCallable(functions, "sendTestSummaryNow");
                        await fn({});
                        setTestSummaryStatus("Test summary queued. Check your inbox.");
                      } catch (err) {
                        console.error("Failed to send test summary:", err);
                        setTestSummaryStatus(
                          "Failed to queue test summary. Please try again."
                        );
                      } finally {
                        setSendingTestSummary(false);
                      }
                    }}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    {sendingTestSummary ? "Sending..." : "Send Test Summary Now"}
                  </button>
                </div>
                {testSummaryStatus ? (
                  <p className="mt-2 text-xs text-slate-600">{testSummaryStatus}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {isOrgAdmin && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">
                Drip Campaign Scheduler
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Defaulted from your browser timezone. You can change it any
                time. Auto-sends run at 6:30 PM local time for the org.
              </p>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Organization Time Zone
              </label>
              <select
                value={timeZoneDraft}
                onChange={(e) => setTimeZoneDraft(e.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                disabled={savingTimeZone}
              >
                {timeZoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Current: {orgTimeZone || "Not set"}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    if (!profile?.orgId) return;
                    try {
                      setSavingTimeZone(true);
                      const ref = doc(db, "organizations", profile.orgId);
                      await updateDoc(ref, {
                        orgTimeZone: timeZoneDraft,
                        updatedAt: serverTimestamp(),
                      });
                      setOrgTimeZone(timeZoneDraft);
                    } catch (err) {
                      console.error("Failed to save org timezone:", err);
                    } finally {
                      setSavingTimeZone(false);
                    }
                  }}
                  disabled={savingTimeZone || !timeZoneDraft}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {savingTimeZone ? "Saving..." : "Save Time Zone"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  Auto-send Status
                </p>
                <p className="text-xs text-slate-500">
                  {orgDripEnabled ? "Running" : "Paused"} for the entire org.
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!profile?.orgId) return;
                  const nextValue = !orgDripEnabled;
                  try {
                    setSavingDrip(true);
                    const ref = doc(db, "organizations", profile.orgId);
                    await updateDoc(ref, {
                      dripGlobalEnabled: nextValue,
                      dripStartedAt: nextValue ? serverTimestamp() : null,
                      updatedAt: serverTimestamp(),
                    });
                    setOrgDripEnabled(nextValue);

                    if (nextValue) {
                      const athletesRef = collection(db, "athletes");
                      const qRef = query(
                        athletesRef,
                        where("orgId", "==", profile.orgId)
                      );
                      const snap = await getDocs(qRef);
                      const docs = snap.docs;
                      const chunkSize = 400;

                      for (let i = 0; i < docs.length; i += chunkSize) {
                        const batch = writeBatch(db);
                        docs.slice(i, i + chunkSize).forEach((athleteDoc) => {
                          batch.update(doc(db, "athletes", athleteDoc.id), {
                            "drip.autoSendEnabled": true,
                            updatedAt: serverTimestamp(),
                          });
                        });
                        await batch.commit();
                      }
                    }
                  } catch (err) {
                    console.error("Failed to update drip status:", err);
                  } finally {
                    setSavingDrip(false);
                  }
                }}
                disabled={savingDrip}
                className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {savingDrip
                  ? "Saving..."
                  : orgDripEnabled
                  ? "Pause Drip"
                  : "Start Drip"}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 text-right">{value || "N/A"}</dd>
    </div>
  );
}

function SettingStat({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border border-slate-300 bg-gradient-to-b from-white to-slate-50/70 px-3 py-3 shadow-sm">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 text-sm font-semibold text-slate-800 truncate ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
