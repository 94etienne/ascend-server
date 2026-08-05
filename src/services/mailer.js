import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

/* ============================================================
   GMAIL SMTP

   You need an APP PASSWORD, not your normal Gmail password:
     1. Google Account → Security → enable 2-Step Verification
     2. Security → App passwords → generate one for "Mail"
     3. Paste the 16-character code into SMTP_PASS in .env

   Google blocks plain-password SMTP outright, so this isn't
   optional — your normal password will simply be rejected.
   ============================================================ */

const HAS_SMTP = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

const transporter = HAS_SMTP
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

export async function verifyMailer() {
  if (!transporter) {
    console.warn("⚠ SMTP not configured — emails will print to the console.");
    return;
  }
  await transporter.verify();
  console.log(`✓ SMTP ready — ${process.env.SMTP_USER}`);
}

/* If SMTP isn't set up, log instead of throwing.
   A failed email must never lose an application. */
async function send({ to, subject, html, text }) {
  if (!transporter) {
    console.log("\n──────── EMAIL (not sent — no SMTP) ────────");
    console.log("To:      ", to);
    console.log("Subject: ", subject);
    console.log((text || "").slice(0, 500));
    console.log("────────────────────────────────────────────\n");
    return { logged: true };
  }

  const info = await transporter.sendMail({
    from: `"AscendAI-Labs" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });

  console.log(`✓ Email sent → ${to}`);
  return info;
}

/* Inline CSS only — Gmail strips <style> blocks. */
function layout(bodyHtml) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F7F5EF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5EF;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:4px;overflow:hidden;">

<tr><td style="background:#0B1418;padding:24px 32px;">
  <span style="color:#F7F5EF;font-size:20px;font-weight:700;letter-spacing:-.5px;">Ascend<span style="color:#E8B33C;">AI</span></span>
  <span style="color:rgba(247,245,239,.45);font-size:12px;display:block;margin-top:4px;">Huye, Rwanda</span>
</td></tr>

<tr><td style="padding:32px;color:#0B1418;font-size:15px;line-height:1.65;">
  ${bodyHtml}
</td></tr>

<tr><td style="background:#EAE6DA;padding:20px 32px;font-size:12px;color:#5C6B70;line-height:1.6;">
  AscendAI-Labs Ltd — Huye, Southern Province, Rwanda<br>
  <a href="mailto:19etienne@gmail.com" style="color:#1D4B3E;">19etienne@gmail.com</a> &nbsp;·&nbsp; +250 783 716 761
</td></tr>

</table></td></tr></table></body></html>`;
}

/* ============================================================
   1. APPLICATION RECEIVED + SET YOUR PASSWORD
   NO PASSWORD IS EVER PUT IN AN EMAIL. Only a one-time link.
   ============================================================ */
export async function sendWelcomeEmail({
  to,
  fullName,
  username,
  phone,
  trackLabel,
  setPasswordUrl,
  expiresHours,
}) {
  const first = String(fullName).trim().split(/\s+/)[0];

  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">We've got your application, ${first}.</h1>

    <p style="margin:0 0 20px;">
      Thanks for applying for <strong>${trackLabel}</strong>. We read every application
      and we'll reply within five working days.
    </p>

    <p style="margin:0 0 12px;">In the meantime, we've created your account. Set a password to access it:</p>

    <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr><td style="background:#E8B33C;border-radius:2px;">
        <a href="${setPasswordUrl}" style="display:inline-block;padding:14px 28px;color:#0B1418;font-weight:600;font-size:15px;text-decoration:none;">Set your password →</a>
      </td></tr>
    </table>

    <p style="margin:0 0 24px;font-size:13px;color:#5C6B70;">
      This link works once and expires in ${expiresHours} hours.
      If it lapses, request a new one from the login page.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5EF;border-left:3px solid #1D4B3E;border-radius:0 3px 3px 0;margin:0 0 24px;">
      <tr><td style="padding:16px 20px;">
        <p style="margin:0 0 12px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#5C6B70;font-weight:600;">You can sign in with any of these</p>
        <p style="margin:0;font-size:14px;line-height:2;">
          <span style="color:#5C6B70;">Username</span> &nbsp;<code style="background:#EAE6DA;padding:2px 6px;border-radius:2px;">${username}</code><br>
          <span style="color:#5C6B70;">Email</span> &nbsp;&nbsp;&nbsp;&nbsp;<code style="background:#EAE6DA;padding:2px 6px;border-radius:2px;">${to}</code><br>
          <span style="color:#5C6B70;">Phone</span> &nbsp;&nbsp;&nbsp;&nbsp;<code style="background:#EAE6DA;padding:2px 6px;border-radius:2px;">${phone}</code>
        </p>
      </td></tr>
    </table>

    <p style="margin:0;font-size:13px;color:#5C6B70;">
      We will never email you a password, and we will never ask you for one.
      If a message claiming to be from us does either, it isn't from us.
    </p>
  `);

  const text = `We've got your application, ${first}.

Thanks for applying for ${trackLabel}. We'll reply within five working days.

Set your password:
${setPasswordUrl}

This link works once and expires in ${expiresHours} hours.

You can sign in with any of these:
  Username: ${username}
  Email:    ${to}
  Phone:    ${phone}

We will never email you a password, and we will never ask you for one.

— AscendAI-Labs, Huye, Rwanda`;

  return send({
    to,
    subject: "Your AscendAI-Labs application — set your password",
    html,
    text,
  });
}

/* ============================================================
   2. PASSWORD RESET
   ============================================================ */
export async function sendResetEmail({ to, fullName, resetUrl, expiresHours }) {
  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:22px;">Reset your password</h1>
    <p style="margin:0 0 20px;">
      Someone asked to reset the password for ${fullName}'s account.
      If that was you, use the link below.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr><td style="background:#E8B33C;border-radius:2px;">
        <a href="${resetUrl}" style="display:inline-block;padding:14px 28px;color:#0B1418;font-weight:600;font-size:15px;text-decoration:none;">Reset password →</a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#5C6B70;">
      This link works once and expires in ${expiresHours} hours.
      If you didn't ask for this, ignore this email — nothing changes until the link is used.
    </p>
  `);

  const text = `Reset your AscendAI-Labs password

${resetUrl}

Works once, expires in ${expiresHours} hours.
If you didn't ask for this, ignore this email.

— AscendAI-Labs`;

  return send({ to, subject: "Reset your AscendAI-Labs password", html, text });
}

/* ============================================================
   3. INTERNAL ALERT — new application
   ============================================================ */
export async function sendAdminAlert(a) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;

  const loc =
    [a.province, a.district, a.sector, a.cell, a.village].filter(Boolean).join(" / ") ||
    a.address ||
    "—";

  const html = layout(`
    <h1 style="margin:0 0 16px;font-size:20px;">New application — ${a.track}</h1>
    <table width="100%" cellpadding="6" cellspacing="0" style="font-size:14px;">
      <tr><td style="color:#5C6B70;width:110px;">Name</td><td><strong>${a.full_name}</strong></td></tr>
      <tr><td style="color:#5C6B70;">Email</td><td>${a.email}</td></tr>
      <tr><td style="color:#5C6B70;">Phone</td><td>${a.phone}</td></tr>
      <tr><td style="color:#5C6B70;">Stage</td><td>${a.stage || "—"}</td></tr>
      <tr><td style="color:#5C6B70;">Location</td><td>${loc}</td></tr>
      ${a.school ? `<tr><td style="color:#5C6B70;">School</td><td>${a.school}</td></tr><tr><td style="color:#5C6B70;">Reg no.</td><td>${a.reg_no || "—"}</td></tr>` : ""}
    </table>
    ${a.message ? `<p style="margin:20px 0 0;padding:14px;background:#F7F5EF;border-radius:3px;font-size:14px;line-height:1.6;">${a.message}</p>` : ""}
  `);

  return send({
    to,
    subject: `New application — ${a.full_name} (${a.track})`,
    html,
    text: `New application from ${a.full_name} (${a.email}) for ${a.track}.`,
  });
}
