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
import { useAuth } from "../context/AuthContext";
import { db } from "../firebase/config";
import AvatarCircle from "../components/AvatarCircle";

export default function Settings() {
  const { profile } = useAuth();
  const [inviteTemplate, setInviteTemplate] = useState("");
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [orgTimeZone, setOrgTimeZone] = useState("");
  const [timeZoneDraft, setTimeZoneDraft] = useState("");
  const [savingTimeZone, setSavingTimeZone] = useState(false);
  const [orgDripEnabled, setOrgDripEnabled] = useState(false);
  const [savingDrip, setSavingDrip] = useState(false);

  const name =
    profile?.displayName || profile?.name || profile?.email || "User";
  const email = profile?.email || "N/A";
  const role = profile?.role || "N/A";
  const orgId = profile?.orgId || "N/A";
  const teamId = profile?.teamId || "N/A";
  const roleLower = (profile?.role || "").toLowerCase();
  const isOrgAdmin = roleLower === "admin" || roleLower === "super-admin";
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
    async function loadTemplate() {
      if (!isOrgAdmin || !profile?.orgId) return;

      try {
        setLoadingTemplate(true);
        const ref = doc(db, "organizations", profile.orgId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() || {};
          setInviteTemplate(data.donorInviteTemplate || "");
          const nextTimeZone =
            data.orgTimeZone || data.timeZone || data.timezone || "";
          setOrgTimeZone(nextTimeZone);
          setTimeZoneDraft(nextTimeZone || browserTimeZone);
          setOrgDripEnabled(Boolean(data.dripGlobalEnabled));

          if (!nextTimeZone && browserTimeZone) {
            await updateDoc(ref, {
              orgTimeZone: browserTimeZone,
              updatedAt: serverTimestamp(),
            });
            setOrgTimeZone(browserTimeZone);
            setTimeZoneDraft(browserTimeZone);
          }
        }
      } catch (err) {
        console.error("Failed to load donor invite template:", err);
      } finally {
        setLoadingTemplate(false);
      }
    }

    loadTemplate();
  }, [isOrgAdmin, profile?.orgId]);

  return (
    <div className="p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* HEADER */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            Account &amp; Workspace
          </span>
        </div>

        {/* PROFILE CARD */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
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
          <p className="mt-4 text-xs text-slate-500">
            Workspace settings (org name, branding, etc.) will be configurable
            from this screen in a future phase.
          </p>
        </div>

        {/* PLACEHOLDER FOR FUTURE TOGGLES */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">
            Notifications &amp; Preferences
          </h2>
          <p className="text-sm text-slate-600">
            Email and SMS notification preferences, campaign defaults, and
            other personal settings will appear here in a later release.
          </p>
        </div>

        {isOrgAdmin && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
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

        {isOrgAdmin && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">
              Donor Invite Template
            </h2>
            <p className="text-xs text-slate-500 mb-3">
              This template is the default message athletes start with. They can
              personalize it before sending. Supported tokens:
              {" "}
              <span className="font-mono">
                {"{{athleteName}}"}
              </span>
              ,{" "}
              <span className="font-mono">
                {"{{teamName}}"}
              </span>
              ,{" "}
              <span className="font-mono">
                {"{{campaignName}}"}
              </span>
              ,{" "}
              <span className="font-mono">
                {"{{donateUrl}}"}
              </span>
              ,{" "}
              <span className="font-mono">
                {"{{personalMessage}}"}
              </span>
              .
            </p>
            <textarea
              className="w-full min-h-[180px] rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
              value={inviteTemplate}
              onChange={(e) => setInviteTemplate(e.target.value)}
              placeholder={`Hi there,\n\n{{athleteName}} is fundraising with {{teamName}} for {{campaignName}}.\nEvery gift helps cover the season and keeps the team strong.\n\n{{personalMessage}}\n\nDonate here: {{donateUrl}}\n\nThank you for supporting our community.`}
              disabled={loadingTemplate || savingTemplate}
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {loadingTemplate ? "Loading template..." : " "}
              </span>
              <button
                className="rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                disabled={savingTemplate || loadingTemplate || !profile?.orgId}
                onClick={async () => {
                  if (!profile?.orgId) return;
                  try {
                    setSavingTemplate(true);
                    const ref = doc(db, "organizations", profile.orgId);
                    await updateDoc(ref, {
                      donorInviteTemplate: inviteTemplate.trim(),
                      updatedAt: serverTimestamp(),
                    });
                  } catch (err) {
                    console.error("Failed to save donor invite template:", err);
                  } finally {
                    setSavingTemplate(false);
                  }
                }}
              >
                {savingTemplate ? "Saving..." : "Save Template"}
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
