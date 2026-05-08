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
const crypto = require("crypto");

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

async function assertSuperAdmin(request) {
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

  if (String(profile.role || "").toLowerCase() !== "super-admin") {
    throw new HttpsError("permission-denied", "Super-admin access required");
  }

  return profile;
}

async function deleteQueryDocs(db, snap) {
  if (!snap || snap.empty) return 0;
  let count = 0;
  let batch = db.batch();
  let batchSize = 0;

  for (const entry of snap.docs) {
    batch.delete(entry.ref);
    count += 1;
    batchSize += 1;
    if (batchSize >= 450) {
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  return count;
}

async function updateQueryDocs(db, snap, data) {
  if (!snap || snap.empty) return 0;
  let count = 0;
  let batch = db.batch();
  let batchSize = 0;

  for (const entry of snap.docs) {
    batch.update(entry.ref, data);
    count += 1;
    batchSize += 1;
    if (batchSize >= 450) {
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  return count;
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

const WEBHOOK_ALERT_WINDOW_MINUTES = 10;
const WEBHOOK_ALERT_THRESHOLD = 3;
const WEBHOOK_ALERT_COOLDOWN_MINUTES = 30;
const PREFERRED_FRONTEND_URL = "https://inetsphere.com";
const LEGACY_FRONTEND_HOSTS = new Set(["fundraising-mvp.vercel.app"]);

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

function normalizePercent(rate) {
  const numeric = Number(rate);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric > 1 ? numeric / 100 : numeric;
}

function calculatePlatformFeeCents(amountCents, rate) {
  const normalizedRate = normalizePercent(rate);
  if (!normalizedRate) return 0;
  return Math.round(enforceCents(amountCents) * normalizedRate);
}

function estimateStripeProcessingFeeCents(amountCents) {
  const amount = enforceCents(amountCents);
  if (amount <= 0) return 0;
  // Stripe card estimate fallback (US): 2.9% + 30c.
  return Math.round(amount * 0.029) + 30;
}

async function buildExactDonationFeeFields({
  stripe,
  paymentIntentId,
  amountCents,
  platformFeeRate,
}) {
  const normalizedPlatformFeeRate = normalizePercent(platformFeeRate);
  let latestCharge = null;
  let balanceTransaction = null;

  if (paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });
    latestCharge =
      paymentIntent?.latest_charge &&
      typeof paymentIntent.latest_charge === "object"
        ? paymentIntent.latest_charge
        : null;
    balanceTransaction =
      latestCharge?.balance_transaction &&
      typeof latestCharge.balance_transaction === "object"
        ? latestCharge.balance_transaction
        : null;
  }

  const stripeFeeCents = enforceCents(balanceTransaction?.fee || 0);
  const stripeNetCents = enforceCents(balanceTransaction?.net || 0);
  const platformFeeCents = calculatePlatformFeeCents(
    amountCents,
    normalizedPlatformFeeRate
  );
  const processingFeeCents = stripeFeeCents;
  const totalFeeCents = stripeFeeCents + platformFeeCents;
  const netAmountCents =
    stripeNetCents > 0
      ? stripeNetCents - platformFeeCents
      : amountCents - totalFeeCents;

  return {
    stripeFeeCents,
    processingFeeCents,
    platformFeeRate: normalizedPlatformFeeRate,
    platformFeeCents,
    totalFeeCents,
    netAmountCents,
    stripeChargeId: latestCharge?.id || null,
    stripeBalanceTransactionId: balanceTransaction?.id || null,
    hasExactStripeFee: !!balanceTransaction?.id,
  };
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
const DEFAULT_LATE_CONTACT_TEMPLATE = `Hi there,

I am reaching out because my team is currently fundraising for our season. Every donation helps with important costs and supports the team as we work toward our goals together.

If you would like to help, your support would truly mean a lot.

Donate here: {{donateUrl}}

Thank you for being part of it.`;

function renderInviteTemplate(template, data) {
  const base = (template || DEFAULT_DONOR_INVITE_TEMPLATE).toString();
  const replacements = {
    athleteName: data.athleteName || "Our athlete",
    senderName: data.senderName || data.athleteName || "Our athlete",
    teamName: data.teamName || "our team",
    campaignName: data.campaignName || "our fundraiser",
    donateUrl: data.donateUrl || "",
    personalMessage: data.personalMessage || "",
  };

  let output = base;
  const placeholderAliases = {
    athleteName: ["athleteName", "ATHLETE_NAME"],
    senderName: ["senderName", "SENDER_NAME"],
    teamName: ["teamName", "TEAM_NAME"],
    campaignName: ["campaignName", "CAMPAIGN_NAME"],
    donateUrl: ["donateUrl", "DONATION_LINK", "donationLink"],
    personalMessage: ["personalMessage", "PERSONAL_MESSAGE"],
  };
  Object.keys(placeholderAliases).forEach((replacementKey) => {
    const value = replacements[replacementKey];
    placeholderAliases[replacementKey].forEach((alias) => {
      output = output.replace(
        new RegExp(`{{\\s*${alias}\\s*}}`, "g"),
        value
      );
    });
  });

  if (
    !/{{\s*(personalMessage|PERSONAL_MESSAGE)\s*}}/.test(base) &&
    replacements.personalMessage
  ) {
    output = `${output}\n\n${replacements.personalMessage}`;
  }

  if (
    !/{{\s*(donateUrl|DONATION_LINK|donationLink)\s*}}/.test(base) &&
    replacements.donateUrl
  ) {
    output = `${output}\n\nDonate here: ${replacements.donateUrl}`;
  }

  output = output.replace(/\n{3,}/g, "\n\n").trim();
  return output;
}

const EMAIL_CONTEXT_REQUIREMENTS = {
  donor_invite: ["athleteName", "teamName", "campaignName", "donateUrl"],
  drip_phase: ["athleteName", "teamName", "campaignName", "donateUrl"],
  drip_late_intro: ["athleteName", "teamName", "campaignName", "donateUrl"],
};

const ALLOWED_UNRESOLVED_EMAIL_TOKENS = new Set([
  "recipientFirstName",
  "RECIPIENT_FIRST_NAME",
  "FIRST_NAME",
  "recipientGreeting",
  "RECIPIENT_GREETING",
]);

function extractUnresolvedTemplateTokens(text) {
  const tokens = [];
  const regex = /{{\s*([^}\s]+)\s*}}/g;
  let match = regex.exec(String(text || ""));
  while (match) {
    tokens.push(match[1]);
    match = regex.exec(String(text || ""));
  }
  return tokens;
}

function buildEmailFromContext({ emailKind, template, context, fallbackTemplate }) {
  const normalizedKind = String(emailKind || "").trim();
  const requiredKeys = EMAIL_CONTEXT_REQUIREMENTS[normalizedKind] || [];
  const missingKeys = requiredKeys.filter((key) => !String(context?.[key] || "").trim());
  if (missingKeys.length) {
    throw new Error(
      `buildEmailFromContext: missing required context for ${normalizedKind || "unknown"}: ${missingKeys.join(", ")}`
    );
  }

  const rendered = renderInviteTemplate(template || fallbackTemplate, context || {});
  const unresolved = extractUnresolvedTemplateTokens(rendered).filter(
    (token) => !ALLOWED_UNRESOLVED_EMAIL_TOKENS.has(token)
  );
  if (unresolved.length) {
    throw new Error(
      `buildEmailFromContext: unresolved placeholders for ${normalizedKind || "unknown"}: ${unresolved.join(", ")}`
    );
  }

  return rendered;
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
  lateIntro: "A personal fundraiser update from our team",
};

function timestampToDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (Number.isFinite(value?.seconds)) return new Date(value.seconds * 1000);
  if (value instanceof Date) return value;
  return null;
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractFirstName(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  return raw.split(/\s+/)[0] || "";
}

function applyRecipientPlaceholders(text, contact) {
  const firstName = extractFirstName(
    contact?.firstName || contact?.name || contact?.toName || ""
  );
  let output = String(text || "");
  output = output.replace(
    /{{\s*(recipientFirstName|RECIPIENT_FIRST_NAME|FIRST_NAME)\s*}}/g,
    firstName
  );
  output = output.replace(
    /{{\s*(recipientGreeting|RECIPIENT_GREETING)\s*}}/g,
    firstName ? `Hello ${firstName},` : "Hello,"
  );
  if (firstName) {
    // If template uses a plain standalone greeting line, personalize it.
    output = output.replace(/^\s*Hello\s*,?\s*$/m, `Hello ${firstName},`);
  }
  output = output.replace(/Hello\s+,/g, "Hello,");
  // Keep a readable blank line after greetings.
  output = output.replace(/^(Hello(?:\s+\S+)?,)\s+(?=\S)/m, "$1\n\n");
  output = output.replace(/^(Hello(?:\s+\S+)?,)\n(?!\n)/m, "$1\n\n");
  output = output.replace(/\n{3,}/g, "\n\n").trim();
  return output;
}

function renderEmailHtml(text) {
  const paragraphs = String(text || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 12px; line-height:1.5;">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

function renderTransactionalShell({
  subject,
  bodyText,
  ctaLabel = "",
  ctaUrl = "",
  footerText = "",
}) {
  const bodyHtml = renderEmailHtml(bodyText || "");
  const ctaHtml =
    ctaLabel && ctaUrl
      ? `<p style="margin:16px 0 0 0;">
          <a href="${escapeHtml(ctaUrl)}"
             style="display:inline-block;padding:11px 16px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
            ${escapeHtml(ctaLabel)}
          </a>
        </p>`
      : "";
  const footerNote = footerText
    ? `<p style="margin:0 0 8px 0;font-size:12px;color:#64748b;line-height:1.45;">${escapeHtml(footerText)}</p>`
    : "";
  return `
    <div style="background:#f8fafc;padding:24px;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:#0f172a;padding:12px 20px;">
          <p style="margin:0;color:#ffffff;font-size:13px;font-weight:600;letter-spacing:.02em;">Fundraising MVP</p>
        </div>
        <div style="padding:20px;">
          <h2 style="margin:0 0 14px 0;font-size:20px;line-height:1.3;">${escapeHtml(subject || "Fundraising MVP Update")}</h2>
        ${bodyHtml || `<p style="margin:0;line-height:1.5;">Thank you for supporting Fundraising MVP.</p>`}
        ${ctaHtml}
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />
        ${footerNote}
        <p style="margin:0;font-size:12px;color:#64748b;">Fundraising MVP</p>
      </div>
      </div>
    </div>
  `;
}

async function resolveTeamName(db, { athlete = {}, campaign = {} }) {
  const teamId = String(athlete.teamId || campaign.teamId || "").trim();
  const explicitTeamName =
    athlete.teamName ||
    campaign.teamName ||
    (Array.isArray(campaign.teamNames) ? campaign.teamNames[0] : "");
  if (explicitTeamName && String(explicitTeamName).trim()) {
    const normalizedExplicit = String(explicitTeamName).trim();
    if (!teamId || normalizedExplicit !== teamId) {
      return normalizedExplicit;
    }
  }

  if (!teamId) {
    return "our team";
  }

  try {
    const teamSnap = await db.collection("teams").doc(teamId).get();
    if (teamSnap.exists) {
      const teamData = teamSnap.data() || {};
      const resolvedName = String(teamData.name || teamData.teamName || "").trim();
      if (resolvedName) {
        return resolvedName;
      }
    }
  } catch (_) {
    // Defensive fallback for legacy/missing team records.
  }

  return "our team";
}

async function getOrganizationName(db, orgId) {
  const normalizedOrgId = String(orgId || "").trim();
  if (!normalizedOrgId) {
    return "";
  }

  try {
    const orgSnap = await db.collection("organizations").doc(normalizedOrgId).get();
    if (!orgSnap.exists) {
      return "";
    }
    const orgData = orgSnap.data() || {};
    return String(orgData.name || orgData.orgName || "").trim();
  } catch (_) {
    return "";
  }
}

function normalizeFrontendBaseUrl(rawUrl) {
  const fallbackUrl = PREFERRED_FRONTEND_URL;
  const raw = String(rawUrl || "").trim();
  if (!raw) return fallbackUrl;

  try {
    const parsed = new URL(raw);
    const hostname = String(parsed.hostname || "").toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".local")
    ) {
      return parsed.origin;
    }
    if (LEGACY_FRONTEND_HOSTS.has(hostname)) {
      return fallbackUrl;
    }
    return parsed.origin;
  } catch (_) {
    return fallbackUrl;
  }
}

async function buildDripRenderPayload({ profile, athleteId, phase }) {
  const db = admin.firestore();
  const athleteSnap = await db.collection("athletes").doc(athleteId).get();
  if (!athleteSnap.exists) {
    throw new HttpsError("not-found", "Athlete not found");
  }

  const athlete = athleteSnap.data() || {};
  if (!athlete.orgId) {
    throw new HttpsError("failed-precondition", "Athlete org is missing");
  }
  if (profile.role !== "super-admin" && athlete.orgId !== profile.orgId) {
    throw new HttpsError("permission-denied", "Org mismatch");
  }
  if (!athlete.campaignId) {
    throw new HttpsError("failed-precondition", "Athlete is not assigned to a campaign");
  }

  const [campaignSnap, orgSnap] = await Promise.all([
    db.collection("campaigns").doc(athlete.campaignId).get(),
    db.collection("organizations").doc(athlete.orgId).get(),
  ]);
  if (!campaignSnap.exists) {
    throw new HttpsError("not-found", "Campaign not found");
  }

  const campaign = campaignSnap.data() || {};
  const orgData = orgSnap.exists ? orgSnap.data() || {} : {};
  const baseUrl = normalizeFrontendBaseUrl(
    orgData.frontendUrl || process.env.FRONTEND_URL || ""
  );
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    throw new HttpsError("failed-precondition", "FRONTEND_URL is not configured");
  }

  const donateUrl = `${baseUrl}/donate/${athlete.campaignId}/athlete/${athleteId}`;
  const athleteName = athlete.name || athlete.displayName || "our athlete";
  const teamName = await resolveTeamName(db, { athlete, campaign });
  const campaignName = campaign.name || campaign.title || "our fundraiser";
  const orgTemplates = orgData.donorInviteTemplates || {};
  const athleteTemplates = athlete.donorInviteTemplates || {};
  const orgSubjects = orgData.donorInviteSubjects || {};
  const templateKey = phase || "week1a";
  const template =
    athleteTemplates[templateKey] ||
    orgTemplates[templateKey] ||
    orgData.donorInviteTemplate ||
    DEFAULT_DONOR_INVITE_TEMPLATE;
  const subject =
    orgSubjects[templateKey] ||
    DRIP_SUBJECTS[templateKey] ||
    "Fundraiser update";
  const bodyText = buildEmailFromContext({
    emailKind: "drip_phase",
    template,
    fallbackTemplate: DEFAULT_DONOR_INVITE_TEMPLATE,
    context: {
    athleteName,
    senderName: athleteName,
    teamName,
    campaignName,
    donateUrl,
    personalMessage: athlete.inviteMessage || "",
    },
  });

  return {
    athleteId,
    athleteName,
    teamName,
    campaignId: athlete.campaignId,
    campaignName,
    orgId: athlete.orgId,
    donateUrl,
    subject,
    bodyText,
    phase: templateKey,
  };
}

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

function getWebhookAlertEmail() {
  return (
    (process.env.WEBHOOK_ALERT_EMAIL || "").trim() ||
    (process.env.ALERT_EMAIL || "").trim() ||
    ""
  );
}

function logOutboundEmailAudit({
  source = "unknown",
  kind = "unknown",
  to = null,
  recipientCount = null,
  orgId = null,
  campaignId = null,
  athleteId = null,
  templateVersion = null,
  subject = null,
}) {
  logger.info("emailAudit: outbound", {
    source,
    kind,
    to: to || null,
    recipientCount: Number.isFinite(recipientCount) ? recipientCount : null,
    orgId: orgId || null,
    campaignId: campaignId || null,
    athleteId: athleteId || null,
    templateVersion: templateVersion || null,
    subject: subject || null,
  });
}

async function recordWebhookFailure(source, data = {}) {
  try {
    await admin.firestore().collection("webhook_failures").add({
      source,
      reason: data.reason || "unknown",
      eventId: data.eventId || null,
      eventType: data.eventType || null,
      httpStatus: data.httpStatus || null,
      details: data.details || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    logger.error("recordWebhookFailure: write failed", {
      source,
      message: err?.message,
    });
  }
}

function inferAthleteIdFromReferer(referer, campaignId) {
  const value = String(referer || "").trim();
  if (!value || !campaignId) return "";
  // Matches /donate/{campaignId}/athlete/{athleteId} with optional query/hash suffix.
  const escapedCampaignId = String(campaignId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`/donate/${escapedCampaignId}/athlete/([^/?#]+)`, "i");
  const match = value.match(re);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
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

  const sends = validContacts.map((contact) =>
    {
      const personalizedText = applyRecipientPlaceholders(templateText, contact);
      const personalizedHtml = renderTransactionalShell({
        subject,
        bodyText: personalizedText,
      });
      return client.messages.create(domain, {
        from,
        to: [contact.email],
        subject,
        text: personalizedText,
        html: personalizedHtml,
        "v:contactId": contact.id,
        "v:athleteId": athleteId,
        "v:campaignId": campaignId,
        "v:orgId": orgId,
      });
    }
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
    const contactUpdate =
      phase === "lateIntro"
        ? {
            status: "sent",
            lateIntroPending: false,
            lateIntroSentAt: now,
            joinedDripAt: now,
            updatedAt: now,
          }
        : {
            status: "sent",
            lastSentAt: now,
            lastPhase: phase,
            updatedAt: now,
          };
    batch.set(
      contactRef,
      contactUpdate,
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
      body: applyRecipientPlaceholders(templateText, contact),
      channel: "email",
      phase,
      isAutomated: !!isAutomated,
      createdAt: now,
    });
  });

  if (phase !== "lateIntro") {
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
  }

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

  logOutboundEmailAudit({
    source: "direct_mailgun",
    kind: "athlete_drip",
    recipientCount: sentContacts.length,
    orgId,
    campaignId,
    athleteId,
    templateVersion: `drip-${phase || "unknown"}-v1`,
    subject,
  });

  return {
    sentCount: sentContacts.length,
    failedCount: failedRecipients.length,
  };
}

async function sendCustomMessageToContacts({
  db,
  orgId,
  campaignId = null,
  athleteId,
  contacts,
  subject,
  bodyText,
  senderLabel,
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
  const displaySender = String(senderLabel || "Fundraising MVP").trim() || "Fundraising MVP";
  const from = `${displaySender} <no-reply@${domain}>`;
  const footerText = `${displaySender} sent this message through Fundraising MVP.`;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const sends = validContacts.map((contact) => {
    const personalizedText = applyRecipientPlaceholders(bodyText, contact);
    const personalizedHtml = renderTransactionalShell({
      subject,
      bodyText: personalizedText,
      footerText,
    });
    return client.messages.create(domain, {
      from,
      to: [contact.email],
      subject,
      text: personalizedText,
      html: personalizedHtml,
      "v:contactId": contact.id,
      "v:athleteId": athleteId,
      "v:campaignId": campaignId || "",
      "v:orgId": orgId,
      "v:messageKind": "athlete_custom",
    });
  });

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
        lastSentAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    const messageRef = db.collection("messages").doc();
    batch.set(messageRef, {
      orgId,
      athleteId,
      campaignId: campaignId || null,
      contactId: contact.id,
      to: contact.email,
      toName: contact.name || "",
      subject,
      body: applyRecipientPlaceholders(bodyText, contact),
      channel: "email",
      phase: "custom",
      kind: "athlete_custom",
      isAutomated: false,
      createdAt: now,
    });
  });

  await batch.commit();

  if (failedRecipients.length > 0) {
    logger.warn("sendCustomMessageToContacts: partial send failure", {
      campaignId,
      athleteId,
      failedCount: failedRecipients.length,
      failedRecipients: failedRecipients.map((entry) => entry.email),
    });
  }

  logOutboundEmailAudit({
    source: "direct_mailgun",
    kind: "athlete_custom",
    recipientCount: sentContacts.length,
    orgId,
    campaignId,
    athleteId,
    templateVersion: "custom-manual-v1",
    subject,
  });

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

function isValidMailgunSignature(reqBody) {
  const signingKey = (process.env.MAILGUN_WEBHOOK_SIGNING_KEY || "").trim();
  if (!signingKey) {
    // Backward compatible when signing key is not configured yet.
    return true;
  }

  const signature = reqBody?.signature;
  const timestamp = String(signature?.timestamp || "");
  const token = String(signature?.token || "");
  const digest = String(signature?.signature || "");
  if (!timestamp || !token || !digest) return false;

  const expected = crypto
    .createHmac("sha256", signingKey)
    .update(`${timestamp}${token}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "utf8"),
      Buffer.from(digest, "utf8")
    );
  } catch (_) {
    return false;
  }
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
      const resolvedHtml =
        html || (text ? renderTransactionalShell({ subject, bodyText: text }) : "");

      await client.messages.create(domain, {
        from,
        to: [to],
        subject,
        html: resolvedHtml,
        text,
      });

      logger.info("sendMail: sent via mailgun", { to, subject });
      logOutboundEmailAudit({
        source: "mail_queue",
        kind: doc.kind || message.kind || "unknown",
        to,
        recipientCount: 1,
        orgId: doc.orgId || message.orgId || null,
        campaignId: doc.campaignId || message.campaignId || null,
        athleteId: doc.athleteId || message.athleteId || null,
        templateVersion: doc.templateVersion || message.templateVersion || null,
        subject,
      });
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
              text: `New Donation\n\nAmount: ${amountStr}\nCampaign: ${donation.campaignName || campaignId}\nDonor: ${donation.donorName || "Anonymous"}`,
              html: renderTransactionalShell({
                subject: "New donation received",
                bodyText: `Amount: ${amountStr}\nCampaign: ${donation.campaignName || campaignId}\nDonor: ${donation.donorName || "Anonymous"}`,
              }),
            },
            kind: "coach_donor_notification",
            orgId: orgId || null,
            campaignId: campaignId || null,
            athleteId: donation.athleteId || null,
            templateVersion: "coach-donor-notification-v1",
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

    const { toEmail, inviteId, appUrl, mode } = request.data || {};
    const senderProfile = await getUserProfile(request.auth.uid).catch(() => null);
    const normalizedEmail = String(toEmail || "").trim().toLowerCase();
    const normalizedInviteId = String(inviteId || "").trim();
    const sendMode = mode === "resend" ? "resend" : "initial";

    if (!normalizedEmail || !normalizedInviteId || !appUrl) {
      throw new HttpsError(
        "invalid-argument",
        "toEmail, inviteId, and appUrl are required"
      );
    }

    if (!senderProfile) {
      throw new HttpsError("permission-denied", "User profile not found");
    }

    if (!["admin", "super-admin", "coach"].includes(String(senderProfile.role || ""))) {
      throw new HttpsError("permission-denied", "Not allowed to send invites");
    }

    const db = admin.firestore();
    const inviteRef = db.collection("invites").doc(normalizedInviteId);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
      throw new HttpsError("not-found", "Invite not found");
    }

    const invite = inviteSnap.data() || {};
    const inviteEmail = String(invite.email || "").trim().toLowerCase();
    if (inviteEmail && inviteEmail !== normalizedEmail) {
      throw new HttpsError("invalid-argument", "Invite email mismatch");
    }
    const inviteStatus = String(invite.status || "").toLowerCase();
    if (inviteStatus !== "pending") {
      throw new HttpsError("failed-precondition", "Invite is no longer pending");
    }
    const inviteExpiresAt = invite?.expiresAt;
    const inviteExpired =
      inviteExpiresAt && typeof inviteExpiresAt?.toMillis === "function"
        ? inviteExpiresAt.toMillis() <= Date.now()
        : false;
    if (inviteExpired) {
      await inviteRef.set(
        {
          status: "expired",
          expiredAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      throw new HttpsError("failed-precondition", "Invite has expired");
    }
    if (
      senderProfile.role !== "super-admin" &&
      String(senderProfile.orgId || "") !== String(invite.orgId || "")
    ) {
      throw new HttpsError("permission-denied", "Org mismatch for invite send");
    }

    const { client, domain } = getMailgunClient();

    const inviteUrl = `${appUrl.replace(/\/$/, "")}/accept-invite?invite=${normalizedInviteId}`;

    try {
      const brandedSubject = "You've been invited to join Fundraising MVP";
      const brandedBodyText =
        "You've been invited to join Fundraising MVP.\n\n" +
        "Use the button below to accept your invite and finish setup.";
      await client.messages.create(domain, {
        from: "Fundraising MVP <no-reply@mail.inetsphere.com>",
        to: [normalizedEmail],
        subject: brandedSubject,
        text: `${brandedBodyText}\n\nAccept your invite:\n${inviteUrl}`,
        html: renderTransactionalShell({
          subject: brandedSubject,
          bodyText: brandedBodyText,
          ctaLabel: "Accept Invite",
          ctaUrl: inviteUrl,
          footerText: "If you did not expect this invite, you can ignore this email.",
        }),
      });

      const successEntry = {
        at: admin.firestore.Timestamp.now(),
        status: "sent",
        mode: sendMode,
        byUid: request.auth.uid,
      };
      const successUpdate = {
        lastDeliveryStatus: "sent",
        lastDeliveryError: admin.firestore.FieldValue.delete(),
        lastDeliveryAt: admin.firestore.FieldValue.serverTimestamp(),
        lastDeliveryBy: request.auth.uid,
        deliveryHistory: admin.firestore.FieldValue.arrayUnion(successEntry),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (sendMode === "resend") {
        successUpdate.lastResentAt = admin.firestore.FieldValue.serverTimestamp();
        successUpdate.resendCount = admin.firestore.FieldValue.increment(1);
      }
      await inviteRef.set(successUpdate, { merge: true });

      logger.info("sendInviteEmail: sent", {
        toEmail: normalizedEmail,
        inviteId: normalizedInviteId,
        uid: request.auth.uid,
        format: "branded-shell",
        mode: sendMode,
      });
      logOutboundEmailAudit({
        source: "direct_mailgun",
        kind: "user_invite",
        to: normalizedEmail,
        recipientCount: 1,
        orgId: senderProfile?.orgId || null,
        campaignId: null,
        athleteId: null,
        templateVersion: "invite-v1",
        subject: brandedSubject,
      });
      return { ok: true };

    } catch (err) {
      const errorSnippet = String(err?.message || "Failed to send invite email")
        .replace(/\s+/g, " ")
        .slice(0, 180);
      const failedEntry = {
        at: admin.firestore.Timestamp.now(),
        status: "failed",
        mode: sendMode,
        byUid: request.auth.uid,
        error: errorSnippet,
      };
      try {
        await inviteRef.set(
          {
            lastDeliveryStatus: "failed",
            lastDeliveryError: errorSnippet,
            lastDeliveryAt: admin.firestore.FieldValue.serverTimestamp(),
            lastDeliveryBy: request.auth.uid,
            deliveryHistory: admin.firestore.FieldValue.arrayUnion(failedEntry),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      } catch (updateErr) {
        logger.error("sendInviteEmail: failed to persist invite delivery status", {
          message: updateErr?.message,
        });
      }
      logger.error("sendInviteEmail failed", {
        message: err?.message,
        stack: err?.stack,
        inviteId: normalizedInviteId,
        toEmail: normalizedEmail,
        mode: sendMode,
      });
      throw new HttpsError(
        "internal",
        errorSnippet || "Failed to send invite email"
      );
    }
  }
);

/* ============================================================
   REVOKE INVITE (ADMIN/COACH/SUPER-ADMIN, ORG-SCOPED)
   ============================================================ */
exports.revokeInvite = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Login required");
  }
  const profile = await getUserProfile(request.auth.uid);
  if (!profile) {
    throw new HttpsError("permission-denied", "User profile not found");
  }
  if (!["admin", "super-admin", "coach"].includes(String(profile.role || ""))) {
    throw new HttpsError("permission-denied", "Not allowed to revoke invites");
  }

  const inviteId = String(request.data?.inviteId || "").trim();
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required");
  }

  const db = admin.firestore();
  const inviteRef = db.collection("invites").doc(inviteId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "Invite not found");
  }
  const invite = inviteSnap.data() || {};
  if (
    profile.role !== "super-admin" &&
    String(profile.orgId || "") !== String(invite.orgId || "")
  ) {
    throw new HttpsError("permission-denied", "Org mismatch");
  }
  if (String(invite.status || "").toLowerCase() !== "pending") {
    throw new HttpsError("failed-precondition", "Only pending invites can be revoked");
  }

  await inviteRef.set(
    {
      status: "revoked",
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      revokedByUid: request.auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  logger.info("revokeInvite: success", {
    inviteId,
    orgId: invite.orgId || null,
    byUid: request.auth.uid,
    previousStatus: invite.status || null,
  });
  return { ok: true, inviteId, status: "revoked" };
});

/* ============================================================
   CLEANUP INVITE (ADMIN/SUPER-ADMIN, REVOKED ONLY)
   ============================================================ */
exports.cleanupInvite = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Login required");
  }
  const profile = await getUserProfile(request.auth.uid);
  if (!profile) {
    throw new HttpsError("permission-denied", "User profile not found");
  }
  if (!["admin", "super-admin"].includes(String(profile.role || ""))) {
    throw new HttpsError("permission-denied", "Not allowed to clean up invites");
  }

  const inviteId = String(request.data?.inviteId || "").trim();
  if (!inviteId) {
    throw new HttpsError("invalid-argument", "inviteId is required");
  }

  const db = admin.firestore();
  const inviteRef = db.collection("invites").doc(inviteId);
  const inviteSnap = await inviteRef.get();
  if (!inviteSnap.exists) {
    throw new HttpsError("not-found", "Invite not found");
  }

  const invite = inviteSnap.data() || {};
  if (
    profile.role !== "super-admin" &&
    String(profile.orgId || "") !== String(invite.orgId || "")
  ) {
    throw new HttpsError("permission-denied", "Org mismatch");
  }

  const status = String(invite.status || "").toLowerCase();
  if (status !== "revoked") {
    throw new HttpsError("failed-precondition", "Only revoked invites can be cleaned up");
  }

  await inviteRef.delete();

  logger.info("cleanupInvite: success", {
    inviteId,
    orgId: invite.orgId || null,
    byUid: request.auth.uid,
    previousStatus: invite.status || null,
  });
  return { ok: true, inviteId, deleted: true };
});

/* ============================================================
   SUPER-ADMIN DESTRUCTIVE CLEANUP
   - Confirmation is enforced server-side with exact DELETE token
   - Blocks deletion of campaigns/teams with paid donation history
   ============================================================ */
exports.deleteSuperAdminEntity = onCall({ timeoutSeconds: 60 }, async (request) => {
  const profile = await assertSuperAdmin(request);
  const actorUid = request.auth.uid;
  const db = admin.firestore();
  const fieldValue = admin.firestore.FieldValue;

  const type = String(request.data?.type || "").trim().toLowerCase();
  const id = String(request.data?.id || "").trim();
  const confirmation = String(request.data?.confirmation || "").trim();

  if (confirmation !== "DELETE") {
    throw new HttpsError("invalid-argument", "Type DELETE to confirm this action");
  }
  if (!["user", "campaign", "team"].includes(type)) {
    throw new HttpsError("invalid-argument", "Unsupported delete type");
  }
  if (!id) {
    throw new HttpsError("invalid-argument", "id is required");
  }
  if (type === "user" && id === actorUid) {
    throw new HttpsError("failed-precondition", "You cannot delete your own account");
  }

  const result = { ok: true, type, id, deleted: {}, updated: {} };

  if (type === "user") {
    const paidDonationSnap = await db
      .collection("donations")
      .where("athleteId", "==", id)
      .where("status", "==", "paid")
      .limit(1)
      .get();
    if (!paidDonationSnap.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot delete an account with paid donation history"
      );
    }

    try {
      await admin.auth().deleteUser(id);
      result.deleted.authUser = 1;
    } catch (err) {
      if (err?.code !== "auth/user-not-found") {
        throw err;
      }
      result.deleted.authUser = 0;
    }

    const directDocs = ["users", "athletes", "coaches"].map((collectionName) =>
      db.collection(collectionName).doc(id)
    );
    const directBatch = db.batch();
    directDocs.forEach((ref) => directBatch.delete(ref));
    await directBatch.commit();
    result.deleted.profileDocs = directDocs.length;

    result.deleted.invitesAccepted = await deleteQueryDocs(
      db,
      await db.collection("invites").where("acceptedByUid", "==", id).get()
    );
    result.deleted.invitesCreated = await deleteQueryDocs(
      db,
      await db.collection("invites").where("createdByUid", "==", id).get()
    );
    result.deleted.contacts = await deleteQueryDocs(
      db,
      await db.collection("athlete_contacts").where("athleteId", "==", id).get()
    );
    result.deleted.messages = await deleteQueryDocs(
      db,
      await db.collection("messages").where("athleteId", "==", id).get()
    );
  }

  if (type === "campaign") {
    const campaignRef = db.collection("campaigns").doc(id);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) {
      throw new HttpsError("not-found", "Campaign not found");
    }

    const paidDonationSnap = await db
      .collection("donations")
      .where("campaignId", "==", id)
      .where("status", "==", "paid")
      .limit(1)
      .get();
    if (!paidDonationSnap.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot delete a campaign with paid donation history"
      );
    }

    result.deleted.campaignAthletes = await deleteQueryDocs(
      db,
      await db.collection("campaignAthletes").where("campaignId", "==", id).get()
    );
    result.deleted.invites = await deleteQueryDocs(
      db,
      await db.collection("invites").where("campaignId", "==", id).get()
    );
    result.deleted.comments = await deleteQueryDocs(
      db,
      await campaignRef.collection("comments").get()
    );
    result.deleted.publicDonors = await deleteQueryDocs(
      db,
      await campaignRef.collection("public_donors").get()
    );
    result.updated.athletes = await updateQueryDocs(
      db,
      await db.collection("athletes").where("campaignId", "==", id).get(),
      {
        campaignId: null,
        campaignName: fieldValue.delete(),
        updatedAt: fieldValue.serverTimestamp(),
      }
    );

    await campaignRef.delete();
    result.deleted.campaign = 1;
  }

  if (type === "team") {
    const teamRef = db.collection("teams").doc(id);
    const teamSnap = await teamRef.get();
    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team not found");
    }

    const paidDonationSnap = await db
      .collection("donations")
      .where("teamId", "==", id)
      .where("status", "==", "paid")
      .limit(1)
      .get();
    if (!paidDonationSnap.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot delete a team with paid donation history"
      );
    }

    const directCampaignsSnap = await db
      .collection("campaigns")
      .where("teamId", "==", id)
      .limit(1)
      .get();
    const multiCampaignsSnap = await db
      .collection("campaigns")
      .where("teamIds", "array-contains", id)
      .limit(1)
      .get();
    if (!directCampaignsSnap.empty || !multiCampaignsSnap.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Delete or reassign campaigns before deleting this team"
      );
    }

    const clearPrimaryTeam = {
      teamId: null,
      teamName: "",
      updatedAt: fieldValue.serverTimestamp(),
    };
    const removeAssignedTeam = {
      teamIds: fieldValue.arrayRemove(id),
      assignedTeamIds: fieldValue.arrayRemove(id),
      updatedAt: fieldValue.serverTimestamp(),
    };

    for (const collectionName of ["users", "athletes", "coaches"]) {
      result.updated[`${collectionName}PrimaryTeam`] = await updateQueryDocs(
        db,
        await db.collection(collectionName).where("teamId", "==", id).get(),
        clearPrimaryTeam
      );
      result.updated[`${collectionName}TeamArrays`] = await updateQueryDocs(
        db,
        await db.collection(collectionName).where("teamIds", "array-contains", id).get(),
        removeAssignedTeam
      );
      result.updated[`${collectionName}AssignedTeamArrays`] = await updateQueryDocs(
        db,
        await db.collection(collectionName).where("assignedTeamIds", "array-contains", id).get(),
        removeAssignedTeam
      );
    }

    result.deleted.teamAthletes = await deleteQueryDocs(
      db,
      await db.collection("teamAthletes").where("teamId", "==", id).get()
    );
    result.deleted.invites = await deleteQueryDocs(
      db,
      await db.collection("invites").where("teamId", "==", id).get()
    );

    await teamRef.delete();
    result.deleted.team = 1;
  }

  logger.warn("deleteSuperAdminEntity: success", {
    byUid: actorUid,
    byEmail: profile.email || null,
    type,
    id,
    result,
  });

  return result;
});

/* ============================================================
   CREATE MANAGED USER ACCOUNT (ADMIN/COACH/SUPER-ADMIN)
   - Creates Firebase Auth user + users/{uid}
   - Optionally seeds coaches/{uid} or athletes/{uid}
   ============================================================ */
exports.createManagedUserAccount = onCall(async (request) => {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const actor = await getUserProfile(uid);
  if (!actor) {
    throw new HttpsError("permission-denied", "User profile not found");
  }
  if (actor.status && actor.status !== "active") {
    throw new HttpsError("permission-denied", "User is not active");
  }
  if (!["admin", "super-admin", "coach"].includes(String(actor.role || ""))) {
    throw new HttpsError("permission-denied", "Not allowed to create managed accounts");
  }

  const email = String(request.data?.email || "").trim().toLowerCase();
  const role = String(request.data?.role || "").trim().toLowerCase();
  const orgId = String(request.data?.orgId || "").trim();
  const displayName = String(request.data?.displayName || "").trim();
  const requestedTeamId = String(request.data?.teamId || "").trim();
  const teamId =
    requestedTeamId && requestedTeamId !== "unassigned-team"
      ? requestedTeamId
      : "";
  const password = String(request.data?.password || "");

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "A valid email is required");
  }
  if (!["coach", "athlete", "admin"].includes(role)) {
    throw new HttpsError("invalid-argument", "Role must be coach, athlete, or admin");
  }
  if (!orgId) {
    throw new HttpsError("invalid-argument", "orgId is required");
  }
  if (!password || password.length < 10) {
    throw new HttpsError("invalid-argument", "Password must be at least 10 characters");
  }

  if (actor.role !== "super-admin" && String(actor.orgId || "") !== orgId) {
    throw new HttpsError("permission-denied", "Org mismatch");
  }
  if (actor.role === "coach" && role === "admin") {
    throw new HttpsError("permission-denied", "Coaches cannot create admin accounts");
  }

  if (requestedTeamId === "unassigned-team") {
    throw new HttpsError(
      "invalid-argument",
      "Invalid teamId: unassigned-team is a placeholder, not a real team"
    );
  }

  try {
    const existing = await admin.auth().getUserByEmail(email).catch(() => null);
    if (existing) {
      throw new HttpsError("already-exists", "A user with this email already exists");
    }

    const db = admin.firestore();
    let resolvedTeamName = "";
    if (teamId) {
      const teamSnap = await db.collection("teams").doc(teamId).get();
      if (!teamSnap.exists) {
        throw new HttpsError("not-found", "Team not found");
      }
      const teamData = teamSnap.data() || {};
      if (String(teamData.orgId || "") !== orgId) {
        throw new HttpsError("permission-denied", "Team org mismatch");
      }
      resolvedTeamName = String(teamData.name || teamData.teamName || "").trim();
    }
    const resolvedOrgName = await getOrganizationName(db, orgId);

    const createdAuthUser = await admin.auth().createUser({
      email,
      password,
      displayName: displayName || undefined,
      disabled: false,
      emailVerified: false,
    });

    const createdUid = createdAuthUser.uid;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const userPayload = {
      uid: createdUid,
      email,
      displayName: displayName || email,
      photoURL: null,
      role,
      orgId,
      orgName: resolvedOrgName || orgId,
      status: "active",
      teamId: teamId || null,
      teamName: teamId ? resolvedTeamName || teamId : "",
      teamIds: role === "coach" ? (teamId ? [teamId] : []) : [],
      createdByUid: uid,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection("users").doc(createdUid).set(userPayload, { merge: true });

    if (role === "coach") {
      await db.collection("coaches").doc(createdUid).set(
        {
          uid: createdUid,
          userId: createdUid,
          orgId,
          role: "coach",
          teamIds: teamId ? [teamId] : [],
          createdByUid: uid,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    if (role === "athlete") {
      await db.collection("athletes").doc(createdUid).set(
        {
          userId: createdUid,
          email,
          displayName: displayName || email,
          orgId,
          teamId: teamId || null,
          campaignId: null,
          status: "active",
          createdByUid: uid,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    logger.info("createManagedUserAccount: created", {
      createdUid,
      email,
      role,
      orgId,
      createdByUid: uid,
      actorRole: actor.role,
    });

    return {
      ok: true,
      uid: createdUid,
      email,
      role,
      orgId,
    };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error("createManagedUserAccount failed", {
      message: err?.message,
      stack: err?.stack,
      createdByUid: uid,
      email,
      role,
      orgId,
    });
    throw new HttpsError("internal", err?.message || "Failed to create managed user account");
  }
});

/* ============================================================
   GRANT EXISTING USER ACCESS (ADMIN/SUPER-ADMIN)
   - Bypasses invite flow intentionally
   - Links existing Firebase Auth account to users/{uid}
   ============================================================ */
exports.grantExistingUserAccess = onCall(async (request) => {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const actor = await getUserProfile(uid);
  if (!actor) {
    throw new HttpsError("permission-denied", "User profile not found");
  }
  if (!["admin", "super-admin"].includes(String(actor.role || ""))) {
    throw new HttpsError("permission-denied", "Admins only");
  }

  const email = String(request.data?.email || "").trim().toLowerCase();
  const requestedTargetUid = String(request.data?.targetUid || "").trim();
  const role = String(request.data?.role || "").trim().toLowerCase();
  const orgId = String(request.data?.orgId || "").trim();
  const requestedTeamId = String(request.data?.teamId || "").trim();
  const teamId =
    requestedTeamId && requestedTeamId !== "unassigned-team"
      ? requestedTeamId
      : "";
  const setTeamCoach = Boolean(request.data?.setTeamCoach);

  if (!requestedTargetUid && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new HttpsError("invalid-argument", "A valid email is required");
  }
  if (!["coach", "athlete", "admin"].includes(role)) {
    throw new HttpsError("invalid-argument", "Role must be coach, athlete, or admin");
  }
  if (!orgId) {
    throw new HttpsError("invalid-argument", "orgId is required");
  }
  if (actor.role !== "super-admin" && String(actor.orgId || "") !== orgId) {
    throw new HttpsError("permission-denied", "Org mismatch");
  }
  if (requestedTeamId === "unassigned-team") {
    throw new HttpsError(
      "invalid-argument",
      "Invalid teamId: unassigned-team is a placeholder, not a real team"
    );
  }

  let authUser = null;
  try {
    authUser = requestedTargetUid
      ? await admin.auth().getUser(requestedTargetUid)
      : await admin.auth().getUserByEmail(email);
  } catch (_) {
    throw new HttpsError(
      "not-found",
      requestedTargetUid
        ? "No authentication account exists for this UID"
        : "No authentication account exists for this email yet"
    );
  }
  if (
    email &&
    String(authUser.email || "").trim().toLowerCase() !== email
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Provided UID/email do not refer to the same auth account"
    );
  }

  const db = admin.firestore();
  let resolvedTeamName = "";
  if (teamId) {
    const teamSnap = await db.collection("teams").doc(teamId).get();
    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team not found");
    }
    const teamData = teamSnap.data() || {};
    if (String(teamData.orgId || "") !== orgId) {
      throw new HttpsError("permission-denied", "Team org mismatch");
    }
    resolvedTeamName = String(teamData.name || teamData.teamName || "").trim();
  }
  const resolvedOrgName = await getOrganizationName(db, orgId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const userRef = db.collection("users").doc(authUser.uid);
  const existingUserSnap = await userRef.get();
  const existingUser = existingUserSnap.exists ? existingUserSnap.data() || {} : {};
  const existingOrgId = String(existingUser.orgId || "").trim();

  if (
    existingOrgId &&
    existingOrgId !== orgId &&
    actor.role !== "super-admin"
  ) {
    throw new HttpsError(
      "permission-denied",
      "Existing user belongs to a different organization"
    );
  }

  const existingTeamIds = Array.isArray(existingUser.teamIds)
    ? existingUser.teamIds
    : Array.isArray(existingUser.assignedTeamIds)
      ? existingUser.assignedTeamIds
      : [];
  const mergedTeamIds = Array.from(
    new Set(
      [...existingTeamIds, teamId]
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );

  const userPayload = {
    uid: authUser.uid,
    email: String(authUser.email || email || "").trim().toLowerCase(),
    displayName:
      authUser.displayName || existingUser.displayName || authUser.email || email,
    photoURL: authUser.photoURL || existingUser.photoURL || null,
    role,
    orgId,
    orgName: resolvedOrgName || existingUser.orgName || orgId,
    status: "active",
    teamId: teamId || existingUser.teamId || null,
    teamName: teamId
      ? resolvedTeamName || String(existingUser.teamName || "").trim() || teamId
      : String(existingUser.teamName || "").trim(),
    teamIds: role === "coach" ? mergedTeamIds : [],
    assignedTeamIds: role === "coach" ? mergedTeamIds : [],
    updatedAt: now,
  };
  if (!existingUserSnap.exists) {
    userPayload.createdAt = now;
    userPayload.createdByUid = uid;
  }

  const batch = db.batch();
  batch.set(userRef, userPayload, { merge: true });

  if (role === "coach") {
    const coachRef = db.collection("coaches").doc(authUser.uid);
    batch.set(
      coachRef,
      {
        uid: authUser.uid,
        userId: authUser.uid,
        orgId,
        role: "coach",
        teamIds: mergedTeamIds,
        updatedAt: now,
        ...(existingUserSnap.exists ? {} : { createdAt: now, createdByUid: uid }),
      },
      { merge: true }
    );
  }

  if (role === "athlete") {
    const athleteRef = db.collection("athletes").doc(authUser.uid);
    batch.set(
      athleteRef,
      {
        userId: authUser.uid,
        email: String(authUser.email || email || "").trim().toLowerCase(),
        displayName:
          authUser.displayName || existingUser.displayName || authUser.email || email,
        orgId,
        teamId: teamId || null,
        status: "active",
        updatedAt: now,
        ...(existingUserSnap.exists ? {} : { createdAt: now, createdByUid: uid }),
      },
      { merge: true }
    );
  }

  if (setTeamCoach && role === "coach" && teamId) {
    const teamRef = db.collection("teams").doc(teamId);
    const teamSnap = await teamRef.get();
    if (!teamSnap.exists) {
      throw new HttpsError("not-found", "Team not found");
    }
    const teamData = teamSnap.data() || {};
    if (String(teamData.orgId || "") !== orgId) {
      throw new HttpsError("permission-denied", "Team org mismatch");
    }
    batch.set(
      teamRef,
      {
        coachId: authUser.uid,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();

  logger.info("grantExistingUserAccess: success", {
    targetUid: authUser.uid,
    email: String(authUser.email || email || "").trim().toLowerCase(),
    role,
    orgId,
    teamId: teamId || null,
    setTeamCoach,
    byUid: uid,
  });

  return {
    ok: true,
    uid: authUser.uid,
    email,
    role,
    orgId,
    teamId: teamId || null,
    setTeamCoach,
  };
});

/* ============================================================
   SUPER-ADMIN ORGANIZATION WORKSPACE CREATOR
   - Creates org with production defaults
   - Optionally creates first team
   - Keeps invite/admin flows as the next step
   ============================================================ */
exports.createOrganizationWorkspace = onCall(async (request) => {
  const actor = await assertAdmin(request);
  if (String(actor.role || "").toLowerCase() !== "super-admin") {
    throw new HttpsError("permission-denied", "Super-admin access required");
  }

  const orgName = String(request.data?.orgName || "").trim();
  const teamName = String(request.data?.teamName || "").trim();

  if (!orgName || orgName.length < 2) {
    throw new HttpsError("invalid-argument", "Organization name is required");
  }
  if (orgName.length > 120 || teamName.length > 120) {
    throw new HttpsError("invalid-argument", "Names must be 120 characters or less");
  }

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const orgRef = db.collection("organizations").doc();
  const teamRef = teamName ? db.collection("teams").doc() : null;
  const normalizedOrgName = orgName.replace(/\s+/g, " ").trim();
  const normalizedTeamName = teamName.replace(/\s+/g, " ").trim();

  const batch = db.batch();

  batch.set(
    orgRef,
    {
      name: normalizedOrgName,
      createdByUid: request.auth.uid,
      createdAt: now,
      updatedAt: now,
      status: "active",
      donorInviteTemplate: DEFAULT_DONOR_INVITE_TEMPLATE,
      donorInviteTemplates: {
        week1a: DEFAULT_DONOR_INVITE_TEMPLATE,
        week1b: DEFAULT_DONOR_INVITE_TEMPLATE,
        week2: DEFAULT_DONOR_INVITE_TEMPLATE,
        week3: DEFAULT_DONOR_INVITE_TEMPLATE,
        week4: DEFAULT_DONOR_INVITE_TEMPLATE,
        week5: DEFAULT_DONOR_INVITE_TEMPLATE,
        lateIntro: DEFAULT_LATE_CONTACT_TEMPLATE,
      },
      donorInviteSubjects: {
        ...DRIP_SUBJECTS,
      },
      dripGlobalEnabled: true,
      reporting: {
        excludeEndedCampaigns: true,
        sendWhenNoActiveCampaigns: false,
      },
    },
    { merge: true }
  );

  if (teamRef) {
    batch.set(
      teamRef,
      {
        orgId: orgRef.id,
        name: normalizedTeamName,
        coachId: "",
        coachName: "",
        createdByUid: request.auth.uid,
        createdAt: now,
        updatedAt: now,
        payoutStatus: "accruing",
      },
      { merge: true }
    );
  }

  await batch.commit();

  logger.info("createOrganizationWorkspace: success", {
    actorUid: request.auth.uid,
    orgId: orgRef.id,
    teamId: teamRef ? teamRef.id : null,
  });

  return {
    ok: true,
    orgId: orgRef.id,
    orgName: normalizedOrgName,
    teamId: teamRef ? teamRef.id : null,
    teamName: normalizedTeamName || "",
  };
});

/* ============================================================
   SOLO WORKSPACE BOOTSTRAP (AUTH USER, NO PROFILE YET)
   - Creates org + owner user + team (+ optional campaign)
   - Keeps existing invite/admin flows untouched
   ============================================================ */
exports.bootstrapSoloWorkspace = onCall(async (request) => {
  const uid = request?.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const orgName = String(request.data?.orgName || "").trim();
  const teamName = String(request.data?.teamName || "").trim();
  const campaignName = String(request.data?.campaignName || "").trim();
  const campaignGoalInput = Number(request.data?.campaignGoal || 0);
  const campaignGoal =
    Number.isFinite(campaignGoalInput) && campaignGoalInput > 0
      ? Math.round(campaignGoalInput)
      : 0;

  if (!orgName || orgName.length < 2) {
    throw new HttpsError("invalid-argument", "Organization name is required");
  }
  if (!teamName || teamName.length < 2) {
    throw new HttpsError("invalid-argument", "Team name is required");
  }
  if (orgName.length > 120 || teamName.length > 120 || campaignName.length > 120) {
    throw new HttpsError("invalid-argument", "Names must be 120 characters or less");
  }
  if (campaignGoal < 0 || campaignGoal > 10000000) {
    throw new HttpsError("invalid-argument", "Campaign goal is out of range");
  }

  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    const existing = userSnap.data() || {};
    if (String(existing.orgId || "").trim()) {
      throw new HttpsError(
        "failed-precondition",
        "App access already exists for this account"
      );
    }
  }

  let authUser;
  try {
    authUser = await admin.auth().getUser(uid);
  } catch (_) {
    throw new HttpsError("not-found", "Authentication user not found");
  }

  const bootstrapCoachName =
    String(authUser.displayName || "").trim() ||
    String(authUser.email || "").trim().toLowerCase() ||
    uid;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const orgRef = db.collection("organizations").doc();
  const teamRef = db.collection("teams").doc();
  const createCampaign = Boolean(campaignName);
  const campaignRef = createCampaign ? db.collection("campaigns").doc() : null;

  const batch = db.batch();

  batch.set(
    orgRef,
    {
      name: orgName,
      ownerUid: uid,
      createdByUid: uid,
      createdAt: now,
      updatedAt: now,
      status: "active",
      donorInviteTemplate: DEFAULT_DONOR_INVITE_TEMPLATE,
      donorInviteTemplates: {
        week1a: DEFAULT_DONOR_INVITE_TEMPLATE,
        week1b: DEFAULT_DONOR_INVITE_TEMPLATE,
        week2: DEFAULT_DONOR_INVITE_TEMPLATE,
        week3: DEFAULT_DONOR_INVITE_TEMPLATE,
        week4: DEFAULT_DONOR_INVITE_TEMPLATE,
        week5: DEFAULT_DONOR_INVITE_TEMPLATE,
        lateIntro: DEFAULT_LATE_CONTACT_TEMPLATE,
      },
      donorInviteSubjects: {
        ...DRIP_SUBJECTS,
      },
      dripGlobalEnabled: true,
      reporting: {
        excludeEndedCampaigns: true,
        sendWhenNoActiveCampaigns: false,
      },
    },
    { merge: true }
  );

  batch.set(
    userRef,
    {
      uid,
      email: String(authUser.email || "").trim().toLowerCase(),
      displayName:
        String(authUser.displayName || "").trim() ||
        String(authUser.email || "").trim().toLowerCase(),
      photoURL: authUser.photoURL || null,
      role: "admin",
      orgId: orgRef.id,
      orgName,
      status: "active",
      teamId: teamRef.id,
      teamName,
      teamIds: [teamRef.id],
      assignedTeamIds: [teamRef.id],
      createdByUid: uid,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  batch.set(
    teamRef,
    {
      orgId: orgRef.id,
      name: teamName,
      coachId: uid,
      coachName: bootstrapCoachName,
      createdByUid: uid,
      createdAt: now,
      updatedAt: now,
      payoutStatus: "accruing",
    },
    { merge: true }
  );

  batch.set(
    db.collection("coaches").doc(uid),
    {
      uid,
      userId: uid,
      orgId: orgRef.id,
      role: "coach",
      teamId: teamRef.id,
      teamIds: [teamRef.id],
      createdByUid: uid,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  if (campaignRef) {
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + 45 * 24 * 60 * 60 * 1000);
    batch.set(
      campaignRef,
      {
        orgId: orgRef.id,
        name: campaignName,
        description: "",
        teamId: teamRef.id,
        teamIds: [teamRef.id],
        teamName,
        goal: campaignGoal || 0,
        isPublic: true,
        status: "active",
        createdByUid: uid,
        createdAt: now,
        updatedAt: now,
        startDate: admin.firestore.Timestamp.fromDate(startDate),
        endDate: admin.firestore.Timestamp.fromDate(endDate),
      },
      { merge: true }
    );
  }

  await batch.commit();

  logger.info("bootstrapSoloWorkspace: success", {
    uid,
    orgId: orgRef.id,
    teamId: teamRef.id,
    campaignId: campaignRef ? campaignRef.id : null,
  });

  return {
    ok: true,
    uid,
    orgId: orgRef.id,
    teamId: teamRef.id,
    campaignId: campaignRef ? campaignRef.id : null,
  };
});

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

    const baseUrl = normalizeFrontendBaseUrl(
      (process.env.FRONTEND_URL || "").trim() ||
      (request?.rawRequest?.headers?.origin || "").trim()
    );

    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      throw new HttpsError("failed-precondition", "FRONTEND_URL is not configured");
    }

    const donateUrl = `${baseUrl}/donate/${campaignId}/athlete/${athleteId}`;
    const teamName = await resolveTeamName(db, { athlete, campaign });
    const campaignName = campaign.name || campaign.title || "our fundraiser";
    const athleteName = athlete.name || "our athlete";

    const orgTemplate = orgSnap.exists
      ? orgSnap.data()?.donorInviteTemplate
      : null;

    const personalMessage =
      typeof message === "string" && message.trim()
        ? message.trim().slice(0, 800)
        : "";

    const bodyText = buildEmailFromContext({
      emailKind: "donor_invite",
      template: orgTemplate,
      fallbackTemplate: DEFAULT_DONOR_INVITE_TEMPLATE,
      context: {
        athleteName,
        senderName: athleteName,
        teamName,
        campaignName,
        donateUrl,
        personalMessage,
      },
    });

    const bodyHtml = renderTransactionalShell({
      subject: `Can you support ${athleteName} and ${teamName}?`,
      bodyText,
      ctaLabel: `Support ${athleteName}`,
      ctaUrl: donateUrl,
      footerText: "Thank you for supporting youth fundraising.",
    });

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
    logOutboundEmailAudit({
      source: "direct_mailgun",
      kind: "donor_invite",
      recipientCount: emailList.length,
      orgId: profile.orgId || null,
      campaignId,
      athleteId,
      templateVersion: "donor-invite-v1",
      subject,
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

    const baseUrl = normalizeFrontendBaseUrl(
      (process.env.FRONTEND_URL || "").trim() ||
      (request?.rawRequest?.headers?.origin || "").trim()
    );

    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      throw new HttpsError("failed-precondition", "FRONTEND_URL is not configured");
    }

    const donateUrl = `${baseUrl}/donate/${campaignId}/athlete/${athleteId}`;
    const teamName = await resolveTeamName(db, { athlete, campaign });
    const campaignName = campaign.name || campaign.title || "our fundraiser";
    const athleteName = athlete.name || "our athlete";

    const contentTemplate =
      typeof template === "string" && template.trim()
        ? template.trim()
        : DEFAULT_DONOR_INVITE_TEMPLATE;

    const bodyText = buildEmailFromContext({
      emailKind: "drip_phase",
      template: contentTemplate,
      fallbackTemplate: DEFAULT_DONOR_INVITE_TEMPLATE,
      context: {
        athleteName,
        senderName: athleteName,
        teamName,
        campaignName,
        donateUrl,
        personalMessage: athlete.inviteMessage || "",
      },
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

exports.sendAthleteCustomMessage = onCall(
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

    const { athleteId, contactIds, subject, body, campaignId = null } = request.data || {};

    if (!athleteId || !Array.isArray(contactIds)) {
      throw new HttpsError(
        "invalid-argument",
        "athleteId and contactIds are required"
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

    const messageSubject = String(subject || "").trim();
    const messageBody = String(body || "").trim();

    if (!messageSubject) {
      throw new HttpsError("invalid-argument", "A subject is required");
    }

    if (!messageBody) {
      throw new HttpsError("invalid-argument", "A message is required");
    }

    if (messageSubject.length > 140) {
      throw new HttpsError("invalid-argument", "Subject is too long");
    }

    if (messageBody.length > 5000) {
      throw new HttpsError("invalid-argument", "Message is too long");
    }

    const db = admin.firestore();
    const athleteSnap = await db.collection("athletes").doc(athleteId).get();

    if (!athleteSnap.exists) {
      throw new HttpsError("not-found", "Athlete not found");
    }

    const athlete = athleteSnap.data() || {};
    if (!athlete.orgId) {
      throw new HttpsError("failed-precondition", "Athlete org is missing");
    }

    if (profile.role !== "super-admin" && athlete.orgId !== profile.orgId) {
      throw new HttpsError("permission-denied", "Org mismatch");
    }

    let campaign = {};
    let resolvedCampaignId = null;
    if (campaignId) {
      const campaignSnap = await db.collection("campaigns").doc(campaignId).get();
      if (!campaignSnap.exists) {
        throw new HttpsError("not-found", "Campaign not found");
      }
      campaign = campaignSnap.data() || {};
      if (campaign.orgId !== athlete.orgId) {
        throw new HttpsError("permission-denied", "Campaign org mismatch");
      }
      resolvedCampaignId = campaignId;
    } else if (athlete.campaignId) {
      resolvedCampaignId = String(athlete.campaignId || "").trim() || null;
      if (resolvedCampaignId) {
        const campaignSnap = await db.collection("campaigns").doc(resolvedCampaignId).get();
        campaign = campaignSnap.exists ? campaignSnap.data() || {} : {};
      }
    }

    const contactRefs = contactIds.map((id) => db.collection("athlete_contacts").doc(id));
    const contactSnaps = await db.getAll(...contactRefs);

    const eligibleContacts = [];
    contactSnaps.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      if (data.orgId !== athlete.orgId || data.athleteId !== athleteId) return;
      if (data.status === "donated") return;
      if (data.status === "bounced" || data.status === "complained") return;
      eligibleContacts.push({ id: snap.id, ...data });
    });

    if (eligibleContacts.length === 0) {
      throw new HttpsError("failed-precondition", "No eligible contacts to send");
    }

    const athleteName = String(athlete.name || athlete.displayName || "Athlete").trim() || "Athlete";
    const teamName = await resolveTeamName(db, { athlete, campaign });
    const senderLabel = teamName && teamName !== "our team"
      ? `${athleteName} via ${teamName}`
      : `${athleteName} via Fundraising MVP`;

    let sendResult;
    try {
      sendResult = await sendCustomMessageToContacts({
        db,
        orgId: athlete.orgId,
        campaignId: resolvedCampaignId,
        athleteId,
        contacts: eligibleContacts,
        subject: messageSubject,
        bodyText: messageBody,
        senderLabel,
      });
    } catch (err) {
      logger.error("sendAthleteCustomMessage: send failed", {
        athleteId,
        campaignId: resolvedCampaignId,
        uid: request.auth.uid,
        message: err?.message,
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        err?.message || "Failed to send selected messages"
      );
    }

    logger.info("sendAthleteCustomMessage: sent", {
      count: sendResult.sentCount,
      failedCount: sendResult.failedCount,
      athleteId,
      campaignId: resolvedCampaignId,
      uid: request.auth.uid,
    });

    return {
      ok: true,
      sent: sendResult.sentCount,
      failed: sendResult.failedCount,
      requested: contactIds.length,
      senderLabel,
    };
  }
);

exports.sendAthleteDripPhaseNow = onCall(
  {
    secrets: ["MAILGUN_API_KEY"],
    timeoutSeconds: 60,
  },
  async (request) => {
    const profile = await assertAdmin(request);
    const { athleteId, phase } = request.data || {};

    if (!athleteId || typeof athleteId !== "string") {
      throw new HttpsError("invalid-argument", "athleteId is required");
    }

    const phaseKey = String(phase || "").trim();
    const phaseConfig = DRIP_PHASES.find((entry) => entry.key === phaseKey);
    if (!phaseConfig) {
      throw new HttpsError("invalid-argument", "A valid drip phase is required");
    }

    const payload = await buildDripRenderPayload({
      profile,
      athleteId,
      phase: phaseKey,
    });

    const db = admin.firestore();
    const contactsSnap = await db
      .collection("athlete_contacts")
      .where("orgId", "==", payload.orgId)
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

    if (!contacts.length) {
      throw new HttpsError("failed-precondition", "No eligible contacts to send");
    }

    let sendResult;
    try {
      sendResult = await sendDripToContacts({
        db,
        orgId: payload.orgId,
        campaignId: payload.campaignId,
        athleteId,
        contacts,
        templateText: payload.bodyText,
        subject: payload.subject,
        phase: phaseKey,
        isAutomated: false,
      });
    } catch (err) {
      logger.error("sendAthleteDripPhaseNow: send failed", {
        athleteId,
        campaignId: payload.campaignId,
        phase: phaseKey,
        uid: request.auth.uid,
        message: err?.message,
        stack: err?.stack,
      });
      throw new HttpsError(
        "internal",
        err?.message || "Failed to send selected drip phase"
      );
    }

    const currentIndex = DRIP_PHASES.findIndex((entry) => entry.key === phaseKey);
    const nextPhase = currentIndex >= 0 ? DRIP_PHASES[currentIndex + 1] || null : null;

    await db
      .collection("athletes")
      .doc(athleteId)
      .set(
        {
          drip: {
            nextPhase: nextPhase ? nextPhase.key : null,
            nextSendAt: null,
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    logger.info("sendAthleteDripPhaseNow: sent", {
      athleteId,
      campaignId: payload.campaignId,
      phase: phaseKey,
      nextPhase: nextPhase?.key || null,
      sentCount: sendResult.sentCount,
      failedCount: sendResult.failedCount,
      uid: request.auth.uid,
    });

    return {
      ok: true,
      athleteId,
      campaignId: payload.campaignId,
      phase: phaseKey,
      nextPhase: nextPhase?.key || null,
      sent: sendResult.sentCount,
      failed: sendResult.failedCount,
      teamName: payload.teamName,
      athleteName: payload.athleteName,
    };
  }
);

exports.resetAthleteDripState = onCall(async (request) => {
  const profile = await assertAdmin(request);
  const { athleteId } = request.data || {};

  if (!athleteId || typeof athleteId !== "string") {
    throw new HttpsError("invalid-argument", "athleteId is required");
  }

  const db = admin.firestore();
  const athleteSnap = await db.collection("athletes").doc(athleteId).get();
  if (!athleteSnap.exists) {
    throw new HttpsError("not-found", "Athlete not found");
  }

  const athlete = athleteSnap.data() || {};
  if (!athlete.orgId) {
    throw new HttpsError("failed-precondition", "Athlete org is missing");
  }
  if (profile.role !== "super-admin" && athlete.orgId !== profile.orgId) {
    throw new HttpsError("permission-denied", "Org mismatch");
  }

  await db
    .collection("athletes")
    .doc(athleteId)
    .set(
      {
        drip: {
          lastPhaseSent: null,
          lastSentAt: null,
          nextPhase: null,
          nextSendAt: null,
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  logger.info("resetAthleteDripState: reset", {
    athleteId,
    orgId: athlete.orgId,
    uid: request.auth.uid,
  });

  return {
    ok: true,
    athleteId,
  };
});

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
    if (!isValidMailgunSignature(req.body)) {
      logger.warn("mailgunEventWebhook: invalid signature");
      await recordWebhookFailure("mailgun", {
        reason: "invalid-signature",
        httpStatus: 401,
      });
      return res.status(401).send("invalid signature");
    }

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

    logger.info(
      `mailgunEventWebhook: processed eventType=${eventType || "unknown"} recipient=${recipient || "unknown"} contactId=${contactId || "none"}`
    );

    return res.status(200).send("ok");
  } catch (err) {
    logger.error("mailgunEventWebhook failed", {
      message: err?.message,
      stack: err?.stack,
    });
    await recordWebhookFailure("mailgun", {
      reason: "handler-failed",
      httpStatus: 500,
      details: err?.message || "unknown",
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

      if (contacts.length < 20) {
        logger.info("runAthleteDrip: waiting for minimum contacts", {
          athleteId,
          campaignId: athlete.campaignId,
          eligibleContacts: contacts.length,
        });
        continue;
      }

      const baseUrl = normalizeFrontendBaseUrl(
        orgData.frontendUrl || process.env.FRONTEND_URL || ""
      );
      const donateUrl = `${baseUrl}/donate/${athlete.campaignId}/athlete/${athleteId}`;
      const resolvedTeamName = await resolveTeamName(db, { athlete, campaign });
      const orgTemplates = orgData.donorInviteTemplates || {};
      const athleteTemplates = athlete.donorInviteTemplates || {};
      const orgSubjects = orgData.donorInviteSubjects || {};
      const athleteLastSentAt = timestampToDate(athlete?.drip?.lastSentAt);
      const lateIntroCandidates = athlete?.drip?.lastPhaseSent
        ? contacts.filter((contact) => {
            if (contact.lateIntroSentAt) return false;
            if (contact.lateIntroPending === true) return true;
            const createdAt = timestampToDate(contact.createdAt);
            return Boolean(athleteLastSentAt && createdAt && createdAt > athleteLastSentAt);
          })
        : [];

      if (lateIntroCandidates.length > 0) {
        const lateIntroTemplate =
          athleteTemplates.lateIntro ||
          orgTemplates.lateIntro ||
          DEFAULT_LATE_CONTACT_TEMPLATE;
        const lateIntroSubject =
          orgSubjects.lateIntro || DRIP_SUBJECTS.lateIntro || "Fundraiser update";

        try {
          const lateIntroText = buildEmailFromContext({
            emailKind: "drip_late_intro",
            template: lateIntroTemplate,
            fallbackTemplate: DEFAULT_LATE_CONTACT_TEMPLATE,
            context: {
              athleteName: athlete.name || athlete.displayName || "our athlete",
              senderName: athlete.name || athlete.displayName || "our athlete",
              teamName: resolvedTeamName,
              campaignName: campaign.name || campaign.title || "our fundraiser",
              donateUrl,
              personalMessage: athlete.inviteMessage || "",
            },
          });
          const introResult = await sendDripToContacts({
            db,
            orgId: athlete.orgId,
            campaignId: athlete.campaignId,
            athleteId,
            contacts: lateIntroCandidates,
            templateText: lateIntroText,
            subject: lateIntroSubject,
            phase: "lateIntro",
            isAutomated: true,
          });
          logger.info("runAthleteDrip: sent late intro", {
            athleteId,
            campaignId: athlete.campaignId,
            contacts: introResult.sentCount,
            failedCount: introResult.failedCount,
          });
        } catch (err) {
          logger.error("runAthleteDrip: late intro failed", {
            athleteId,
            campaignId: athlete.campaignId,
            message: err?.message,
            stack: err?.stack,
          });
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

      const phaseTemplate =
        athleteTemplates[duePhase.key] ||
        orgTemplates[duePhase.key] ||
        orgData.donorInviteTemplate ||
        DEFAULT_DONOR_INVITE_TEMPLATE;
      const subject =
        orgSubjects[duePhase.key] ||
        DRIP_SUBJECTS[duePhase.key] ||
        "Fundraiser update";

      let sendResult;
      try {
        const templateText = buildEmailFromContext({
          emailKind: "drip_phase",
          template: phaseTemplate,
          fallbackTemplate: DEFAULT_DONOR_INVITE_TEMPLATE,
          context: {
            athleteName: athlete.name || athlete.displayName || "our athlete",
            senderName: athlete.name || athlete.displayName || "our athlete",
            teamName: resolvedTeamName,
            campaignName: campaign.name || campaign.title || "our fundraiser",
            donateUrl,
            personalMessage: athlete.inviteMessage || "",
          },
        });
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

exports.previewDripTemplate = onCall(
  {
    timeoutSeconds: 20,
  },
  async (request) => {
    const profile = await assertAdmin(request);
    const { athleteId, phase, recipientName } = request.data || {};

    if (!athleteId || typeof athleteId !== "string") {
      throw new HttpsError("invalid-argument", "athleteId is required");
    }

    const payload = await buildDripRenderPayload({
      profile,
      athleteId,
      phase,
    });
    const bodyText = applyRecipientPlaceholders(payload.bodyText, {
      name: recipientName || "",
    });

    return {
      ok: true,
      ...payload,
      bodyText,
      recipientName: recipientName || "",
    };
  }
);

exports.previewAllEmailTypes = onCall(
  {
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (request) => {
    const profile = await assertAdmin(request);
    const db = admin.firestore();
    const {
      athleteId,
      phase = "week1a",
      recipientName = "",
      targetUid = request.auth.uid,
      donorName = "Sample Supporter",
      donationAmountCents = 2500,
    } = request.data || {};

    if (!athleteId || typeof athleteId !== "string") {
      throw new HttpsError("invalid-argument", "athleteId is required");
    }

    const dripPayload = await buildDripRenderPayload({
      profile,
      athleteId,
      phase,
    });
    const dripBodyText = applyRecipientPlaceholders(dripPayload.bodyText, {
      name: recipientName || "",
    });
    const dripHtml = renderTransactionalShell({
      subject: dripPayload.subject,
      bodyText: dripBodyText,
      ctaLabel: "Open Donation Page",
      ctaUrl: dripPayload.donateUrl,
      footerText: "Preview only",
    });

    const [athleteSnap, orgSnap, targetSnap] = await Promise.all([
      db.collection("athletes").doc(athleteId).get(),
      db.collection("organizations").doc(dripPayload.orgId).get(),
      db.collection("users").doc(String(targetUid || "").trim()).get(),
    ]);

    const athlete = athleteSnap.exists ? athleteSnap.data() || {} : {};
    const orgData = orgSnap.exists ? orgSnap.data() || {} : {};
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Target user not found");
    }
    const targetUser = targetSnap.data() || {};
    const targetRole = String(targetUser.role || "").toLowerCase();
    if (!["coach", "admin", "super-admin"].includes(targetRole)) {
      throw new HttpsError("failed-precondition", "Target user role is not summary-eligible");
    }
    if (
      profile.role !== "super-admin" &&
      String(targetUser.orgId || "") !== String(profile.orgId || "")
    ) {
      throw new HttpsError("permission-denied", "Target user must be in your organization");
    }

    const inviteBodyText = buildEmailFromContext({
      emailKind: "donor_invite",
      template: orgData.donorInviteTemplate || null,
      fallbackTemplate: DEFAULT_DONOR_INVITE_TEMPLATE,
      context: {
        athleteName: dripPayload.athleteName,
        senderName: dripPayload.athleteName,
        teamName: dripPayload.teamName,
        campaignName: dripPayload.campaignName,
        donateUrl: dripPayload.donateUrl,
        personalMessage: athlete.inviteMessage || "",
      },
    });
    const inviteSubject = `Can you support ${dripPayload.athleteName} and ${dripPayload.teamName}?`;
    const inviteHtml = renderTransactionalShell({
      subject: inviteSubject,
      bodyText: inviteBodyText,
      ctaLabel: `Support ${dripPayload.athleteName}`,
      ctaUrl: dripPayload.donateUrl,
      footerText: "Preview only",
    });

    const receiptBodyLines = [
      "Thank you for supporting this fundraiser.",
      `Supporting athlete: ${dripPayload.athleteName}`,
      `Amount: $${(enforceCents(donationAmountCents) / 100).toFixed(2)}`,
      `Campaign: ${dripPayload.campaignId}`,
      `Donor: ${String(donorName || "Sample Supporter").trim()}`,
    ].filter(Boolean);
    const receiptBodyText = receiptBodyLines.join("\n");
    const receiptSubject = "Thank you for your donation!";
    const receiptHtml = renderTransactionalShell({
      subject: receiptSubject,
      bodyText: receiptBodyText,
      footerText: "Preview only",
    });

    const now = new Date();
    const periodEnd = new Date(now);
    const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [teamsSnap, campaignsSnap, athletesSnap, contactsSnap, donations] = await Promise.all([
      db.collection("teams").where("orgId", "==", String(targetUser.orgId || "")).get(),
      db.collection("campaigns").where("orgId", "==", String(targetUser.orgId || "")).get(),
      db.collection("athletes").where("orgId", "==", String(targetUser.orgId || "")).get(),
      db.collection("athlete_contacts").where("orgId", "==", String(targetUser.orgId || "")).get(),
      getPaidDonationsForWindow(db, String(targetUser.orgId || ""), periodStart, periodEnd),
    ]);

    const teams = teamsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const campaigns = campaignsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const athletes = athletesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const athleteContacts = contactsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const reportingConfig = getReportingSummaryConfig(orgData);

    let scopedTeams = teams;
    let scopedTeamIds = new Set(teams.map((t) => t.id));
    if (targetRole === "coach") {
      scopedTeams = teams.filter((t) => String(t.coachId || "") === String(targetUid || ""));
      scopedTeamIds = new Set(scopedTeams.map((t) => t.id));
    }

    const scopedCampaignsRaw =
      targetRole === "coach"
        ? campaigns.filter((c) => scopedTeamIds.has(String(c.teamId || "")))
        : campaigns;
    const scopedCampaigns = reportingConfig.excludeEndedCampaigns
      ? scopedCampaignsRaw.filter((c) => !isCampaignEnded(c, periodEnd))
      : scopedCampaignsRaw;
    const scopedCampaignIds = new Set(scopedCampaigns.map((c) => c.id));

    const scopedAthletes =
      targetRole === "coach"
        ? athletes.filter((a) => scopedTeamIds.has(String(a.teamId || "")))
        : athletes;
    const scopedAthleteIds = new Set(scopedAthletes.map((a) => a.id));

    const scopedDonations =
      targetRole === "coach"
        ? donations.filter((d) => scopedCampaignIds.has(String(d.campaignId || "")))
        : donations;
    const scopedContacts =
      targetRole === "coach"
        ? athleteContacts.filter((c) => scopedAthleteIds.has(String(c.athleteId || "")))
        : athleteContacts;

    const summaryDonationCount = scopedDonations.length;
    const summaryAmountCents = scopedDonations.reduce((sum, d) => sum + Number(d.amount || 0), 0);
    const summarySubject = "Preview Daily Fundraising Summary";
    const summaryScopeLabel =
      targetRole === "coach"
        ? `${scopedTeams.length} team(s)`
        : `Organization: ${orgData.name || targetUser.orgId || "N/A"}`;
    const summaryLines = [
      summarySubject,
      `Period: ${formatDateRange(periodStart, periodEnd)}`,
      `Scope: ${summaryScopeLabel}`,
      `Donations: ${summaryDonationCount}`,
      `Amount Raised: ${formatCurrencyFromCents(summaryAmountCents)}`,
      `Campaigns in Scope: ${scopedCampaigns.length}`,
      `Athletes in Scope: ${scopedAthletes.length}`,
      `Contacts in Scope: ${scopedContacts.length}`,
    ];
    const summaryBodyText = summaryLines.join("\n");
    const summaryHtml = renderTransactionalShell({
      subject: summarySubject,
      bodyText: summaryBodyText,
      footerText: `Summary time zone: ${getSummaryPreference(targetUser).summaryTimeZone}`,
    });

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      athleteId,
      targetUid: String(targetUid || ""),
      previews: {
        invite: {
          subject: inviteSubject,
          bodyText: inviteBodyText,
          html: inviteHtml,
          templateVersion: "donor-invite-v1",
        },
        drip: {
          phase: dripPayload.phase,
          subject: dripPayload.subject,
          bodyText: dripBodyText,
          html: dripHtml,
          templateVersion: `drip-${dripPayload.phase || "unknown"}-v1`,
        },
        receipt: {
          subject: receiptSubject,
          bodyText: receiptBodyText,
          html: receiptHtml,
          templateVersion: "donation-receipt-v1",
        },
        summary: {
          subject: summarySubject,
          bodyText: summaryBodyText,
          html: summaryHtml,
          templateVersion: "summary-v1",
        },
      },
    };
  }
);

exports.sendTestDripEmail = onCall(
  {
    secrets: ["MAILGUN_API_KEY"],
    timeoutSeconds: 30,
  },
  async (request) => {
    const profile = await assertAdmin(request);
    const { athleteId, phase, toEmail, recipientName } = request.data || {};

    if (!athleteId || typeof athleteId !== "string") {
      throw new HttpsError("invalid-argument", "athleteId is required");
    }
    if (!toEmail || typeof toEmail !== "string" || !isValidEmailAddress(toEmail)) {
      throw new HttpsError("invalid-argument", "A valid toEmail is required");
    }

    const payload = await buildDripRenderPayload({
      profile,
      athleteId,
      phase,
    });

    const { client, domain } = getMailgunClient();
    const from = `Fundraising MVP <no-reply@${domain}>`;
    const renderedBody = applyRecipientPlaceholders(payload.bodyText, {
      name: recipientName || "",
    });
    const testBodyText = `TEST SEND ONLY - this does not advance campaign state.\n\n${renderedBody}`;
    const testHtml = renderTransactionalShell({
      subject: `[TEST] ${payload.subject}`,
      bodyText: testBodyText,
      ctaLabel: "Open Donation Page",
      ctaUrl: payload.donateUrl,
      footerText: "This is a test email and was not sent to campaign contacts.",
    });

    try {
      await client.messages.create(domain, {
        from,
        to: [toEmail.trim()],
        subject: `[TEST] ${payload.subject}`,
        text: testBodyText,
        html: testHtml,
      });

      logger.info("sendTestDripEmail: sent", {
        athleteId: payload.athleteId,
        campaignId: payload.campaignId,
        phase: payload.phase,
        toEmail: toEmail.trim(),
        recipientName: recipientName || "",
        uid: request.auth.uid,
      });
      logOutboundEmailAudit({
        source: "direct_mailgun",
        kind: "athlete_drip_test",
        to: toEmail.trim(),
        recipientCount: 1,
        orgId: payload.orgId || null,
        campaignId: payload.campaignId || null,
        athleteId: payload.athleteId || null,
        templateVersion: `drip-${payload.phase || "unknown"}-test-v1`,
        subject: `[TEST] ${payload.subject}`,
      });

      return {
        ok: true,
        toEmail: toEmail.trim(),
        subject: payload.subject,
        bodyText: renderedBody,
        athleteName: payload.athleteName,
        teamName: payload.teamName,
        campaignName: payload.campaignName,
        phase: payload.phase,
        recipientName: recipientName || "",
      };
    } catch (err) {
      logger.error("sendTestDripEmail failed", {
        athleteId,
        phase,
        toEmail,
        message: err?.message,
        stack: err?.stack,
      });
      throw new HttpsError("internal", err?.message || "Failed to send test drip email");
    }
  }
);

/* ============================================================
   COACH INVITE SENDER (RESTORED)
   - If you previously called this from UI, keep the same export name.
   ============================================================ */
exports.sendCoachInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  const profile = await getUserProfile(request.auth.uid);
  if (!profile) {
    throw new HttpsError("permission-denied", "User profile not found");
  }
  if (profile.status && profile.status !== "active") {
    throw new HttpsError("permission-denied", "User is not active");
  }

  if (!["coach", "admin", "super-admin"].includes(profile.role)) {
    throw new HttpsError("permission-denied", "Not allowed to send coach invites");
  }

  const { toEmail, inviteUrl, teamName } = request.data || {};

  if (!toEmail || typeof toEmail !== "string") {
    throw new HttpsError("invalid-argument", "Missing toEmail");
  }
  if (!inviteUrl || typeof inviteUrl !== "string") {
    throw new HttpsError("invalid-argument", "Missing inviteUrl");
  }

  try {
    const brandedSubject = "You've been invited as a coach";
    const brandedBodyText =
      `You've been invited to join${teamName ? ` ${teamName}` : " a team"} in Fundraising MVP.\n\n` +
      "Use the button below to accept your invite.";
    await admin.firestore().collection("mail").add({
      to: toEmail,
      message: {
        subject: brandedSubject,
        text: `${brandedBodyText}\n\nAccept invite: ${inviteUrl}`,
        html: renderTransactionalShell({
          subject: brandedSubject,
          bodyText: brandedBodyText,
          ctaLabel: "Accept Invite",
          ctaUrl: inviteUrl,
        }),
      },
      kind: "coach_invite",
      orgId: profile.orgId || null,
      campaignId: null,
      athleteId: null,
      templateVersion: "coach-invite-v1",
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
      const athleteIdFromBody = data.athleteId || "";
      const athleteIdFromReferer = inferAthleteIdFromReferer(
        request?.rawRequest?.headers?.referer || "",
        campaignId
      );
      const athleteId = athleteIdFromBody || athleteIdFromReferer || "";
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

      const baseUrl = normalizeFrontendBaseUrl((() => {
        const fromEnv = (process.env.FRONTEND_URL || "").trim();
        const fromOrigin = (request?.rawRequest?.headers?.origin || "").trim();
        const fromReferer = (() => {
          const raw = (request?.rawRequest?.headers?.referer || "").trim();
          if (!raw) return "";
          try {
            return new URL(raw).origin;
          } catch {
            return "";
          }
        })();

        const candidates = [fromOrigin, fromReferer, fromEnv].filter((value) =>
          /^https?:\/\//i.test(value)
        );

        const nonLocal = candidates.find(
          (value) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)
        );

        return nonLocal || candidates[0] || "";
      })());

      if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
        throw new HttpsError(
          "failed-precondition",
          `FRONTEND_URL must be set to an absolute URL (e.g., http://localhost:5173). Got: "${
            baseUrl || "EMPTY"
          }"`
        );
      }

      const stripeSecretKey = (process.env.STRIPE_SECRET_KEY || "").trim();
      if (!stripeSecretKey) {
        throw new HttpsError("failed-precondition", "Missing STRIPE_SECRET_KEY");
      }

      let baseHostname = "";
      try {
        baseHostname = new URL(baseUrl).hostname.toLowerCase();
      } catch (_) {
        baseHostname = "";
      }
      const isProductionHost =
        !!baseHostname &&
        baseHostname !== "localhost" &&
        baseHostname !== "127.0.0.1" &&
        !baseHostname.endsWith(".local");
      const allowTestCheckoutOnProduction =
        String(process.env.ALLOW_TEST_CHECKOUT_ON_PRODUCTION || "").trim().toLowerCase() ===
        "true";

      if (
        isProductionHost &&
        stripeSecretKey.startsWith("sk_test_") &&
        !allowTestCheckoutOnProduction
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Refusing to create checkout session: production domain with Stripe test key. Set ALLOW_TEST_CHECKOUT_ON_PRODUCTION=true only for temporary testing."
        );
      }

      // IMPORTANT (Gen 2): initialize Stripe INSIDE the handler after secrets are injected
      const stripe = new Stripe(stripeSecretKey);

      const snap = await admin.firestore().collection("campaigns").doc(campaignId).get();
      if (!snap.exists) {
        throw new HttpsError("not-found", "Campaign not found");
      }

      const campaign = snap.data() || {};

      // Integrity guard: if athlete attribution is supplied, enforce org/campaign alignment.
      if (athleteId) {
        const athleteSnap = await admin
          .firestore()
          .collection("athletes")
          .doc(athleteId)
          .get();
        if (!athleteSnap.exists) {
          throw new HttpsError("invalid-argument", "Invalid athleteId");
        }
        const athlete = athleteSnap.data() || {};
        if ((athlete.orgId || "") !== (campaign.orgId || "")) {
          throw new HttpsError("permission-denied", "Athlete org mismatch");
        }
        if ((athlete.campaignId || "") !== campaignId) {
          throw new HttpsError("invalid-argument", "Athlete not assigned to campaign");
        }
      }

      const campaignName = (campaign.name || campaign.title || "Campaign").toString();

      const successParams = new URLSearchParams({
        campaignId,
        session_id: "{CHECKOUT_SESSION_ID}",
      });
      if (athleteId) {
        successParams.set("athleteId", athleteId);
      }
      const successUrl = `${baseUrl}/donate-success?${successParams.toString()}`;
      const cancelUrl = athleteId
        ? `${baseUrl}/donate/${campaignId}/athlete/${athleteId}`
        : `${baseUrl}/donate/${campaignId}`;

      logger.info("Creating Stripe checkout session", {
        campaignId,
        athleteIdFromBody,
        athleteIdFromReferer,
        athleteId,
        referer: request?.rawRequest?.headers?.referer || "",
        amountCents,
        baseUrl,
        isProductionHost,
        allowTestCheckoutOnProduction,
        hasStripeKey: !!stripeSecretKey,
        keyPrefix: stripeSecretKey.slice(0, 8),
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
      await recordWebhookFailure("stripe", {
        reason: "missing-signature",
        httpStatus: 400,
      });
      return res.status(400).send("Missing stripe-signature");
    }

    const stripeWebhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
    if (!stripeWebhookSecret) {
      logger.error("stripeWebhook: missing STRIPE_WEBHOOK_SECRET");
      await recordWebhookFailure("stripe", {
        reason: "missing-webhook-secret",
        httpStatus: 500,
      });
      return res.status(500).send("Missing webhook secret");
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret
      );
    } catch (err) {
      logger.error("stripeWebhook: signature verification failed", {
        message: err?.message,
      });
      await recordWebhookFailure("stripe", {
        reason: "invalid-signature",
        httpStatus: 400,
        details: err?.message || "unknown",
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
        const rawSession = event.data.object;
        // Hardening: avoid dependency on extra Stripe API calls in webhook path.
        // The event payload is sufficient to write donation state and queue receipts.
        const session = rawSession;

        const db = admin.firestore();
        const donationRef = db.collection("donations").doc(session.id);
        const campaignId = session.metadata?.campaignId || null;
        const athleteId = session.metadata?.athleteId || null;
        const campaignRef = campaignId ? db.collection("campaigns").doc(campaignId) : null;
        const athleteRef = athleteId ? db.collection("athletes").doc(athleteId) : null;
        const commentRef = campaignRef ? campaignRef.collection("comments").doc(session.id) : null;
        const amountCents = enforceCents(session.amount_total);
        const sessionOrgId = session.metadata?.orgId || null;
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
        const paymentIntent =
          session.payment_intent &&
          typeof session.payment_intent === "object"
            ? session.payment_intent
            : null;
        const latestCharge =
          paymentIntent?.latest_charge &&
          typeof paymentIntent.latest_charge === "object"
            ? paymentIntent.latest_charge
            : null;
        const balanceTransaction =
          latestCharge?.balance_transaction &&
          typeof latestCharge.balance_transaction === "object"
            ? latestCharge.balance_transaction
            : null;

        logger.info("stripeWebhook: about to write donation", {
          sessionId: session.id,
        });

        const mailRef = donorEmail
          ? db.collection("mail").doc(`receipt_${session.id}`)
          : null;

        let shouldWriteCampaignArtifacts = false;
        let shouldWriteAthleteArtifacts = false;

        await db.runTransaction(async (tx) => {
          const donationSnap = await tx.get(donationRef);
          const campaignSnap = campaignRef ? await tx.get(campaignRef) : null;
          const athleteSnap = athleteRef ? await tx.get(athleteRef) : null;

          const campaignExists = !!campaignSnap?.exists;
          const campaignData = campaignSnap?.data() || {};
          const campaignOrgMatch =
            !sessionOrgId || (campaignData.orgId || null) === sessionOrgId;
          const platformFeeRate =
            campaignData.platformFeePct != null
              ? campaignData.platformFeePct
              : campaignData.feePct;
          const normalizedPlatformFeeRate = normalizePercent(platformFeeRate);
          const stripeFeeCents = estimateStripeProcessingFeeCents(amountCents);
          const platformFeeCents = calculatePlatformFeeCents(
            amountCents,
            normalizedPlatformFeeRate
          );
          const totalFeeCents = stripeFeeCents + platformFeeCents;
          const exactFeeFields = {
            stripeFeeCents,
            processingFeeCents: stripeFeeCents,
            platformFeeRate: normalizedPlatformFeeRate,
            platformFeeCents,
            totalFeeCents,
            netAmountCents: amountCents - totalFeeCents,
            stripeChargeId: null,
            stripeBalanceTransactionId: null,
            hasExactStripeFee: false,
          };

          const athleteExists = !!athleteSnap?.exists;
          const athleteData = athleteSnap?.data() || {};
          const athleteOrgMatch =
            !sessionOrgId || (athleteData.orgId || null) === sessionOrgId;
          const athleteCampaignMatch =
            !campaignId || (athleteData.campaignId || null) === campaignId;

          shouldWriteCampaignArtifacts = campaignExists && campaignOrgMatch;
          shouldWriteAthleteArtifacts =
            athleteExists && athleteOrgMatch && athleteCampaignMatch;

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
                grossAmountCents: amountCents,
                stripeFeeCents: exactFeeFields.stripeFeeCents,
                processingFeeCents: exactFeeFields.processingFeeCents,
                platformFeeRate: exactFeeFields.platformFeeRate,
                platformFeeCents: exactFeeFields.platformFeeCents,
                totalFeeCents: exactFeeFields.totalFeeCents,
                netAmountCents: exactFeeFields.netAmountCents,
                stripeEventId: event.id,
                stripeEventType: event.type,
                stripePaymentIntent:
                  typeof session.payment_intent === "string"
                    ? session.payment_intent
                    : session.payment_intent?.id || null,
                stripeChargeId: exactFeeFields.stripeChargeId,
                stripeBalanceTransactionId: exactFeeFields.stripeBalanceTransactionId,
                stripeCustomer: session.customer || null,
                stripeLivemode: !!event.livemode,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            if (shouldWriteCampaignArtifacts && campaignRef) {
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

            if (shouldWriteAthleteArtifacts && athleteRef) {
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

        if (commentRef && donorComment && shouldWriteCampaignArtifacts) {
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

        if (campaignRef && shouldWriteCampaignArtifacts) {
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

        if (donorEmail && athleteId && shouldWriteAthleteArtifacts) {
          const emailLower = String(donorEmail).toLowerCase();
          const contactSnap = await db
            .collection("athlete_contacts")
            .where("orgId", "==", sessionOrgId || "")
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
            let athleteDisplayName = "";
            if (athleteRef) {
              const athleteForReceiptSnap = await athleteRef.get();
              if (athleteForReceiptSnap.exists) {
                const athleteForReceipt = athleteForReceiptSnap.data() || {};
                athleteDisplayName = String(
                  athleteForReceipt.name || athleteForReceipt.displayName || ""
                ).trim();
              }
            }

            const receiptSubject = "Thank you for your donation!";
            const receiptBodyLines = [
              "Thank you for supporting this fundraiser.",
              athleteDisplayName ? `Supporting athlete: ${athleteDisplayName}` : "",
              `Amount: $${(amountCents / 100).toFixed(2)}`,
              `Campaign: ${session.metadata?.campaignId || "N/A"}`,
            ].filter(Boolean);
            const receiptBodyText = receiptBodyLines.join("\n");
            await mailRef.create({
              to: donorEmail,
              message: {
                subject: receiptSubject,
                text: receiptBodyText,
                html: renderTransactionalShell({
                  subject: receiptSubject,
                  bodyText: receiptBodyText,
                }),
              },
              kind: "donation_receipt",
              orgId: sessionOrgId || null,
              campaignId: campaignId || null,
              athleteId: athleteId || null,
              templateVersion: "donation-receipt-v1",
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
          stripeFeeCents:
            typeof session.payment_intent === "string" ||
            session.payment_intent?.id
              ? "stored"
              : "missing-payment-intent",
          campaignArtifacts: shouldWriteCampaignArtifacts,
          athleteArtifacts: shouldWriteAthleteArtifacts,
        });
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error("stripeWebhook: handler failed", {
        message: err?.message,
        stack: err?.stack,
      });
      await recordWebhookFailure("stripe", {
        reason: "handler-failed",
        httpStatus: 500,
        details: err?.message || "unknown",
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
    const presentOutsideRange = [];
    const mismatches = [];

    for (const s of stripePaid) {
      const fs = firestoreDocs.get(s.id);
      if (!fs) {
        // Avoid false negatives when createdAt falls outside selected range.
        const directSnap = await admin.firestore().collection("donations").doc(s.id).get();
        if (!directSnap.exists) {
          missingInFirestore.push(s.id);
        } else {
          presentOutsideRange.push(s.id);
        }
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
      presentOutsideRange,
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

exports.backfillDonationFees = onCall(
  {
    secrets: ["STRIPE_SECRET_KEY"],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const profile = await assertAdmin(request);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const db = admin.firestore();

    const requestedOrgId = String(request?.data?.orgId || profile.orgId || "").trim();
    const limitRaw = Number(request?.data?.limit || 100);
    const limit = Math.max(1, Math.min(250, Math.round(limitRaw)));

    if (!requestedOrgId) {
      throw new HttpsError("failed-precondition", "orgId is required");
    }
    if (profile.role !== "super-admin" && requestedOrgId !== profile.orgId) {
      throw new HttpsError(
        "permission-denied",
        "Admins may only backfill donations in their own org"
      );
    }

    const [donationsSnap, campaignsSnap] = await Promise.all([
      db.collection("donations").where("orgId", "==", requestedOrgId).limit(limit).get(),
      db.collection("campaigns").where("orgId", "==", requestedOrgId).get(),
    ]);

    const campaignById = new Map(
      campaignsSnap.docs.map((docSnap) => [docSnap.id, docSnap.data() || {}])
    );

    let scanned = 0;
    let updated = 0;
    const skipped = [];
    const failed = [];

    for (const docSnap of donationsSnap.docs) {
      scanned += 1;
      const donation = docSnap.data() || {};
      const needsBackfill =
        donation.stripeFeeCents == null ||
        donation.platformFeeCents == null ||
        donation.netAmountCents == null ||
        donation.stripeBalanceTransactionId == null;

      if (!needsBackfill) {
        skipped.push({ id: docSnap.id, reason: "already-populated" });
        continue;
      }

      const paymentIntentId = String(donation.stripePaymentIntent || "").trim();
      if (!paymentIntentId) {
        skipped.push({ id: docSnap.id, reason: "missing-payment-intent" });
        continue;
      }

      const amountCents = enforceCents(
        donation.grossAmountCents != null ? donation.grossAmountCents : donation.amount
      );
      if (!amountCents) {
        skipped.push({ id: docSnap.id, reason: "missing-amount" });
        continue;
      }

      const campaign = campaignById.get(String(donation.campaignId || "")) || {};
      const platformFeeRate =
        campaign.platformFeePct != null ? campaign.platformFeePct : campaign.feePct;

      try {
        const exactFeeFields = await buildExactDonationFeeFields({
          stripe,
          paymentIntentId,
          amountCents,
          platformFeeRate,
        });

        await docSnap.ref.set(
          {
            grossAmountCents: amountCents,
            stripeFeeCents: exactFeeFields.stripeFeeCents,
            processingFeeCents: exactFeeFields.processingFeeCents,
            platformFeeRate: exactFeeFields.platformFeeRate,
            platformFeeCents: exactFeeFields.platformFeeCents,
            totalFeeCents: exactFeeFields.totalFeeCents,
            netAmountCents: exactFeeFields.netAmountCents,
            stripeChargeId: exactFeeFields.stripeChargeId,
            stripeBalanceTransactionId: exactFeeFields.stripeBalanceTransactionId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        updated += 1;
      } catch (err) {
        logger.error("backfillDonationFees: failed donation", {
          donationId: docSnap.id,
          message: err?.message,
        });
        failed.push({
          id: docSnap.id,
          reason: err?.message || "unknown",
        });
      }
    }

    logger.info("backfillDonationFees: complete", {
      orgId: requestedOrgId,
      scanned,
      updated,
      skipped: skipped.length,
      failed: failed.length,
    });

    return {
      ok: true,
      orgId: requestedOrgId,
      scanned,
      updated,
      skipped,
      failed,
    };
  }
);

function formatCurrencyFromCents(cents) {
  const amount = Number(cents || 0) / 100;
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateRange(start, end) {
  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} - ${endLabel}`;
}

function getSummaryPreference(userData = {}) {
  const role = String(userData.role || "").toLowerCase();
  const isEligibleRole = role === "coach" || role === "admin" || role === "super-admin";
  const prefs = userData.preferences || {};
  const summaryEnabled = typeof prefs.summaryEnabled === "boolean" ?
    prefs.summaryEnabled :
    isEligibleRole;
  const summaryFrequency = String(
    prefs.summaryFrequency || (summaryEnabled ? "daily" : "off")
  ).toLowerCase();
  const summaryEmailEnabled = typeof prefs.summaryEmailEnabled === "boolean" ?
    prefs.summaryEmailEnabled :
    summaryEnabled;
  const summaryDeliveryHourRaw = Number(prefs.summaryDeliveryHour);
  const summaryDeliveryHourLegacy = Number.isInteger(summaryDeliveryHourRaw) &&
    summaryDeliveryHourRaw >= 0 &&
    summaryDeliveryHourRaw <= 23 ?
    summaryDeliveryHourRaw :
    7;
  const summaryDeliveryMinuteRaw = Number(prefs.summaryDeliveryMinute);
  const summaryDeliveryMinuteLegacy = [0, 15, 30, 45].includes(summaryDeliveryMinuteRaw) ?
    summaryDeliveryMinuteRaw :
    0;
  const summaryDailyDeliveryHourRaw = Number(prefs.summaryDailyDeliveryHour);
  const summaryDailyDeliveryHour = Number.isInteger(summaryDailyDeliveryHourRaw) &&
    summaryDailyDeliveryHourRaw >= 0 &&
    summaryDailyDeliveryHourRaw <= 23 ?
    summaryDailyDeliveryHourRaw :
    summaryDeliveryHourLegacy;
  const summaryDailyDeliveryMinuteRaw = Number(prefs.summaryDailyDeliveryMinute);
  const summaryDailyDeliveryMinute = [0, 15, 30, 45].includes(summaryDailyDeliveryMinuteRaw) ?
    summaryDailyDeliveryMinuteRaw :
    summaryDeliveryMinuteLegacy;
  const summaryWeeklyDeliveryHourRaw = Number(prefs.summaryWeeklyDeliveryHour);
  const summaryWeeklyDeliveryHour = Number.isInteger(summaryWeeklyDeliveryHourRaw) &&
    summaryWeeklyDeliveryHourRaw >= 0 &&
    summaryWeeklyDeliveryHourRaw <= 23 ?
    summaryWeeklyDeliveryHourRaw :
    summaryDeliveryHourLegacy;
  const summaryWeeklyDeliveryMinuteRaw = Number(prefs.summaryWeeklyDeliveryMinute);
  const summaryWeeklyDeliveryMinute = [0, 15, 30, 45].includes(summaryWeeklyDeliveryMinuteRaw) ?
    summaryWeeklyDeliveryMinuteRaw :
    summaryDeliveryMinuteLegacy;
  const summaryTimeZone = String(
    prefs.summaryTimeZone ||
    userData.orgTimeZone ||
    userData.timeZone ||
    "America/Los_Angeles"
  ).trim();

  return {
    role,
    isEligibleRole,
    summaryEnabled,
    summaryFrequency,
    summaryEmailEnabled,
    summaryDailyDeliveryHour,
    summaryDailyDeliveryMinute,
    summaryWeeklyDeliveryHour,
    summaryWeeklyDeliveryMinute,
    summaryTimeZone,
  };
}

function getTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const byType = {};
  for (const part of parts) {
    byType[part.type] = part.value;
  }

  const weekdayMap = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };
  const weekday = weekdayMap[String(byType.weekday || "").slice(0, 3).toLowerCase()] ?? 0;
  const year = Number(byType.year || 0);
  const month = Number(byType.month || 0);
  const day = Number(byType.day || 0);
  const hour = Number(byType.hour || 0);
  const minute = Number(byType.minute || 0);

  return {
    weekday,
    year,
    month,
    day,
    hour,
    minute,
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function isSummaryDeliveryWindow(now, pref, summaryFrequency) {
  const timeZone = pref.summaryTimeZone || "America/Los_Angeles";
  const nowLocal = getTimeZoneParts(now, timeZone);
  const isWeekly = summaryFrequency === "weekly";
  const deliveryHour = Number(
    isWeekly ? pref.summaryWeeklyDeliveryHour : pref.summaryDailyDeliveryHour
  );
  const deliveryMinute = Number(
    isWeekly ? pref.summaryWeeklyDeliveryMinute : pref.summaryDailyDeliveryMinute
  );

  // Scheduler runs every 15 min; honor user-selected quarter-hour window.
  return nowLocal.hour === deliveryHour && nowLocal.minute === deliveryMinute;
}

function valueToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isCampaignEnded(campaign = {}, now = new Date()) {
  const status = String(campaign.status || "").toLowerCase();
  if (["ended", "complete", "completed", "archived", "inactive", "closed"].includes(status)) {
    return true;
  }
  if (campaign.isActive === false) return true;
  const endDate = valueToDate(campaign.endDate);
  return Boolean(endDate && now > endDate);
}

function getReportingSummaryConfig(orgData = {}) {
  const reporting = orgData.reporting || {};
  return {
    // Safe default: avoid sending summaries for campaigns that are clearly ended.
    excludeEndedCampaigns: reporting.excludeEndedCampaigns !== false,
    // Safe default: skip summary emails when no in-scope active campaigns remain.
    sendWhenNoActiveCampaigns: reporting.sendWhenNoActiveCampaigns === true,
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function getPaidDonationsForWindow(db, orgId, periodStart, periodEnd) {
  const startTs = admin.firestore.Timestamp.fromDate(periodStart);
  const endTs = admin.firestore.Timestamp.fromDate(periodEnd);

  try {
    const indexedSnap = await db
      .collection("donations")
      .where("orgId", "==", orgId)
      .where("status", "==", "paid")
      .where("createdAt", ">=", startTs)
      .where("createdAt", "<", endTs)
      .get();
    return indexedSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (err) {
    const message = String(err?.message || "").toLowerCase();
    const isIndexError =
      err?.code === 9 ||
      message.includes("requires an index") ||
      message.includes("failed-precondition");
    if (!isIndexError) throw err;

    logger.warn("summary query fallback: missing index for donations window query", {
      orgId,
      message: err?.message,
    });

    // Fallback path: broader org query then in-memory filter.
    const broadSnap = await db
      .collection("donations")
      .where("orgId", "==", orgId)
      .get();

    return broadSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((row) => {
        if (String(row.status || "").toLowerCase() !== "paid") return false;
        const createdAt = row.createdAt?.toDate?.();
        if (!createdAt) return false;
        return createdAt >= periodStart && createdAt < periodEnd;
      });
  }
}

exports.runEmailSummaries = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async () => {
    const db = admin.firestore();
    const now = new Date();
    const periodEnd = new Date(now);
    const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const usersSnap = await db
      .collection("users")
      .where("role", "in", ["coach", "admin", "super-admin"])
      .get();

    if (usersSnap.empty) {
      logger.info("runEmailSummaries: no eligible users found");
      return;
    }

    const recipients = [];
    usersSnap.forEach((docSnap) => {
      const userData = docSnap.data() || {};
      const pref = getSummaryPreference(userData);

      if (!pref.isEligibleRole) return;
      if (userData.status && userData.status !== "active") return;
      if (!userData.orgId || !userData.email) return;
      if (userData.preferences?.emailNotifications === false) return;
      if (!pref.summaryEnabled || !pref.summaryEmailEnabled) return;
      if (pref.summaryFrequency === "off") return;
      if (!isSummaryDeliveryWindow(now, pref, pref.summaryFrequency)) return;

      const localNow = getTimeZoneParts(now, pref.summaryTimeZone);
      if (pref.summaryFrequency === "weekly" && localNow.weekday !== 1) return;
      const selectedDeliveryHour =
        pref.summaryFrequency === "weekly" ?
          pref.summaryWeeklyDeliveryHour :
          pref.summaryDailyDeliveryHour;
      const selectedDeliveryMinute =
        pref.summaryFrequency === "weekly" ?
          pref.summaryWeeklyDeliveryMinute :
          pref.summaryDailyDeliveryMinute;

      recipients.push({
        uid: docSnap.id,
        email: String(userData.email || "").trim(),
        orgId: String(userData.orgId || "").trim(),
        role: pref.role,
        summaryFrequency: pref.summaryFrequency,
        summaryTimeZone: pref.summaryTimeZone,
        summaryDeliveryHour: selectedDeliveryHour,
        summaryDeliveryMinute: selectedDeliveryMinute,
        localDateKey: localNow.dateKey,
      });
    });

    if (!recipients.length) {
      logger.info("runEmailSummaries: no recipients after preference filters");
      return;
    }

    const orgCache = new Map();
    const teamsByOrg = new Map();
    const campaignsByOrg = new Map();
    const donationsByOrg = new Map();
    const athletesByOrg = new Map();
    const athleteContactsByOrg = new Map();

    async function ensureOrgData(orgId) {
      if (orgCache.has(orgId)) return;

      const [orgSnap, teamsSnap, campaignsSnap, donationsRows, athletesSnap, contactsSnap] =
        await Promise.all([
          db.collection("organizations").doc(orgId).get(),
          db.collection("teams").where("orgId", "==", orgId).get(),
          db.collection("campaigns").where("orgId", "==", orgId).get(),
          getPaidDonationsForWindow(db, orgId, periodStart, periodEnd),
          db.collection("athletes").where("orgId", "==", orgId).get(),
          db.collection("athlete_contacts").where("orgId", "==", orgId).get(),
        ]);

      orgCache.set(orgId, orgSnap.exists ? orgSnap.data() || {} : {});
      teamsByOrg.set(
        orgId,
        teamsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
      );
      campaignsByOrg.set(
        orgId,
        campaignsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
      );
      donationsByOrg.set(
        orgId,
        donationsRows
      );
      athletesByOrg.set(
        orgId,
        athletesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
      );
      athleteContactsByOrg.set(
        orgId,
        contactsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }))
      );
    }

    let sentCount = 0;
    let skippedCount = 0;
    let skippedNoActiveCampaignsCount = 0;

    for (const recipient of recipients) {
      const runDateKey = recipient.localDateKey || periodEnd.toISOString().slice(0, 10);
      const runId = `${runDateKey}_${recipient.summaryFrequency}_${recipient.uid}`;
      const runRef = db.collection("summary_runs").doc(runId);
      try {
        await runRef.create({
          uid: recipient.uid,
          orgId: recipient.orgId,
          role: recipient.role,
          summaryFrequency: recipient.summaryFrequency,
          dateKey: runDateKey,
          summaryTimeZone: recipient.summaryTimeZone,
          summaryDeliveryHour: recipient.summaryDeliveryHour,
          summaryDeliveryMinute: recipient.summaryDeliveryMinute,
          status: "started",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        // Already created = already processed.
        if (err?.code === 6 || String(err?.message || "").includes("ALREADY_EXISTS")) {
          skippedCount += 1;
          continue;
        }
        throw err;
      }

      try {
        await ensureOrgData(recipient.orgId);
        const orgData = orgCache.get(recipient.orgId) || {};
        const reportingConfig = getReportingSummaryConfig(orgData);
        const teams = teamsByOrg.get(recipient.orgId) || [];
        const campaigns = campaignsByOrg.get(recipient.orgId) || [];
        const donations = donationsByOrg.get(recipient.orgId) || [];
        const athletes = athletesByOrg.get(recipient.orgId) || [];
        const athleteContacts = athleteContactsByOrg.get(recipient.orgId) || [];

        const campaignById = new Map(campaigns.map((c) => [c.id, c]));

        let scopedTeams = teams;
        let scopedTeamIds = new Set(teams.map((t) => t.id));
        if (recipient.role === "coach") {
          scopedTeams = teams.filter((t) => String(t.coachId || "") === recipient.uid);
          scopedTeamIds = new Set(scopedTeams.map((t) => t.id));
        }

        const scopedCampaignsRaw =
          recipient.role === "coach"
            ? campaigns.filter((c) => scopedTeamIds.has(String(c.teamId || "")))
            : campaigns;
        const scopedCampaigns = reportingConfig.excludeEndedCampaigns
          ? scopedCampaignsRaw.filter((c) => !isCampaignEnded(c, periodEnd))
          : scopedCampaignsRaw;
        const scopedCampaignIds = new Set(scopedCampaigns.map((c) => c.id));

        if (!scopedCampaigns.length && !reportingConfig.sendWhenNoActiveCampaigns) {
          await runRef.set(
            {
              status: "skipped_no_active_campaigns",
              skippedAt: admin.firestore.FieldValue.serverTimestamp(),
              reason: "No active campaigns in summary scope",
            },
            { merge: true }
          );
          skippedNoActiveCampaignsCount += 1;
          continue;
        }

        const scopedAthletes =
          recipient.role === "coach"
            ? athletes.filter((a) => scopedTeamIds.has(String(a.teamId || "")))
            : athletes;
        const scopedAthleteIds = new Set(scopedAthletes.map((a) => a.id));

        const scopedDonations =
          recipient.role === "coach"
            ? donations.filter((d) => scopedCampaignIds.has(String(d.campaignId || "")))
            : donations;

        const scopedContacts =
          recipient.role === "coach"
            ? athleteContacts.filter((c) => scopedAthleteIds.has(String(c.athleteId || "")))
            : athleteContacts;

        const donationCount = scopedDonations.length;
        const amountCents = scopedDonations.reduce(
          (sum, d) => sum + Number(d.amount || 0),
          0
        );

        const topCampaignMap = {};
        scopedDonations.forEach((d) => {
          const campaignId = String(d.campaignId || "");
          if (!campaignId) return;
          topCampaignMap[campaignId] =
            (topCampaignMap[campaignId] || 0) + Number(d.amount || 0);
        });

        const topCampaignRows = Object.entries(topCampaignMap)
          .map(([campaignId, cents]) => ({
            campaignId,
            cents,
            campaignName:
              campaignById.get(campaignId)?.name ||
              campaignById.get(campaignId)?.title ||
              campaignId,
          }))
          .sort((a, b) => b.cents - a.cents)
          .slice(0, 5);

        const teamNameList =
          recipient.role === "coach"
            ? scopedTeams
                .map((t) => t.name || t.teamName || t.id)
                .filter(Boolean)
                .slice(0, 5)
            : [];

        const scopeLabel =
          recipient.role === "coach"
            ? `${scopedTeams.length} team(s): ${teamNameList.join(", ") || "none"}`
            : `Organization: ${orgData.name || recipient.orgId}`;

        const subjectPrefix =
          recipient.summaryFrequency === "weekly" ? "Weekly" : "Daily";
        const subjectRole = recipient.role === "coach" ? "Coach" : "Org";
        const subject = `${subjectPrefix} ${subjectRole} Fundraising Summary`;

        const textLines = [
          `${subject}`,
          `Period: ${formatDateRange(periodStart, periodEnd)}`,
          recipient.role === "coach"
            ? `Scope: ${scopeLabel}`
            : `Organization: ${orgData.name || recipient.orgId}`,
          `Donations: ${donationCount}`,
          `Amount Raised: ${formatCurrencyFromCents(amountCents)}`,
          `Campaigns in Scope: ${scopedCampaigns.length}`,
          `Athletes in Scope: ${scopedAthletes.length}`,
          `Contacts in Scope: ${scopedContacts.length}`,
        ];

        if (topCampaignRows.length) {
          textLines.push("Top Campaigns:");
          topCampaignRows.forEach((row) => {
            textLines.push(
              `- ${row.campaignName}: ${formatCurrencyFromCents(row.cents)}`
            );
          });
        }

        await db.collection("mail").add({
          to: recipient.email,
          message: {
            subject,
            text: textLines.join("\n"),
            html: renderTransactionalShell({
              subject,
              bodyText: textLines.join("\n"),
              footerText: `Summary time zone: ${recipient.summaryTimeZone}`,
            }),
          },
          kind: "summary",
          campaignId: null,
          athleteId: null,
          templateVersion: "summary-v1",
          summaryFrequency: recipient.summaryFrequency,
          summaryDateKey: runDateKey,
          uid: recipient.uid,
          orgId: recipient.orgId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await runRef.set(
          {
            status: "sent",
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            donationCount,
            amountCents,
          },
          { merge: true }
        );
        sentCount += 1;
      } catch (err) {
        logger.error("runEmailSummaries: failed for recipient", {
          uid: recipient.uid,
          orgId: recipient.orgId,
          message: err?.message,
        });
        await runRef.set(
          {
            status: "failed",
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
            error: err?.message || "unknown",
          },
          { merge: true }
        );
      }
    }

    logger.info("runEmailSummaries: complete", {
      recipients: recipients.length,
      sentCount,
      skippedCount,
      skippedNoActiveCampaignsCount,
      windowEnd: periodEnd.toISOString(),
    });
  }
);

exports.sendTestSummaryNow = onCall(
  {
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const db = admin.firestore();
    const requesterUid = request?.auth?.uid || "";
    if (!requesterUid) {
      throw new HttpsError("unauthenticated", "Login required");
    }

    const requesterProfile = await getUserProfile(requesterUid);
    if (!requesterProfile) {
      throw new HttpsError("permission-denied", "User profile not found");
    }
    if (requesterProfile.status && requesterProfile.status !== "active") {
      throw new HttpsError("permission-denied", "User is not active");
    }

    const requesterRole = String(requesterProfile.role || "").toLowerCase();
    const isAdminCaller = requesterRole === "admin" || requesterRole === "super-admin";
    const isCoachCaller = requesterRole === "coach";
    if (!isAdminCaller && !isCoachCaller) {
      throw new HttpsError("permission-denied", "Only admins and coaches can send test summaries");
    }

    const targetUid = String(request?.data?.targetUid || requesterUid).trim();

    if (!targetUid) {
      throw new HttpsError("invalid-argument", "targetUid is required");
    }

    if (isCoachCaller && targetUid !== requesterUid) {
      throw new HttpsError("permission-denied", "Coaches can only send test summaries to themselves");
    }

    const targetSnap = await db.collection("users").doc(targetUid).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "Target user not found");
    }

    const targetUser = targetSnap.data() || {};
    const role = String(targetUser.role || "").toLowerCase();
    if (!["coach", "admin", "super-admin"].includes(role)) {
      throw new HttpsError("failed-precondition", "Target role is not summary-eligible");
    }

    if (targetUser.status && targetUser.status !== "active") {
      throw new HttpsError("failed-precondition", "Target user is not active");
    }

    const orgId = String(targetUser.orgId || "").trim();
    const email = String(targetUser.email || "").trim();
    if (!orgId || !email) {
      throw new HttpsError("failed-precondition", "Target user missing orgId or email");
    }

    if (
      requesterRole !== "super-admin" &&
      String(requesterProfile.orgId || "") !== orgId
    ) {
      throw new HttpsError("permission-denied", "You can only test summaries in your own org");
    }

    const now = new Date();
    const periodEnd = new Date(now);
    const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dateKey = periodEnd.toISOString().slice(0, 10);

    const [orgSnap, teamsSnap, campaignsSnap, donations, athletesSnap, contactsSnap] =
      await Promise.all([
        db.collection("organizations").doc(orgId).get(),
        db.collection("teams").where("orgId", "==", orgId).get(),
        db.collection("campaigns").where("orgId", "==", orgId).get(),
        getPaidDonationsForWindow(db, orgId, periodStart, periodEnd),
        db.collection("athletes").where("orgId", "==", orgId).get(),
        db.collection("athlete_contacts").where("orgId", "==", orgId).get(),
      ]);

    const orgData = orgSnap.exists ? orgSnap.data() || {} : {};
    const reportingConfig = getReportingSummaryConfig(orgData);
    const teams = teamsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const campaigns = campaignsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const athletes = athletesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    const athleteContacts = contactsSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

    const campaignById = new Map(campaigns.map((c) => [c.id, c]));

    let scopedTeams = teams;
    let scopedTeamIds = new Set(teams.map((t) => t.id));
    if (role === "coach") {
      scopedTeams = teams.filter((t) => String(t.coachId || "") === targetUid);
      scopedTeamIds = new Set(scopedTeams.map((t) => t.id));
    }

    const scopedCampaignsRaw =
      role === "coach"
        ? campaigns.filter((c) => scopedTeamIds.has(String(c.teamId || "")))
        : campaigns;
    const scopedCampaigns = reportingConfig.excludeEndedCampaigns
      ? scopedCampaignsRaw.filter((c) => !isCampaignEnded(c, periodEnd))
      : scopedCampaignsRaw;
    const scopedCampaignIds = new Set(scopedCampaigns.map((c) => c.id));

    if (!scopedCampaigns.length && !reportingConfig.sendWhenNoActiveCampaigns) {
      return {
        ok: true,
        queued: false,
        skipped: true,
        reason: "no_active_campaigns",
        message: "No summary queued because no active campaigns are in scope.",
        targetUid,
        orgId,
        role,
      };
    }

    const scopedAthletes =
      role === "coach"
        ? athletes.filter((a) => scopedTeamIds.has(String(a.teamId || "")))
        : athletes;
    const scopedAthleteIds = new Set(scopedAthletes.map((a) => a.id));

    const scopedDonations =
      role === "coach"
        ? donations.filter((d) => scopedCampaignIds.has(String(d.campaignId || "")))
        : donations;

    const scopedContacts =
      role === "coach"
        ? athleteContacts.filter((c) => scopedAthleteIds.has(String(c.athleteId || "")))
        : athleteContacts;

    const donationCount = scopedDonations.length;
    const amountCents = scopedDonations.reduce((sum, d) => sum + Number(d.amount || 0), 0);

    const topCampaignMap = {};
    scopedDonations.forEach((d) => {
      const campaignId = String(d.campaignId || "");
      if (!campaignId) return;
      topCampaignMap[campaignId] = (topCampaignMap[campaignId] || 0) + Number(d.amount || 0);
    });

    const topCampaignRows = Object.entries(topCampaignMap)
      .map(([campaignId, cents]) => ({
        campaignId,
        cents,
        campaignName:
          campaignById.get(campaignId)?.name ||
          campaignById.get(campaignId)?.title ||
          campaignId,
      }))
      .sort((a, b) => b.cents - a.cents)
      .slice(0, 5);

    const teamNameList =
      role === "coach"
        ? scopedTeams
            .map((t) => t.name || t.teamName || t.id)
            .filter(Boolean)
            .slice(0, 5)
        : [];

    const scopeLabel =
      role === "coach"
        ? `${scopedTeams.length} team(s): ${teamNameList.join(", ") || "none"}`
        : `Organization: ${orgData.name || orgId}`;

    const subject = "Test Daily Fundraising Summary";
    const textLines = [
      `${subject}`,
      `Period: ${formatDateRange(periodStart, periodEnd)}`,
      `Scope: ${scopeLabel}`,
      `Donations: ${donationCount}`,
      `Amount Raised: ${formatCurrencyFromCents(amountCents)}`,
      `Campaigns in Scope: ${scopedCampaigns.length}`,
      `Athletes in Scope: ${scopedAthletes.length}`,
      `Contacts in Scope: ${scopedContacts.length}`,
    ];

    if (topCampaignRows.length) {
      textLines.push("Top Campaigns:");
      topCampaignRows.forEach((row) => {
        textLines.push(`- ${row.campaignName}: ${formatCurrencyFromCents(row.cents)}`);
      });
    }

    await db.collection("mail").add({
      to: email,
      message: {
        subject,
        text: textLines.join("\n"),
        html: renderTransactionalShell({
          subject,
          bodyText: textLines.join("\n"),
          footerText: "Manual test summary send",
        }),
      },
      kind: "summary",
      campaignId: null,
      athleteId: null,
      templateVersion: "summary-test-v1",
      isTestSummary: true,
      summaryDateKey: dateKey,
      uid: targetUid,
      orgId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info("sendTestSummaryNow: queued", {
      targetUid,
      orgId,
      role,
      donationCount,
      amountCents,
    });

    return {
      ok: true,
      queued: true,
      targetUid,
      orgId,
      role,
      donationCount,
      amountCents,
      campaignsInScope: scopedCampaigns.length,
      athletesInScope: scopedAthletes.length,
      contactsInScope: scopedContacts.length,
    };
  }
);

/* ============================================================
   PHASE 17 â€” WEBHOOK FAILURE ALERT MONITOR
   - Scans recent webhook_failures
   - Sends alert email if failures cross threshold
   ============================================================ */
exports.webhookFailureMonitor = onSchedule(
  {
    schedule: "every 10 minutes",
    timeZone: "UTC",
    memory: "256MiB",
    timeoutSeconds: 60,
  },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const windowStart = admin.firestore.Timestamp.fromMillis(
      now - WEBHOOK_ALERT_WINDOW_MINUTES * 60 * 1000
    );

    const snap = await db
      .collection("webhook_failures")
      .where("createdAt", ">=", windowStart)
      .get();

    if (snap.empty) {
      logger.info("webhookFailureMonitor: no recent failures");
      return;
    }

    const grouped = {};
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const source = String(data.source || "unknown");
      if (!grouped[source]) grouped[source] = [];
      grouped[source].push({
        id: docSnap.id,
        reason: data.reason || "unknown",
        eventType: data.eventType || null,
        eventId: data.eventId || null,
        createdAt: data.createdAt || null,
      });
    });

    const alertEmail = getWebhookAlertEmail();

    for (const [source, rows] of Object.entries(grouped)) {
      if (rows.length < WEBHOOK_ALERT_THRESHOLD) continue;

      const stateRef = db.collection("system_alert_state").doc(`webhook_${source}`);
      const stateSnap = await stateRef.get();
      const lastSentAtMs = stateSnap.exists
        ? stateSnap.data()?.lastSentAt?.toMillis?.() || 0
        : 0;
      const cooldownMs = WEBHOOK_ALERT_COOLDOWN_MINUTES * 60 * 1000;

      if (lastSentAtMs && now - lastSentAtMs < cooldownMs) {
        logger.info("webhookFailureMonitor: cooldown active", {
          source,
          failures: rows.length,
        });
        continue;
      }

      logger.warn("webhookFailureMonitor: threshold reached", {
        source,
        failures: rows.length,
      });

      const stateUpdate = {
        source,
        lastFailureCount: rows.length,
        lastEvaluatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!alertEmail) {
        logger.warn("webhookFailureMonitor: WEBHOOK_ALERT_EMAIL not configured", {
          source,
          failures: rows.length,
        });
      } else {
        const recentLines = rows
          .slice(0, 5)
          .map((row) => `- ${row.reason} (${row.eventType || "n/a"}) [${row.eventId || row.id}]`)
          .join("\n");

        await db.collection("mail").add({
          to: alertEmail,
          message: {
            subject: `[ALERT] ${source} webhook failures (${rows.length}/${WEBHOOK_ALERT_WINDOW_MINUTES}m)`,
            text: `Detected ${rows.length} ${source} webhook failures in the last ${WEBHOOK_ALERT_WINDOW_MINUTES} minutes.\n\nRecent failures:\n${recentLines}\n\nProject: fundraising-mvp-auth-payments`,
          },
          kind: "webhook_alert",
          orgId: null,
          campaignId: null,
          athleteId: null,
          templateVersion: "webhook-alert-v1",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        stateUpdate.lastSentAt = admin.firestore.FieldValue.serverTimestamp();
      }

      await stateRef.set(
        stateUpdate,
        { merge: true }
      );
    }
  }
);


