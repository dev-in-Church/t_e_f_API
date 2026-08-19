const { Resend } = require("resend");

// Initialize Resend with API key from environment
const resend = new Resend(process.env.RESEND_API_KEY);

// Verified sender on the foundation's Resend domain.
const EMAIL_FROM =
  process.env.EMAIL_FROM ||
  "Team Emmanuel Foundation <no-reply@mail.teamemmanuel.com>";

// All contact form notifications land in this inbox.
const CONTACT_RECIPIENT =
  process.env.CONTACT_RECIPIENT || "teamemmanuelfoundation@gmail.com";

const BRAND = {
  green: "#1a7a3c",
  red: "#d62828",
  dark: "#111111",
};

function baseLayout(title, bodyHtml) {
  return `
  <div style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:${BRAND.dark};padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="margin:0;color:#ffffff;font-size:18px;">
          <span style="color:${BRAND.green};">Team</span>
          <span style="color:${BRAND.red};">Emmanuel</span>
          <span style="color:#ffffff;">Foundation</span>
        </h1>
      </div>
      <div style="background:#ffffff;padding:28px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
        <h2 style="margin:0 0 16px;color:${BRAND.dark};font-size:20px;">${title}</h2>
        ${bodyHtml}
      </div>
      <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px;">
        &copy; ${new Date().getFullYear()} Team Emmanuel Foundation &middot; Eldoret, Kenya
      </p>
    </div>
  </div>`;
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Sends a notification to the foundation inbox whenever someone submits the
 * contact form. Reply-To is set to the sender so staff can reply directly.
 */
async function sendContactNotification({
  name,
  email,
  phone,
  subject,
  message,
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(
      "[email] RESEND_API_KEY not set - skipping contact notification email",
    );
    return { skipped: true };
  }

  const body = `
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">
      You have received a new message through the website contact form.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#111827;">
      <tr><td style="padding:6px 0;color:#6b7280;width:120px;">Name</td><td style="padding:6px 0;">${escapeHtml(name)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(email)}" style="color:${BRAND.green};">${escapeHtml(email)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Phone</td><td style="padding:6px 0;">${escapeHtml(phone || "Not provided")}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Subject</td><td style="padding:6px 0;">${escapeHtml(subject || "General Inquiry")}</td></tr>
    </table>
    <div style="margin-top:20px;padding:16px;background:#f9fafb;border-left:4px solid ${BRAND.green};border-radius:6px;">
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message)}</p>
    </div>
    <p style="margin-top:20px;color:#6b7280;font-size:13px;">
      Reply directly to this email to respond to ${escapeHtml(name)}, or use the admin dashboard.
    </p>`;

  return resend.emails.send({
    from: EMAIL_FROM,
    to: CONTACT_RECIPIENT,
    replyTo: email,
    subject: `New Contact Message: ${subject || "General Inquiry"}`,
    html: baseLayout("New Contact Message", body),
  });
}

/**
 * Sends the admin's reply to the person who originally submitted the form.
 */
async function sendContactReply({ to, name, originalMessage, replyContent }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set - skipping reply email");
    return { skipped: true };
  }

  const body = `
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 16px;">
      Hi ${escapeHtml(name)},
    </p>
    <p style="color:#374151;font-size:14px;line-height:1.6;margin:0 0 20px;white-space:pre-wrap;">${escapeHtml(replyContent)}</p>
    <div style="margin-top:8px;padding:16px;background:#f9fafb;border-radius:6px;">
      <p style="margin:0 0 6px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Your original message</p>
      <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(originalMessage)}</p>
    </div>
    <p style="margin-top:24px;color:#374151;font-size:14px;">
      Warm regards,<br/>
      <strong>Team Emmanuel Foundation</strong>
    </p>`;

  return resend.emails.send({
    from: EMAIL_FROM,
    to,
    replyTo: CONTACT_RECIPIENT,
    subject: "Re: Your message to Team Emmanuel Foundation",
    html: baseLayout("A reply from Team Emmanuel Foundation", body),
  });
}

module.exports = {
  resend,
  EMAIL_FROM,
  CONTACT_RECIPIENT,
  sendContactNotification,
  sendContactReply,
};
