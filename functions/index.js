/**
 * FUNDRAISING MVP — PRODUCTION FUNCTIONS (v4 + Node.js 22)
 * ---------------------------------------------------------
 * Mailgun, donor receipts, coach notifications
 * Coach invite callable
 * Stripe webhook
 * ✔ Stripe Checkout Session Creator (createCheckoutSession) — callable (Gen 2 safe)
 */

const { HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2/options");

const { onDocumentCreated } = require("firebase-functions/v2/firestore");

const { onRequest, onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

const logger = require("firebase-functions/logger");
const Stripe = require("stripe");
const Mailgun = require("mailgun.js");
const FormData = require("form-data");

/* ============================================================
   RBAC HELPERS (users/{uid})
   Roles: super-admin, admin, coach, athlete
   ============================================================ */
async function getUserProfile(uid) {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  return snap.exists ? snap.data() : null;
}

function isPrivilegedRole(role) {
  return role === "admin" || role === "super-admin";
}

async function assertAdmin(request) {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const profile = await getUserProfile(uid);
  if (!profile) {
    throw new HttpsError("permission-denied", "User profile not found");
  }

  if (profile.status && profile.status !== "active") {
    throw new HttpsError("permission-denied", "User is not active");
  }

  if (!isPrivilegedRole(profile.role)) {
    throw new HttpsError("permission-denied", "Admins only");
  }

  return profile;
}

// Initialize Admin
try {
  admin.initializeApp();
} catch (_) {
  // ignore
}

// Global defaults
setGlobalOptions({
  region: "us-central1",
});

/* ============================================================
   DONATION AMOUNT GUARD
   - Ensures Firestore always stores cents (integer)
   - Defensive against legacy or malformed inputs
   ============================================================ */
function enforceCents(amount) {
  if (typeof amount !== "number") return 0;

  // Stripe webhooks send cents; do not convert again here.
  return Math.round(amount);
}

/* ============================================================
   MAILGUN HTTP API (PREFERRED)
   ============================================================ */
function getMailgunClient() {
  const apiKeyRaw = process.env.MAILGUN_API_KEY || process.env.MAILGUN_KEY;
  const domainRaw = process.env.MAILGUN_DOMAIN;
  const apiKey = apiKeyRaw ? apiKeyRaw.trim() : "";
  const domain = domainRaw ? domainRaw.trim() : "";

  if (!apiKey || !domain) {
    throw new Error("Missing MAILGUN_API_KEY (or MAILGUN_KEY) or MAILGUN_DOMAIN");
  }

  const mailgun = new Mailgun(FormData);

  return {
    client: mailgun.client({
      username: "api",
      key: apiKey,
      url: "https://api.mailgun.net",
    }),
    domain,
  };
}

const DEFAULT_DONOR_INVITE_TEMPLATE = `Hi there,

{{athleteName}} is fundraising with {{teamName}} for {{campaignName}}.
Every gift helps cover the season and keeps the team strong.

{{personalMessage}}

Donate here: {{donateUrl}}

Thank you for supporting our community.`;

function renderInviteTemplate(template, data) {
  const base = (template || DEFAULT_DONOR_INVITE_TEMPLATE).toString();
  const replacements = {
    athleteName: data.athleteName || "Our athlete",
    teamName: data.teamName || "our team",
    campaignName: data.campaignName || "our fundraiser",
    donateUrl: data.donateUrl || "",
    personalMessage: data.personalMessage || "",
  };

  let output = base;
  Object.keys(replacements).forEach((key) => {
    const value = replacements[key];
    output = output.replace(
      new RegExp(`{{\\s*${key}\\s*}}`, "g"),
      value
    );
  });

  if (!base.includes("{{personalMessage}}") && replacements.personalMessage) {
    output = `${output}\n\n${replacements.personalMessage}`;
  }

  if (!base.includes("{{donateUrl}}") && replacements.donateUrl) {
    output = `${output}\n\nDonate here: ${replacements.donateUrl}`;
  }

  output = output.replace(/\n{3,}/g, "\n\n").trim();
  return output;
}

const DRIP_PHASES = [
  { key: "week1a", offsetDays: 0 },
  { key: "week1b", offsetDays: 3 },
  { key: "week2", offsetDays: 7 },
  { key: "week3", offsetDays: 14 },
  { key: "week4", offsetDays: 21 },
  { key: "week5", offsetDays: 28 },
];

const DRIP_SUBJECTS = {
  week1a: "Can you support our fundraiser?",
  week1b: "A quick note from our team",
  week2: "Thank you for supporting our season",
  week3: "We are getting closer to our goal",
  week4: "Last chance to support our fundraiser",
  week5: "Final week to support our fundraiser",
};

function getTimeZoneOffsetMs(date, timeZone) {
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone }));
  return date.getTime() - tzDate.getTime();
}

function getDatePartsInTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const lookup = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      lookup[part.type] = Number(part.value);
    }
  });
  return {
    year: lookup.year,
    month: lookup.month,
    day: lookup.day,
  };
}

function buildZonedDate({ year, month, day, hour, minute }, timeZone) {
  const utcBase = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const offsetMs = getTimeZoneOffsetMs(utcBase, timeZone);
  return new Date(utcBase.getTime() + offsetMs);
}

function getOrgTimeZone(orgData) {
  return (
    orgData?.timeZone ||
    orgData?.timezone ||
    orgData?.orgTimeZone ||
    "America/Los_Angeles"
  );
}

function getCampaignStartDate(campaign) {
  if (!campaign) return null;
  if (campaign.startDate?.toDate) return campaign.startDate.toDate();
  if (campaign.startDate?.seconds) {
    return new Date(campaign.startDate.seconds * 1000);
  }
  if (campaign.createdAt?.toDate) return campaign.createdAt.toDate();
  if (campaign.createdAt?.seconds) {
    return new Date(campaign.createdAt.seconds * 1000);
  }
  return null;
}

function getPhaseSchedule(startDate, timeZone) {
  if (!startDate) return [];
  const baseParts = getDatePartsInTimeZone(startDate, timeZone);
  return DRIP_PHASES.map((phase) => {
    const baseDay = new Date(Date.UTC(baseParts.year, baseParts.month - 1, baseParts.day));
    baseDay.setUTCDate(baseDay.getUTCDate() + phase.offsetDays);
    const dateParts = {
      year: baseDay.getUTCFullYear(),
      month: baseDay.getUTCMonth() + 1,
      day: baseDay.getUTCDate(),
      hour: 18,
      minute: 30,
    };
    return {
      key: phase.key,
      sendAt: buildZonedDate(dateParts, timeZone),
    };
  });
}

