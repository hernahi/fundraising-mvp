import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Global email helper for your fundraising app.
 *
 * Supports:
 * ✅ Single or multiple recipients
 * ✅ Raw HTML emails
 * ✅ Template-based emails (future-ready)
 * ✅ Meta fields for categorization
 * ✅ Automatic timestamps
 * ✅ Full validation
 *
 * Usage:
 *
 * await sendEmail({
 *   to: "coach@example.com",
 *   subject: "Welcome",
 *   html: "<p>Thanks for joining!</p>",
 *   meta: { type: "welcome", orgId: "abc123" }
 * });
 *
 * // Template mode:
 * await sendEmail({
 *   to: "donor@example.com",
 *   template: "donation-receipt",
 *   vars: { donorName: "Alice", amount: 100 },
 *   meta: { type: "donor-receipt", orgId: "abc123" }
 * });
 */

export async function sendEmail({ to, subject, html, meta = {}, template = null, vars = {} }) {
  // ✅ Validation
  if (!to) {
    throw new Error("sendEmail: missing required field 'to'");
  }

  if (!subject && !template) {
    throw new Error("sendEmail: either 'subject' or 'template' must be provided");
  }

  if (template && typeof template !== "string") {
    throw new Error("sendEmail: 'template' must be a string when provided");
  }

  // ✅ Normalize recipient(s)
  const recipients = Array.isArray(to) ? to : [to];

  // ✅ Build clean Firestore document
  const emailDoc = {
    to: recipients,
    message: {
      subject: subject || null,
      html: html || null,
    },
    meta,
    createdAt: serverTimestamp(),
  };

  // ✅ Add template mode if used
  if (template) {
    emailDoc.template = template;

    if (vars && typeof vars === "object" && Object.keys(vars).length > 0) {
      emailDoc.vars = vars;
    }
  }

  // ✅ Save to Firestore (triggers the Cloud Function)
  return await addDoc(collection(db, "mail"), emailDoc);
}
