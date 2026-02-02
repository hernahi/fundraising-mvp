import { useState } from "react";
import { db } from "../firebase/config";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";

const INVITE_EMAIL_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>You're Invited</title>
  </head>
  <body style="margin:0; padding:0; background-color:#f8fafc; font-family:Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;">
      <tr>
        <td align="center">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background:#ffffff; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,0.08); padding:32px;">
            <tr>
              <td style="font-size:22px; font-weight:700; color:#0f172a; padding-bottom:16px;">
                You're invited to Fundraising MVP
              </td>
            </tr>
            <tr>
              <td style="font-size:15px; color:#334155; line-height:1.6; padding-bottom:24px;">
                You’ve been invited to join <strong>Fundraising MVP</strong>.
                Click the button below to accept your invitation.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <a
                  href="{{INVITE_LINK}}"
                  style="display:inline-block;background-color:#0f172a;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600;"
                >
                  Accept Invitation
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px; color:#475569;">
                Or copy and paste this link:
                <br />
                <a href="{{INVITE_LINK}}" style="color:#2563eb;">
                  {{INVITE_LINK}}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const INVITE_EMAIL_TEXT = `
You’ve been invited to join Fundraising MVP.

Accept your invitation here:
{{INVITE_LINK}}

If you were not expecting this email, you can ignore it.
`;

export default function AdminInviteUser() {
  const { profile } = useAuth();

  const [form, setForm] = useState({
    email: "",
    role: "coach",
    teamId: "",
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  if (profile?.role !== "admin") {
    return <div className="p-6 text-red-500">Access denied</div>;
  }

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      // 1️⃣ Create invite
      const inviteRef = await addDoc(collection(db, "invites"), {
        email: form.email,
        role: form.role,
        orgId: profile.orgId,
        teamId: form.teamId || null,
        status: "pending",
        invitedBy: profile.uid,
        createdAt: serverTimestamp(),
      });

      // 2️⃣ Build invite link
      const inviteLink = `${window.location.origin}/accept-invite?invite=${inviteRef.id}`;
      console.log("Invite link:", inviteLink);

      // 3️⃣ Send email
      await addDoc(collection(db, "mail"), {
        to: form.email,
        message: {
          subject: "You’ve been invited to join Fundraising MVP",
          html: INVITE_EMAIL_HTML.replaceAll("{{INVITE_LINK}}", inviteLink),
          text: INVITE_EMAIL_TEXT.replaceAll("{{INVITE_LINK}}", inviteLink),
        },
      });

      // 4️⃣ Success feedback + reset
      setSuccess(true);
      setForm({
        email: "",
        role: "coach",
        teamId: "",
      });
    } catch (err) {
      console.error("❌ Invite failed:", err);
      setError("Failed to send invitation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto bg-white rounded-xl shadow">
      <h1 className="text-xl font-bold mb-4">Invite New User</h1>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Email</label>
          <input
            className="w-full border rounded px-3 py-2"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm mb-1">Role</label>
          <select
            className="w-full border rounded px-3 py-2"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="coach">Coach</option>
            <option value="athlete">Athlete</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <div>
          <label className="block text-sm mb-1">Team (optional)</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={form.teamId}
            placeholder="teamId for auto-join"
            onChange={(e) => setForm({ ...form, teamId: e.target.value })}
          />
        </div>

        <button
          disabled={loading}
          className="w-full bg-yellow-400 py-2 rounded font-semibold hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Sending..." : "Invite User"}
        </button>

        {success && (
          <div className="text-sm text-green-600 mt-2">
            ✅ Invitation sent successfully
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 mt-2">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