async function sendDripToContacts({
  db,
  orgId,
  campaignId,
  athleteId,
  contacts,
  templateText,
  subject,
  phase,
  isAutomated,
}) {
  const validContacts = (contacts || []).filter((contact) => {
    const email = String(contact?.email || "").trim();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const isSuppressed = contact?.status === "bounced" || contact?.status === "complained";
    return isValidEmail && !isSuppressed;
  });

  if (!validContacts.length) {
    throw new Error("No valid recipient emails found.");
  }

  const { client, domain } = getMailgunClient();
  const from = `Fundraising MVP <no-reply@${domain}>`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const htmlBody = templateText
    .split("\n")
    .map((line) => (line ? `<p>${line}</p>` : "<br>"))
    .join("");

  const sends = validContacts.map((contact) =>
    client.messages.create(domain, {
      from,
      to: [contact.email],
      subject,
      text: templateText,
      html: htmlBody,
      "v:contactId": contact.id,
      "v:athleteId": athleteId,
      "v:campaignId": campaignId,
      "v:orgId": orgId,
    })
  );

  const results = await Promise.allSettled(sends);
  const sentContacts = [];
  const failedRecipients = [];

  results.forEach((result, index) => {
    const contact = validContacts[index];
    if (result.status === "fulfilled") {
      sentContacts.push(contact);
      return;
    }
    failedRecipients.push({
      email: contact?.email || "",
      reason: result.reason?.message || "send failed",
    });
  });

  if (!sentContacts.length) {
    throw new Error("All selected recipients failed to send.");
  }

  const batch = db.batch();
  sentContacts.forEach((contact) => {
    const contactRef = db.collection("athlete_contacts").doc(contact.id);
    batch.set(
      contactRef,
      {
        status: "sent",
        lastSentAt: now,
        lastPhase: phase,
        updatedAt: now,
      },
      { merge: true }
    );

    const messageRef = db.collection("messages").doc();
    batch.set(messageRef, {
      orgId,
      athleteId,
      campaignId,
      contactId: contact.id,
      to: contact.email,
      toName: contact.name || "",
      subject,
      body: templateText,
      channel: "email",
      phase,
      isAutomated: !!isAutomated,
      createdAt: now,
    });
  });

  const athleteRef = db.collection("athletes").doc(athleteId);
  batch.set(
    athleteRef,
    {
      drip: {
        lastPhaseSent: phase,
        lastSentAt: now,
      },
      updatedAt: now,
    },
    { merge: true }
  );

  await batch.commit();

  if (failedRecipients.length > 0) {
    logger.warn("sendDripToContacts: partial send failure", {
      campaignId,
      athleteId,
      phase,
      failedCount: failedRecipients.length,
      failedRecipients: failedRecipients.map((entry) => entry.email),
    });
  }

  return {
    sentCount: sentContacts.length,
    failedCount: failedRecipients.length,
  };
}

function getMailgunEventPayload(reqBody) {
  if (!reqBody) return null;
  if (reqBody["event-data"]) return reqBody["event-data"];
  if (reqBody.event && reqBody.recipient) return reqBody;
  return null;
}

function parseMailgunEventType(eventData) {
  const type = String(eventData?.event || "").toLowerCase();
  if (!type) return "unknown";
  return type;
}

function shouldMarkSuppressed(eventType) {
  return eventType === "failed" || eventType === "bounced" || eventType === "complained";
}

/* ============================================================
   FIRESTORE: /mail/{mailId} -> SEND EMAIL
   ============================================================ */
exports.sendMail = onDocumentCreated(
  {
    document: "mail/{mailId}",
    secrets: ["MAILGUN_API_KEY"],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const doc = snap.data() || {};
    const message = doc.message || {};

    const to = doc.to || message.to;
    const subject = message.subject || doc.subject || "Notification";
    const html = message.html || doc.html || "";
    const text = message.text || doc.text || "";

    if (!to) {
      logger.warn("sendMail: missing 'to' field");
      return;
    }

    try {
      const { client, domain } = getMailgunClient();
      const from =
        process.env.MAIL_DEFAULT_FROM || `Fundraising MVP <no-reply@${domain}>`;

      await client.messages.create(domain, {
        from,
        to: [to],
        subject,
        html,
        text,
      });

      logger.info("sendMail: sent via mailgun", { to, subject });
    } catch (err) {
      logger.error("sendMail failed", { message: err?.message, stack: err?.stack });
      // Do not throw; we don't want infinite retries on delivery errors
    }
  }
);

/* ============================================================
   NOTIFY COACHES ON NEW DONOR
   - Fires when a donation is written
   ============================================================ */
