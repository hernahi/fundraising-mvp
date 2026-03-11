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
  const [reportingSettings, setReportingSettings] = useState({
    excludeEndedCampaigns: true,
    sendWhenNoActiveCampaigns: false,
  });
  const [savingReportingSettings, setSavingReportingSettings] = useState(false);
  const [athleteOptions, setAthleteOptions] = useState([]);
  const [previewTargetAthleteId, setPreviewTargetAthleteId] = useState("");
  const [previewPhase, setPreviewPhase] = useState("week1a");
  const [previewRecipientName, setPreviewRecipientName] = useState("");
  const [previewDonorName, setPreviewDonorName] = useState("Sample Supporter");
  const [previewingEmails, setPreviewingEmails] = useState(false);
  const [emailPreviewStatus, setEmailPreviewStatus] = useState("");
  const [emailPreviewData, setEmailPreviewData] = useState(null);
  const [notificationPrefs, setNotificationPrefs] = useState({
    emailNotifications: true,
    smsNotifications: false,
    weeklyDigest: false,
    defaultCampaignSort: "recent",
    summaryEnabled: false,
    summaryFrequency: "off",
    summaryEmailEnabled: false,
    summarySmsEnabled: false,
    summaryDailyDeliveryHour: 7,
    summaryDailyDeliveryMinute: 0,
    summaryWeeklyDeliveryHour: 7,
    summaryWeeklyDeliveryMinute: 0,
    summaryTimeZone: "UTC",
  });

  const name =
    profile?.displayName || profile?.name || profile?.email || "User";
  const email = profile?.email || "N/A";
  const role = profile?.role || "N/A";
  const orgId = profile?.orgId || "N/A";
  const teamId = profile?.teamId || "N/A";
  const orgName = profile?.orgName || orgId || "N/A";
  const teamName = profile?.teamName || teamId || "N/A";
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
          setReportingSettings({
            excludeEndedCampaigns:
              data.reporting?.excludeEndedCampaigns !== false,
            sendWhenNoActiveCampaigns:
              data.reporting?.sendWhenNoActiveCampaigns === true,
          });

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
        const legacyHour = Number(prefs.summaryDeliveryHour);
        const legacyMinute = Number(prefs.summaryDeliveryMinute);
        const resolvedDailyHour =
          Number.isInteger(Number(prefs.summaryDailyDeliveryHour))
            ? Number(prefs.summaryDailyDeliveryHour)
            : Number.isInteger(legacyHour)
              ? legacyHour
              : 7;
        const resolvedDailyMinute = [0, 15, 30, 45].includes(Number(prefs.summaryDailyDeliveryMinute))
          ? Number(prefs.summaryDailyDeliveryMinute)
          : [0, 15, 30, 45].includes(legacyMinute)
            ? legacyMinute
            : 0;
        const resolvedWeeklyHour =
          Number.isInteger(Number(prefs.summaryWeeklyDeliveryHour))
            ? Number(prefs.summaryWeeklyDeliveryHour)
            : Number.isInteger(legacyHour)
              ? legacyHour
              : 7;
        const resolvedWeeklyMinute = [0, 15, 30, 45].includes(Number(prefs.summaryWeeklyDeliveryMinute))
          ? Number(prefs.summaryWeeklyDeliveryMinute)
          : [0, 15, 30, 45].includes(legacyMinute)
            ? legacyMinute
            : 0;
        const role = String(data.role || profile?.role || "").toLowerCase();
        const summaryDefaults = ["admin", "super-admin", "coach"].includes(role)
          ? {
              summaryEnabled: true,
              summaryFrequency: "daily",
              summaryEmailEnabled: true,
              summarySmsEnabled: false,
              summaryDailyDeliveryHour: 7,
              summaryDailyDeliveryMinute: 0,
              summaryWeeklyDeliveryHour: 7,
              summaryWeeklyDeliveryMinute: 0,
              summaryTimeZone: browserTimeZone,
            }
          : {
              summaryEnabled: false,
              summaryFrequency: "off",
              summaryEmailEnabled: false,
              summarySmsEnabled: false,
              summaryDailyDeliveryHour: 7,
              summaryDailyDeliveryMinute: 0,
              summaryWeeklyDeliveryHour: 7,
              summaryWeeklyDeliveryMinute: 0,
              summaryTimeZone: browserTimeZone,
            };
        setNotificationPrefs((prev) => ({
          ...prev,
          ...summaryDefaults,
          ...prefs,
          summaryDailyDeliveryHour: resolvedDailyHour,
          summaryDailyDeliveryMinute: resolvedDailyMinute,
          summaryWeeklyDeliveryHour: resolvedWeeklyHour,
          summaryWeeklyDeliveryMinute: resolvedWeeklyMinute,
        }));
      } catch (err) {
        console.error("Failed to load user preferences:", err);
      }
    }

    loadUserPreferences();
  }, [browserTimeZone, profile?.role, profile?.uid, user?.uid]);

  useEffect(() => {
    async function loadAthleteOptions() {
      if (!isOrgAdmin || !profile?.orgId) return;
      try {
        const snap = await getDocs(
          query(collection(db, "athletes"), where("orgId", "==", profile.orgId))
        );
        const options = snap.docs
          .map((d) => ({
            id: d.id,
            name: d.data()?.name || d.data()?.displayName || d.id,
            campaignId: d.data()?.campaignId || "",
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setAthleteOptions(options);
        if (!previewTargetAthleteId && options.length) {
          setPreviewTargetAthleteId(options[0].id);
        }
      } catch (err) {
        console.error("Failed to load athlete options for preview:", err);
      }
    }
    loadAthleteOptions();
  }, [isOrgAdmin, profile?.orgId, previewTargetAthleteId]);

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
              Account profile, notification preferences, and organization controls.
            </p>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            Account &amp; Workspace
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SettingStat label="Role" value={role || "N/A"} />
          <SettingStat label="Org" value={orgName || "N/A"} />
          <SettingStat label="Team" value={teamName || "N/A"} />
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
            <DetailRow label="Organization" value={orgName} />
            <DetailRow label="Team" value={teamName} />
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Daily Delivery Time
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        value={String(notificationPrefs.summaryDailyDeliveryHour ?? 7)}
                        onChange={(e) =>
                          setNotificationPrefs((prev) => ({
                            ...prev,
                            summaryDailyDeliveryHour: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {Array.from({ length: 24 }).map((_, hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                      <span className="text-sm text-slate-500">:</span>
                      <select
                        value={String(notificationPrefs.summaryDailyDeliveryMinute ?? 0)}
                        onChange={(e) =>
                          setNotificationPrefs((prev) => ({
                            ...prev,
                            summaryDailyDeliveryMinute: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {[0, 15, 30, 45].map((minute) => (
                          <option key={minute} value={minute}>
                            {String(minute).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Weekly Delivery Time
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <select
                        value={String(notificationPrefs.summaryWeeklyDeliveryHour ?? 7)}
                        onChange={(e) =>
                          setNotificationPrefs((prev) => ({
                            ...prev,
                            summaryWeeklyDeliveryHour: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {Array.from({ length: 24 }).map((_, hour) => (
                          <option key={`weekly-hour-${hour}`} value={hour}>
                            {String(hour).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                      <span className="text-sm text-slate-500">:</span>
                      <select
                        value={String(notificationPrefs.summaryWeeklyDeliveryMinute ?? 0)}
                        onChange={(e) =>
                          setNotificationPrefs((prev) => ({
                            ...prev,
                            summaryWeeklyDeliveryMinute: Number(e.target.value),
                          }))
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        {[0, 15, 30, 45].map((minute) => (
                          <option key={`weekly-minute-${minute}`} value={minute}>
                            {String(minute).padStart(2, "0")}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs uppercase tracking-wide text-slate-400">
                      Delivery Time Zone
                    </label>
                    <select
                      value={notificationPrefs.summaryTimeZone || browserTimeZone}
                      onChange={(e) =>
                        setNotificationPrefs((prev) => ({
                          ...prev,
                          summaryTimeZone: e.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                    >
                      {timeZoneOptions.map((tz) => (
                        <option key={`summary-tz-${tz}`} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>
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
                      Test Summary Email
                      </p>
                      <p className="text-xs text-slate-500">
                      Send a sample digest to your own inbox right away.
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
                        const result = await fn({});
                        const payload = result?.data || {};
                        if (payload?.skipped) {
                          setTestSummaryStatus(
                            payload?.message ||
                              "No summary queued because no active campaigns are in scope."
                          );
                        } else {
                          setTestSummaryStatus("Test summary queued. Check your inbox.");
                        }
                      } catch (err) {
                        console.error("Failed to send test summary:", err);
                        setTestSummaryStatus(
                          "Could not queue the test summary. Please try again."
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
                Starts with your browser time zone. You can change it any
                time. Scheduled sends run at 6:30 PM local time for the organization.
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

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  Reporting Controls
                </p>
                <p className="text-xs text-slate-500">
                  Control summary behavior for ended campaigns and inactive org periods.
                </p>
              </div>
              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="text-slate-700">
                  Exclude ended campaigns from daily/weekly summaries
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(reportingSettings.excludeEndedCampaigns)}
                  onChange={(e) =>
                    setReportingSettings((prev) => ({
                      ...prev,
                      excludeEndedCampaigns: e.target.checked,
                    }))
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                <span className="text-slate-700">
                  Send summaries even when no active campaigns are in scope
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(reportingSettings.sendWhenNoActiveCampaigns)}
                  onChange={(e) =>
                    setReportingSettings((prev) => ({
                      ...prev,
                      sendWhenNoActiveCampaigns: e.target.checked,
                    }))
                  }
                />
              </label>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={savingReportingSettings}
                  onClick={async () => {
                    if (!profile?.orgId) return;
                    try {
                      setSavingReportingSettings(true);
                      await updateDoc(doc(db, "organizations", profile.orgId), {
                        reporting: {
                          excludeEndedCampaigns:
                            reportingSettings.excludeEndedCampaigns !== false,
                          sendWhenNoActiveCampaigns:
                            reportingSettings.sendWhenNoActiveCampaigns === true,
                        },
                        updatedAt: serverTimestamp(),
                      });
                    } catch (err) {
                      console.error("Failed to save reporting settings:", err);
                    } finally {
                      setSavingReportingSettings(false);
                    }
                  }}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  {savingReportingSettings ? "Saving..." : "Save Reporting Controls"}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  Email Preview Suite
                </p>
                <p className="text-xs text-slate-500">
                  Preview invite, drip, receipt, and summary emails in one pass.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Athlete
                  </label>
                  <select
                    value={previewTargetAthleteId}
                    onChange={(e) => setPreviewTargetAthleteId(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {athleteOptions.length === 0 ? (
                      <option value="">No athletes found</option>
                    ) : (
                      athleteOptions.map((athlete) => (
                        <option key={athlete.id} value={athlete.id}>
                          {athlete.name}
                          {athlete.campaignId ? ` - ${athlete.campaignId}` : ""}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Drip Phase
                  </label>
                  <select
                    value={previewPhase}
                    onChange={(e) => setPreviewPhase(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    {["week1a", "week1b", "week2", "week3", "week4", "week5", "lateIntro"].map(
                      (phase) => (
                        <option key={phase} value={phase}>
                          {phase}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Recipient First Name
                  </label>
                  <input
                    type="text"
                    value={previewRecipientName}
                    onChange={(e) => setPreviewRecipientName(e.target.value)}
                    placeholder="Margarita"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    Receipt Donor Name
                  </label>
                  <input
                    type="text"
                    value={previewDonorName}
                    onChange={(e) => setPreviewDonorName(e.target.value)}
                    placeholder="Sample Supporter"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={previewingEmails || !previewTargetAthleteId}
                  onClick={async () => {
                    try {
                      setPreviewingEmails(true);
                      setEmailPreviewStatus("");
                      setEmailPreviewData(null);
                      const fn = httpsCallable(functions, "previewAllEmailTypes");
                      const res = await fn({
                        athleteId: previewTargetAthleteId,
                        phase: previewPhase,
                        recipientName: previewRecipientName.trim(),
                        donorName: previewDonorName.trim() || "Sample Supporter",
                        targetUid: user?.uid || profile?.uid || "",
                      });
                      setEmailPreviewData(res?.data || null);
                      setEmailPreviewStatus("Preview generated.");
                    } catch (err) {
                      console.error("Failed to generate email preview suite:", err);
                      setEmailPreviewStatus(
                        "Failed to generate previews. Check console and function logs."
                      );
                    } finally {
                      setPreviewingEmails(false);
                    }
                  }}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  {previewingEmails ? "Generating..." : "Generate Email Previews"}
                </button>
              </div>
              {emailPreviewStatus ? (
                <p className="text-xs text-slate-600">{emailPreviewStatus}</p>
              ) : null}
              {emailPreviewData?.previews ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <EmailPreviewBlock
                    title="Invite"
                    preview={emailPreviewData.previews.invite}
                  />
                  <EmailPreviewBlock
                    title="Drip"
                    preview={emailPreviewData.previews.drip}
                  />
                  <EmailPreviewBlock
                    title="Receipt"
                    preview={emailPreviewData.previews.receipt}
                  />
                  <EmailPreviewBlock
                    title="Summary"
                    preview={emailPreviewData.previews.summary}
                  />
                </div>
              ) : null}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function EmailPreviewBlock({ title, preview }) {
  if (!preview) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </p>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-500">
          {preview.templateVersion || "v1"}
        </span>
      </div>
      <p className="text-sm font-semibold text-slate-800">{preview.subject || "N/A"}</p>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
        {preview.bodyText || ""}
      </pre>
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