exports.notifyCoachesOnNewDonor = onDocumentCreated(
  {
    document: "donations/{donationId}",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const donation = snap.data() || {};
    const orgId = donation.orgId;
    const campaignId = donation.campaignId;

    if (!orgId || !campaignId) {
      logger.info("notifyCoachesOnNewDonor: missing orgId/campaignId; skipping");
      return;
    }

    try {
      // Find coaches in org
      const coachesSnap = await admin
        .firestore()
        .collection("coaches")
        .where("orgId", "==", orgId)
        .get();

      if (coachesSnap.empty) {
        logger.info("notifyCoachesOnNewDonor: no coaches found");
        return;
      }

      const amountStr = `$${((donation.amount || 0) / 100).toFixed(2)}`;

      const mailWrites = [];
      coachesSnap.forEach((doc) => {
        const coach = doc.data() || {};
        if (!coach.email) return;

        mailWrites.push(
          admin.firestore().collection("mail").add({
            to: coach.email,
            message: {
              subject: "New donation received",
              html: `
                <div style="font-family: Arial, sans-serif;">
                  <h3>New Donation</h3>
                  <p><b>Amount:</b> ${amountStr}</p>
                  <p><b>Campaign:</b> ${donation.campaignName || campaignId}</p>
                  <p><b>Donor:</b> ${donation.donorName || "Anonymous"}</p>
                </div>
              `,
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          })
        );
      });

      await Promise.all(mailWrites);
      logger.info("notifyCoachesOnNewDonor: queued coach notifications", {
        count: mailWrites.length,
      });
    } catch (err) {
      logger.error("notifyCoachesOnNewDonor failed", { message: err?.message, stack: err?.stack });
    }
  }
);

/* ============================================================
   MAILGUN API — INVITE EMAIL (NEW, CANONICAL)
   ============================================================ */
exports.sendInviteEmail = onCall(
  {
    secrets: ["MAILGUN_API_KEY"],
    timeoutSeconds: 20,
  },

  async (request) => {
    // 🔐 AUTH GUARD (REQUIRED)
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to send invites."
      );
    }

    const { toEmail, inviteId, appUrl } = request.data || {};

    if (!toEmail || !inviteId || !appUrl) {
      throw new HttpsError(
        "invalid-argument",
        "toEmail, inviteId, and appUrl are required"
      );
    }

    const { client, domain } = getMailgunClient();

    const inviteUrl = `${appUrl.replace(/\/$/, "")}/accept-invite?invite=${inviteId}`;

    try {
      await client.messages.create(domain, {
        from: "Fundraising MVP <no-reply@mail.inetsphere.com>",
        to: [toEmail],
        subject: "You’ve been invited to join Fundraising MVP",
        text: `You’ve been invited to join Fundraising MVP.\n\nAccept your invite:\n${inviteUrl}`,
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif;">
            <h2>You’ve been invited</h2>
            <p>You’ve been invited to join <strong>Fundraising MVP</strong>.</p>
            <p>
              <a href="${inviteUrl}"
                 style="display:inline-block;
                        padding:12px 18px;
                        background:#0f172a;
                        color:#ffffff;
                        text-decoration:none;
                        border-radius:6px;
                        font-weight:600;">
                Accept Invite
              </a>
            </p>
            <p style="font-size:12px;color:#64748b;">
              If you didn’t expect this invite, you can ignore this email.
            </p>
          </div>
        `,
      });

      logger.info("sendInviteEmail: sent", {
        toEmail,
        inviteId,
        uid: request.auth.uid,
      });

      return { ok: true };
    } catch (err) {
      logger.error("sendInviteEmail failed", {
        message: err?.message,
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        err?.message || "Failed to send invite email"
      );
    }
  }
);

/* ============================================================
   DONOR INVITE (ATHLETE)
   ============================================================ */
exports.sendDonorInvite = onCall(
  {
    secrets: ["MAILGUN_API_KEY"],
    timeoutSeconds: 20,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required");
    }

    const profile = await getUserProfile(request.auth.uid);
    if (!profile) {
      throw new HttpsError("permission-denied", "User profile not found");
    }

    if (!["athlete", "coach", "admin", "super-admin"].includes(profile.role)) {
      throw new HttpsError("permission-denied", "Not allowed to send invites");
    }

    const { campaignId, athleteId, emails, message } = request.data || {};

    if (!campaignId || !athleteId || !emails) {
      throw new HttpsError(
        "invalid-argument",
        "campaignId, athleteId, and emails are required"
      );
    }

    const emailListRaw = Array.isArray(emails) ? emails.join("\n") : String(emails);
    const emailList = emailListRaw
      .split(/[\n,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!emailList.length) {
      throw new HttpsError("invalid-argument", "No valid emails provided");
    }

    if (emailList.length > 25) {
      throw new HttpsError("invalid-argument", "Max 25 emails at a time");
    }

    const db = admin.firestore();

    const [campaignSnap, athleteSnap, orgSnap] = await Promise.all([
      db.collection("campaigns").doc(campaignId).get(),
      db.collection("athletes").doc(athleteId).get(),
      db.collection("organizations").doc(profile.orgId || "").get(),
    ]);

    if (!campaignSnap.exists) {
      throw new HttpsError("not-found", "Campaign not found");
    }

    if (!athleteSnap.exists) {
      throw new HttpsError("not-found", "Athlete not found");
    }

    const campaign = campaignSnap.data() || {};
    const athlete = athleteSnap.data() || {};

    if (campaign.orgId !== profile.orgId || athlete.orgId !== profile.orgId) {
      throw new HttpsError("permission-denied", "Org mismatch");
    }

    if (athlete.campaignId && athlete.campaignId !== campaignId) {
      throw new HttpsError("invalid-argument", "Athlete not assigned to campaign");
    }

    const baseUrl = (() => {
      const fromEnv = (process.env.FRONTEND_URL || "").trim();
      const fromHeader = (request?.rawRequest?.headers?.origin || "").trim();
      return fromEnv || fromHeader;
    })();

    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      throw new HttpsError("failed-precondition", "FRONTEND_URL is not configured");
    }

    const donateUrl = `${baseUrl}/donate/${campaignId}/athlete/${athleteId}`;
    const teamName =
      campaign.teamName ||
      (Array.isArray(campaign.teamNames) ? campaign.teamNames[0] : "") ||
      "our team";
    const campaignName = campaign.name || campaign.title || "our fundraiser";
    const athleteName = athlete.name || "our athlete";

    const orgTemplate = orgSnap.exists
      ? orgSnap.data()?.donorInviteTemplate
      : null;

    const personalMessage =
      typeof message === "string" && message.trim()
        ? message.trim().slice(0, 800)
        : "";

    const bodyText = renderInviteTemplate(orgTemplate, {
      athleteName,
      teamName,
      campaignName,
      donateUrl,
      personalMessage,
    });

    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; color: #0f172a;">
        ${bodyText
          .split("\n")
          .map((line) => (line ? `<p>${line}</p>` : "<br>"))
          .join("")}
        <p>
          <a href="${donateUrl}"
             style="display:inline-block;padding:12px 18px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">
            Support ${athleteName}
          </a>
        </p>
      </div>
    `;

    const subject = `Can you support ${athleteName} and ${teamName}?`;

    const { client, domain } = getMailgunClient();
    const from = `Fundraising MVP <no-reply@${domain}>`;

    const invites = [];
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const email of emailList) {
      const inviteRef = db.collection("invites").doc();
      invites.push(
        inviteRef.set({
          email,
          status: "pending",
          role: "donor",
          type: "donor_invite",
          orgId: profile.orgId,
          campaignId,
          teamId: athlete.teamId || campaign.teamId || null,
          athleteId,
          createdAt: now,
          createdBy: request.auth.uid,
          message: personalMessage || null,
        })
      );
    }

    await Promise.all(invites);

    const sends = emailList.map((email) =>
      client.messages.create(domain, {
        from,
        to: [email],
        subject,
        text: bodyText,
        html: bodyHtml,
      })
    );

    await Promise.all(sends);

    logger.info("sendDonorInvite: sent", {
      count: emailList.length,
      campaignId,
      athleteId,
      uid: request.auth.uid,
    });

    return { ok: true, sent: emailList.length };
  }
);

/* ============================================================
   ATHLETE DRIP MESSAGE (CALLABLE)
   ============================================================ */
exports.sendAthleteDripMessage = onCall(
  {
    secrets: ["MAILGUN_API_KEY"],
    timeoutSeconds: 60,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required");
    }

    const profile = await getUserProfile(request.auth.uid);
    if (!profile) {
      throw new HttpsError("permission-denied", "User profile not found");
    }

    if (!["athlete", "coach", "admin", "super-admin"].includes(profile.role)) {
      throw new HttpsError("permission-denied", "Not allowed to send messages");
    }

    const { campaignId, athleteId, contactIds, template, subject, phase } =
      request.data || {};

    if (!campaignId || !athleteId || !Array.isArray(contactIds)) {
      throw new HttpsError(
        "invalid-argument",
        "campaignId, athleteId, and contactIds are required"
      );
    }

    if (profile.role === "athlete" && request.auth.uid !== athleteId) {
      throw new HttpsError("permission-denied", "Athletes can only send for themselves");
    }

    if (contactIds.length === 0) {
      throw new HttpsError("invalid-argument", "No contacts selected");
    }

    if (contactIds.length > 200) {
      throw new HttpsError("invalid-argument", "Too many contacts in one send");
    }

    const db = admin.firestore();

    const [campaignSnap, athleteSnap] = await Promise.all([
      db.collection("campaigns").doc(campaignId).get(),
      db.collection("athletes").doc(athleteId).get(),
    ]);

    if (!campaignSnap.exists) {
      throw new HttpsError("not-found", "Campaign not found");
    }

    if (!athleteSnap.exists) {
      throw new HttpsError("not-found", "Athlete not found");
    }

    const campaign = campaignSnap.data() || {};
    const athlete = athleteSnap.data() || {};

    if (campaign.orgId !== profile.orgId || athlete.orgId !== profile.orgId) {
      throw new HttpsError("permission-denied", "Org mismatch");
    }

    if (athlete.campaignId && athlete.campaignId !== campaignId) {
      throw new HttpsError("invalid-argument", "Athlete not assigned to campaign");
    }

    const baseUrl = (() => {
      const fromEnv = (process.env.FRONTEND_URL || "").trim();
      const fromHeader = (request?.rawRequest?.headers?.origin || "").trim();
      return fromEnv || fromHeader;
    })();

    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      throw new HttpsError("failed-precondition", "FRONTEND_URL is not configured");
    }

    const donateUrl = `${baseUrl}/donate/${campaignId}/athlete/${athleteId}`;
    const teamName =
      campaign.teamName ||
      (Array.isArray(campaign.teamNames) ? campaign.teamNames[0] : "") ||
      "our team";
    const campaignName = campaign.name || campaign.title || "our fundraiser";
    const athleteName = athlete.name || "our athlete";

    const contentTemplate =
      typeof template === "string" && template.trim()
        ? template.trim()
        : DEFAULT_DONOR_INVITE_TEMPLATE;

    const bodyText = renderInviteTemplate(contentTemplate, {
      athleteName,
      teamName,
      campaignName,
      donateUrl,
      personalMessage: "",
    });

    const messageSubject =
      typeof subject === "string" && subject.trim()
        ? subject.trim()
        : `Can you support ${athleteName} and ${teamName}?`;

    const contactRefs = contactIds.map((id) =>
      db.collection("athlete_contacts").doc(id)
    );
    const contactSnaps = await db.getAll(...contactRefs);

    const eligibleContacts = [];
    contactSnaps.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (data.orgId !== profile.orgId || data.athleteId !== athleteId) return;
      if (data.status === "donated") return;
      if (data.status === "bounced" || data.status === "complained") return;
      eligibleContacts.push({ id: snap.id, ...data });
    });

    if (eligibleContacts.length === 0) {
      throw new HttpsError("failed-precondition", "No eligible contacts to send");
    }

    let sendResult;
    try {
      sendResult = await sendDripToContacts({
        db,
        orgId: profile.orgId,
        campaignId,
        athleteId,
        contacts: eligibleContacts,
        templateText: bodyText,
        subject: messageSubject,
        phase: phase || "manual",
        isAutomated: false,
      });
    } catch (err) {
      logger.error("sendAthleteDripMessage: send failed", {
        campaignId,
        athleteId,
        uid: request.auth.uid,
        phase: phase || "manual",
        message: err?.message,
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        err?.message || "Failed to send selected messages"
      );
    }

    logger.info("sendAthleteDripMessage: sent", {
      count: sendResult.sentCount,
      failedCount: sendResult.failedCount,
      campaignId,
      athleteId,
      uid: request.auth.uid,
      phase: phase || "manual",
    });

    return {
      ok: true,
      sent: sendResult.sentCount,
      failed: sendResult.failedCount,
      requested: contactIds.length,
    };
  }
);

/* ============================================================
   MAILGUN EVENT WEBHOOK
   - Handles delivered/failed/bounced/complained events
   - Updates athlete_contacts status so athletes can correct bad emails
   ============================================================ */
exports.mailgunEventWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const eventData = getMailgunEventPayload(req.body);
    if (!eventData) {
      return res.status(400).send("Invalid payload");
    }

    const eventType = parseMailgunEventType(eventData);
    const recipient = String(eventData?.recipient || "").trim().toLowerCase();
    const userVars = eventData?.["user-variables"] || {};
    const contactId = String(userVars?.contactId || "").trim();
    const athleteId = String(userVars?.athleteId || "").trim();
    const campaignId = String(userVars?.campaignId || "").trim();
    const orgId = String(userVars?.orgId || "").trim();
    const eventAt = eventData?.timestamp
      ? admin.firestore.Timestamp.fromMillis(Number(eventData.timestamp) * 1000)
      : admin.firestore.FieldValue.serverTimestamp();

    if (!recipient) {
      return res.status(200).send("No recipient");
    }

    const db = admin.firestore();
    const update = {
      lastDeliveryEvent: eventType,
      lastDeliveryAt: eventAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (eventType === "delivered") {
      update.status = "sent";
      update.deliveryStatus = "delivered";
      update.lastDeliveryError = admin.firestore.FieldValue.delete();
    } else if (shouldMarkSuppressed(eventType)) {
      update.status = "bounced";
      update.deliveryStatus = eventType;
      update.bounceCount = admin.firestore.FieldValue.increment(1);
      update.lastDeliveryError =
        eventData?.["delivery-status"]?.description ||
        eventData?.reason ||
        eventData?.severity ||
        eventType;
    } else {
      update.deliveryStatus = eventType;
    }

    let contactRef = null;

    if (contactId) {
      contactRef = db.collection("athlete_contacts").doc(contactId);
      const snap = await contactRef.get();
      if (!snap.exists) {
        contactRef = null;
      }
    }

    if (!contactRef && recipient && athleteId && orgId) {
      const querySnap = await db
        .collection("athlete_contacts")
        .where("orgId", "==", orgId)
        .where("athleteId", "==", athleteId)
        .where("emailLower", "==", recipient)
        .limit(1)
        .get();
      if (!querySnap.empty) {
        contactRef = querySnap.docs[0].ref;
      }
    }

    if (contactRef) {
      await contactRef.set(update, { merge: true });
    }

    await db.collection("message_events").add({
      source: "mailgun",
      eventType,
      recipient,
      contactId: contactId || null,
      athleteId: athleteId || null,
      campaignId: campaignId || null,
      orgId: orgId || null,
      payload: eventData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).send("ok");
  } catch (err) {
    logger.error("mailgunEventWebhook failed", {
      message: err?.message,
      stack: err?.stack,
    });
    return res.status(200).send("ignored");
  }
});

/* ============================================================
   SCHEDULED ATHLETE DRIP (AUTO)
   ============================================================ */
exports.runAthleteDrip = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();

    const athletesSnap = await db
      .collection("athletes")
      .where("drip.autoSendEnabled", "==", true)
      .get();

    if (athletesSnap.empty) {
      logger.info("runAthleteDrip: no athletes enabled");
      return;
    }

    for (const docSnap of athletesSnap.docs) {
      const athlete = docSnap.data() || {};
      const athleteId = docSnap.id;

      if (!athlete.campaignId || !athlete.orgId) continue;

      const [campaignSnap, orgSnap] = await Promise.all([
        db.collection("campaigns").doc(athlete.campaignId).get(),
        db.collection("organizations").doc(athlete.orgId).get(),
      ]);

      if (!campaignSnap.exists) continue;

      const campaign = campaignSnap.data() || {};
      const orgData = orgSnap.exists ? orgSnap.data() || {} : {};

      if (!orgData.dripGlobalEnabled) {
        continue;
      }

      const timeZone = getOrgTimeZone(orgData);
      const startDate = getCampaignStartDate(campaign);
      const endDate =
        campaign.endDate?.toDate?.() ||
        (campaign.endDate?.seconds
          ? new Date(campaign.endDate.seconds * 1000)
          : null);

      if (!startDate) continue;
      if (endDate && now > endDate) continue;

      const schedule = getPhaseSchedule(startDate, timeZone);
      if (!schedule.length) continue;

      const lastPhase = athlete?.drip?.lastPhaseSent || null;
      const lastIndex = lastPhase
        ? schedule.findIndex((p) => p.key === lastPhase)
        : -1;

      const remaining = schedule.slice(lastIndex + 1);
      let duePhase = null;
      let nextPhase = null;

      for (const phase of remaining) {
        if (now >= phase.sendAt) {
          duePhase = phase;
          break;
        }
        if (!nextPhase) {
          nextPhase = phase;
        }
      }

      if (!duePhase) {
        if (nextPhase) {
          await db
            .collection("athletes")
            .doc(athleteId)
            .set(
              {
                drip: {
                  nextPhase: nextPhase.key,
                  nextSendAt: admin.firestore.Timestamp.fromDate(
                    nextPhase.sendAt
                  ),
                },
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
        }
        continue;
      }

      const orgTemplates = orgData.donorInviteTemplates || {};
      const athleteTemplates = athlete.donorInviteTemplates || {};
      const phaseTemplate =
        athleteTemplates[duePhase.key] ||
        orgTemplates[duePhase.key] ||
        orgData.donorInviteTemplate ||
        DEFAULT_DONOR_INVITE_TEMPLATE;

      const donateUrl = `${orgData.frontendUrl || process.env.FRONTEND_URL || ""}/donate/${athlete.campaignId}/athlete/${athleteId}`;
      const templateText = renderInviteTemplate(phaseTemplate, {
        athleteName: athlete.name || athlete.displayName || "our athlete",
        teamName: campaign.teamName || "our team",
        campaignName: campaign.name || campaign.title || "our fundraiser",
        donateUrl,
        personalMessage: "",
      });

      const orgSubjects = orgData.donorInviteSubjects || {};
      const subject =
        orgSubjects[duePhase.key] ||
        DRIP_SUBJECTS[duePhase.key] ||
        "Fundraiser update";

      const contactsSnap = await db
        .collection("athlete_contacts")
        .where("orgId", "==", athlete.orgId)
        .where("athleteId", "==", athleteId)
        .get();

      const contacts = contactsSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter(
          (contact) =>
            contact.status !== "donated" &&
            contact.status !== "bounced" &&
            contact.status !== "complained"
        );

      if (contacts.length === 0) {
        continue;
      }

      let sendResult;
      try {
        sendResult = await sendDripToContacts({
          db,
          orgId: athlete.orgId,
          campaignId: athlete.campaignId,
          athleteId,
          contacts,
          templateText,
          subject,
          phase: duePhase.key,
          isAutomated: true,
        });
      } catch (err) {
        logger.error("runAthleteDrip: send failed", {
          athleteId,
          campaignId: athlete.campaignId,
          phase: duePhase.key,
          message: err?.message,
          stack: err?.stack,
        });
        continue;
      }

      const afterIndex = schedule.findIndex((p) => p.key === duePhase.key) + 1;
      const next = schedule[afterIndex] || null;

      await db
        .collection("athletes")
        .doc(athleteId)
        .set(
          {
            drip: next
              ? {
                  nextPhase: next.key,
                  nextSendAt: admin.firestore.Timestamp.fromDate(next.sendAt),
                }
              : {
                  nextPhase: null,
                  nextSendAt: null,
                },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      logger.info("runAthleteDrip: sent", {
        athleteId,
        phase: duePhase.key,
        contacts: sendResult.sentCount,
        failedCount: sendResult.failedCount,
      });
    }
  }
);

/* ============================================================
   MAILGUN API - TEST SEND (ADMIN ONLY)
   ============================================================ */
exports.testMailgunSend = onCall(
  {
    secrets: ["MAILGUN_API_KEY"],
    timeoutSeconds: 20,
  },
  async (request) => {
    await assertAdmin(request);

    const { toEmail } = request.data || {};
    if (!toEmail || typeof toEmail !== "string") {
      throw new HttpsError("invalid-argument", "toEmail is required");
    }

    const { client, domain } = getMailgunClient();
    const from = `Fundraising MVP <no-reply@${domain}>`;

    try {
      await client.messages.create(domain, {
        from,
        to: [toEmail],
        subject: "Mailgun API test",
        text: "Test message from Fundraising MVP.",
      });

      logger.info("testMailgunSend: sent", { toEmail });
      return { ok: true };
    } catch (err) {
      logger.error("testMailgunSend failed", {
        message: err?.message,
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        err?.message || "Failed to send test message"
      );
    }
  }
);

/* ============================================================
   COACH INVITE SENDER (RESTORED)
   - If you previously called this from UI, keep the same export name.
   ============================================================ */
exports.sendCoachInvite = onCall(async (request) => {
  // You can optionally enforce RBAC here by checking request.auth and users/{uid}.
  const { toEmail, inviteUrl, teamName } = request.data || {};

  if (!toEmail || typeof toEmail !== "string") {
    throw new HttpsError("invalid-argument", "Missing toEmail");
  }
  if (!inviteUrl || typeof inviteUrl !== "string") {
    throw new HttpsError("invalid-argument", "Missing inviteUrl");
  }

  try {
    await admin.firestore().collection("mail").add({
      to: toEmail,
      message: {
        subject: "You’ve been invited as a coach",
        html: `
          <div style="font-family: Arial, sans-serif;">
            <h2>Coach Invite</h2>
            <p>You’ve been invited to join${teamName ? ` <b>${teamName}</b>` : ""}.</p>
            <p><a href="${inviteUrl}">Accept Invite</a></p>
          </div>
        `,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true };
  } catch (err) {
    logger.error("sendCoachInvite failed", { message: err?.message, stack: err?.stack });
    throw new HttpsError("internal", err?.message || "Failed to send invite");
  }
});

/* ============================================================
   STRIPE CHECKOUT SESSION CREATOR (CALLABLE)
   - Called from PublicCampaign.jsx via httpsCallableFromURL(...)
   - Requires STRIPE_SECRET_KEY secret
   - Uses FRONTEND_URL (or request Origin header) for redirect URLs
   ============================================================ */
exports.createCheckoutSession = onCall(
  {
    secrets: ["STRIPE_SECRET_KEY"],
    timeoutSeconds: 20,
    memory: "256MiB",
  },
  async (request) => {
    try {
      const data = request.data || {};
      const campaignId = data.campaignId;
      const athleteId = data.athleteId || "";
      const donorName = data.donorName || "";
      const donorEmail = data.donorEmail || "";
      const donorMessageRaw = data.donorMessage || "";
      const donorAnonymous = !!data.donorAnonymous;
      const donorMessage =
        typeof donorMessageRaw === "string"
          ? donorMessageRaw.trim().slice(0, 500)
          : "";

      // Accept either amountCents (preferred) or amount (legacy)
      let amountCents;

        if (data.amountCents != null) {
        // Already in cents (preferred future-safe path)
        amountCents = Number(data.amountCents);
        } else {
        // UI sends dollars → convert ONCE
        amountCents = Math.round(Number(data.amount) * 100);
        }

      if (!campaignId || typeof campaignId !== "string") {
        throw new HttpsError("invalid-argument", "Invalid campaignId");
      }

      if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > 250000) {
        throw new HttpsError("invalid-argument", "Invalid donation amount");
      }

      const baseUrl = (() => {
        const fromEnv = (process.env.FRONTEND_URL || "").trim();
        const fromHeader = (request?.rawRequest?.headers?.origin || "").trim();
        return fromEnv || fromHeader;
      })();

      if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
        throw new HttpsError(
          "failed-precondition",
          `FRONTEND_URL must be set to an absolute URL (e.g., http://localhost:5173). Got: "${
            baseUrl || "EMPTY"
          }"`
        );
      }

      // IMPORTANT (Gen 2): initialize Stripe INSIDE the handler after secrets are injected
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      const snap = await admin.firestore().collection("campaigns").doc(campaignId).get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Campaign not found");
      }

      const campaign = snap.data() || {};
      const campaignName = (campaign.name || campaign.title || "Campaign").toString();

      const successUrl = `${baseUrl}/donate-success?campaignId=${campaignId}&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${baseUrl}/donate/${campaignId}`;

      logger.info("Creating Stripe checkout session", {
        campaignId,
        amountCents,
        baseUrl,
        hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
        keyPrefix: (process.env.STRIPE_SECRET_KEY || "").slice(0, 8),
      });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: donorEmail || undefined,
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Donation — ${campaignName}`,
              },
              unit_amount: Math.round(amountCents),
            },
            quantity: 1,
          },
        ],
        metadata: {
          campaignId,
          athleteId: athleteId || "",
          donorName: donorName || "",
          donorAnonymous: donorAnonymous ? "true" : "false",
          donorMessage,
          orgId: campaign.orgId || "",
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return { url: session.url };
    } catch (err) {
      logger.error("createCheckoutSession failed", {
        message: err?.message,
        stack: err?.stack,
        type: err?.type,
        code: err?.code,
        raw: err?.raw,
      });

      if (err instanceof HttpsError) {
        throw err;
      }

      const message =
        err?.raw?.message || err?.message || "Stripe checkout session creation failed";
      throw new HttpsError("internal", message);
    }
  }
);

/* ============================================================
   STRIPE WEBHOOK — DONATION WRITE (FIXED)
   - Verifies signature using req.rawBody
   - Handles checkout.session.completed
   - Writes donation doc with ID = session.id (cs_test_...)
   - Idempotent merge write
   ============================================================ */
exports.stripeWebhook = onRequest(
  {
    region: "us-central1",

    // 🔑 THIS IS THE FIX
    allowUnauthenticated: true,

    maxInstances: 5,
    timeoutSeconds: 20,
    memory: "256MiB",

    secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  },
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (!sig) {
      logger.error("stripeWebhook: missing stripe-signature header");
      return res.status(400).send("Missing stripe-signature");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      logger.error("stripeWebhook: signature verification failed", {
        message: err?.message,
      });
      return res.status(400).send("Invalid signature");
    }

    try {
      logger.info("stripeWebhook: received event", {
        type: event.type,
        id: event.id,
      });

      if (
        event.type === "checkout.session.completed" &&
        event.data.object.payment_status === "paid"
      ) {
        const session = event.data.object;

        const db = admin.firestore();
        const donationRef = db.collection("donations").doc(session.id);
        const campaignId = session.metadata?.campaignId || null;
        const athleteId = session.metadata?.athleteId || null;
        const campaignRef = campaignId ? db.collection("campaigns").doc(campaignId) : null;
        const athleteRef = athleteId ? db.collection("athletes").doc(athleteId) : null;
        const commentRef = campaignRef ? campaignRef.collection("comments").doc(session.id) : null;
        const amountCents = enforceCents(session.amount_total);
        const donorEmail =
          session.customer_details?.email ||
          session.customer_email ||
          null;
        const donorName =
          session.customer_details?.name ||
          session.metadata?.donorName ||
          "Anonymous";
        const donorCommentRaw = session.metadata?.donorMessage || "";
        const donorComment =
          typeof donorCommentRaw === "string"
            ? donorCommentRaw.trim().slice(0, 500)
            : "";
        const donorAnonymous = session.metadata?.donorAnonymous === "true";
        const displayName = donorAnonymous
          ? "Anonymous"
          : donorName || "Supporter";

        logger.info("stripeWebhook: about to write donation", {
          sessionId: session.id,
        });

        const mailRef = donorEmail
          ? db.collection("mail").doc(`receipt_${session.id}`)
          : null;

        await db.runTransaction(async (tx) => {
          const donationSnap = await tx.get(donationRef);
          const alreadyPaid =
            donationSnap.exists && donationSnap.data()?.status === "paid";

          if (!alreadyPaid) {
            tx.set(
              donationRef,
              {
                sessionId: session.id,
                orgId: session.metadata?.orgId || null,
                campaignId,
                athleteId,
                donorName,
                donorEmail,
                amount: amountCents,
                currency: session.currency || "usd",
                status: "paid",
                stripeEventId: event.id,
                stripeEventType: event.type,
                stripePaymentIntent: session.payment_intent || null,
                stripeCustomer: session.customer || null,
                stripeLivemode: !!event.livemode,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            if (campaignRef) {
              tx.set(
                campaignRef,
                {
                  publicTotalRaisedCents: admin.firestore.FieldValue.increment(
                    amountCents
                  ),
                  publicDonorCount: admin.firestore.FieldValue.increment(1),
                  publicLastDonationAt:
                    admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
            }

            if (athleteRef) {
              tx.set(
                athleteRef,
                {
                  publicTotalRaisedCents: admin.firestore.FieldValue.increment(
                    amountCents
                  ),
                  publicDonorCount: admin.firestore.FieldValue.increment(1),
                  publicLastDonationAt:
                    admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              );
            }

          }
        });

        if (commentRef && donorComment) {
          try {
            await commentRef.create({
              displayName,
              message: donorComment,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              amountCents,
              isAnonymous: donorAnonymous,
            });
          } catch (err) {
            if (err?.code !== 6) {
              throw err;
            }
          }
        }

        if (campaignRef) {
          const donorsRef = campaignRef
            .collection("public_donors")
            .doc(session.id);
          try {
            await donorsRef.create({
              displayName,
              amountCents,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              isAnonymous: donorAnonymous,
              athleteId,
            });
          } catch (err) {
            if (err?.code !== 6) {
              throw err;
            }
          }
        }

        if (donorEmail && athleteId) {
          const emailLower = String(donorEmail).toLowerCase();
          const contactSnap = await db
            .collection("athlete_contacts")
            .where("orgId", "==", session.metadata?.orgId || "")
            .where("athleteId", "==", athleteId)
            .where("emailLower", "==", emailLower)
            .get();

          if (!contactSnap.empty) {
            const updates = [];
            contactSnap.forEach((contactDoc) => {
              updates.push(
                contactDoc.ref.set(
                  {
                    status: "donated",
                    donatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  { merge: true }
                )
              );
            });
            await Promise.all(updates);
          }
        }

        if (donorEmail && mailRef) {
          try {
            await mailRef.create({
              to: donorEmail,
              message: {
                subject: "Thank you for your donation!",
                html: `
                  <div style="font-family: Arial, sans-serif;">
                    <h2>Thank you!</h2>
                    <p>We received your donation.</p>
                    <p><b>Amount:</b> $${(amountCents / 100).toFixed(2)}</p>
                    <p><b>Campaign:</b> ${session.metadata?.campaignId || ""}</p>
                    <p>Fundraising MVP</p>
                  </div>
                `,
              },
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (err) {
            if (err?.code !== 6) {
              throw err;
            }
          }
        }

        logger.info("stripeWebhook: donation saved", {
          sessionId: session.id,
        });
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error("stripeWebhook: handler failed", {
        message: err?.message,
        stack: err?.stack,
      });
      return res.status(500).send("Webhook handler error");
    }
  }
);
/* ============================================================
   PHASE 13.3 — RECONCILE STRIPE ↔ FIRESTORE (ADMIN ONLY)
   - Compares Stripe paid checkout sessions to Firestore donations/{session.id}
   - Read-only (no repairs)
   ============================================================ */
exports.reconcileStripeToFirestore = onCall(
  {
    secrets: ["STRIPE_SECRET_KEY"],
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    const profile = await assertAdmin(request);

    const { startISO, endISO, orgId } = request.data || {};
    if (!startISO || !endISO) {
      throw new HttpsError("invalid-argument", "Provide startISO and endISO (ISO date strings)");
    }

    const start = new Date(startISO);
    const end = new Date(endISO);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      throw new HttpsError("invalid-argument", "Invalid date range");
    }

    // If orgId is provided, super-admin can check any org; admin can only check their own org.
    const effectiveOrgId = orgId || profile.orgId || null;
    if (effectiveOrgId && profile.role !== "super-admin" && effectiveOrgId !== profile.orgId) {
      throw new HttpsError("permission-denied", "Admins may only reconcile their own org");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // 1) Pull Stripe sessions (paginated) within date range
    // Stripe uses unix seconds for created filters.
    const created = {
      gte: Math.floor(start.getTime() / 1000),
      lt: Math.floor(end.getTime() / 1000),
    };

    const stripePaid = [];
    let starting_after = undefined;

    while (true) {
      const page = await stripe.checkout.sessions.list({
        limit: 100,
        created,
        starting_after,
      });

      for (const s of page.data || []) {
        // We only count sessions that are paid
        if (s.payment_status === "paid") {
          // Optional org filter (if metadata has orgId)
          if (!effectiveOrgId || (s.metadata && s.metadata.orgId === effectiveOrgId)) {
            stripePaid.push(s);
          }
        }
      }

      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1]?.id;
      if (!starting_after) break;
    }

    // 2) Load Firestore donations in same date range (createdAt)
    // NOTE: createdAt is serverTimestamp; ensure index exists if needed.
    let fsQuery = admin
      .firestore()
      .collection("donations")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start))
      .where("createdAt", "<", admin.firestore.Timestamp.fromDate(end));

    if (effectiveOrgId) {
      fsQuery = fsQuery.where("orgId", "==", effectiveOrgId);
    }

    const fsSnap = await fsQuery.get();
    const firestoreDocs = new Map(); // id -> data
    fsSnap.forEach((d) => firestoreDocs.set(d.id, d.data() || {}));

    // 3) Compare
    const missingInFirestore = [];
    const mismatches = [];

    for (const s of stripePaid) {
      const fs = firestoreDocs.get(s.id);
      if (!fs) {
        missingInFirestore.push(s.id);
        continue;
      }

      // amount_total is cents in Stripe; Firestore should store cents
      const stripeAmount = Number(s.amount_total ?? 0);
      const fsAmount = Number(fs.amount ?? 0);

      if (stripeAmount !== fsAmount) {
        mismatches.push({
          id: s.id,
          field: "amount",
          stripe: stripeAmount,
          firestore: fsAmount,
        });
      }

      const stripeCurrency = (s.currency || "usd").toLowerCase();
      const fsCurrency = (fs.currency || "usd").toLowerCase();
      if (stripeCurrency !== fsCurrency) {
        mismatches.push({
          id: s.id,
          field: "currency",
          stripe: stripeCurrency,
          firestore: fsCurrency,
        });
      }

      const fsStatus = (fs.status || "").toLowerCase();
      if (fsStatus && fsStatus !== "paid") {
        mismatches.push({
          id: s.id,
          field: "status",
          stripe: "paid",
          firestore: fsStatus,
        });
      }
    }

    // Extra in Firestore = paid docs that don’t exist in Stripe list
    const stripeIds = new Set(stripePaid.map((s) => s.id));
    const extraInFirestore = [];
    for (const [id, fs] of firestoreDocs.entries()) {
      const status = (fs.status || "").toLowerCase();
      if (status === "paid" && !stripeIds.has(id)) {
        extraInFirestore.push(id);
      }
    }

    return {
      range: { startISO, endISO },
      orgId: effectiveOrgId,
      stripePaidSessions: stripePaid.length,
      firestoreDocsInRange: fsSnap.size,
      missingInFirestore,
      extraInFirestore,
      mismatches,
      note:
        "Read-only reconciliation. For best results, ensure donations createdAt is set and metadata.orgId is present on Stripe sessions.",
    };
  }
);
/* ============================================================
   PHASE 13.3 — DAILY DONATION ROLLUPS (WRITE-ONCE)
   - Computes per-org daily totals from donations
   - Idempotent: skips if rollup already exists
   - Safe for audits and dashboards
   ============================================================ */
exports.dailyDonationRollups = onSchedule(
  {
    schedule: "every day 02:00",
    timeZone: "America/Los_Angeles",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();

    // Roll up "yesterday" in local time
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const dateKey = start.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD

    logger.info("dailyDonationRollups: starting", {
      dateKey,
      start: start.toISOString(),
      end: end.toISOString(),
    });

    const snap = await db
      .collection("donations")
      .where("status", "==", "paid")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start))
      .where("createdAt", "<", admin.firestore.Timestamp.fromDate(end))
      .get();

    if (snap.empty) {
      logger.info("dailyDonationRollups: no donations found", { dateKey });
      return;
    }

    const rollups = new Map();

    snap.forEach((doc) => {
      const d = doc.data() || {};
      const orgId = d.orgId;
      const campaignId = d.campaignId || "unknown";
      const amount = Number(d.amount || 0);

      if (!orgId || !Number.isFinite(amount) || amount <= 0) return;

      if (!rollups.has(orgId)) {
        rollups.set(orgId, {
          orgId,
          dateKey,
          totalAmountCents: 0,
          donationCount: 0,
          byCampaign: {},
        });
      }

      const r = rollups.get(orgId);
      r.totalAmountCents += amount;
      r.donationCount += 1;

      if (!r.byCampaign[campaignId]) {
        r.byCampaign[campaignId] = { amountCents: 0, count: 0 };
      }

      r.byCampaign[campaignId].amountCents += amount;
      r.byCampaign[campaignId].count += 1;
    });

    const writes = [];

    for (const [orgId, data] of rollups.entries()) {
      const docId = `${orgId}_${dateKey}`;
      const ref = db.collection("donation_rollups").doc(docId);

      writes.push(
        ref.get().then((existing) => {
          if (existing.exists) {
            logger.info("dailyDonationRollups: already exists, skipping", { docId });
            return null;
          }

          return ref.set({
            ...data,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        })
      );
    }

    await Promise.all(writes);

    logger.info("dailyDonationRollups: complete", {
      orgsProcessed: rollups.size,
      dateKey,
    });
  }
);


