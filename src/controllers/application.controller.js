import fs from "node:fs";
import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";
import {
  generateUsername,
  issueToken,
  mapStage,
} from "../services/auth.service.js";
import { sendWelcomeEmail, sendAdminAlert } from "../services/mailer.js";

const CLIENT = process.env.CLIENT_ORIGIN || "http://localhost:5173";

/* Non-program tracks the Apply form can send */
const OTHER_TRACKS = {
  INTERNSHIP: "Internship — Huye",
  TEAMS: "Team training",
  BUILD: "Software project",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* Delete an orphaned upload if the insert fails. */
function cleanupFiles(...list) {
  for (const f of list) {
    if (f?.path) fs.unlink(f.path, () => {});
  }
}

/* ============================================================
   POST /api/applications
   multipart/form-data (because of the passport photo)

   Does four things atomically:
     1. Insert the application
     2. Create (or reuse) a user account
     3. Issue a one-time set-password token
     4. Email the applicant a link

   If any of 1–3 fail, the whole thing rolls back — you never
   end up with a user who has no application, or vice versa.
   Email is sent AFTER commit, because a mail server hiccup
   must not throw away a submitted application.
   ============================================================ */
export const createApplication = asyncHandler(async (req, res) => {
  const b = req.body;
  /* Three uploads now: photo (ID badge), recommendation letter,
     and payment receipt. multer .fields() puts them in req.files
     keyed by field name, each an array. */
  const files = req.files || {};
  const photo = files.photo?.[0] || null;
  const recommendation = files.recommendation?.[0] || null;
  const receipt = files.receipt?.[0] || null;

  /* ---------- validate ---------- */
  const fullName = (b.name || "").trim();
  const email = (b.email || "").trim().toLowerCase();
  const phone = (b.phone || "").trim();
  const track = (b.track || "").trim().toUpperCase();

  if (!fullName || !email || !phone) {
    cleanupFiles(photo, recommendation, receipt);
    const e = new Error("Name, email, and phone are required.");
    e.status = 400;
    throw e;
  }

  if (!EMAIL_RE.test(email)) {
    cleanupFiles(photo, recommendation, receipt);
    const e = new Error("That email address doesn't look right.");
    e.status = 400;
    throw e;
  }

  if (!track) {
    cleanupFiles(photo, recommendation, receipt);
    const e = new Error("Choose what you're applying for.");
    e.status = 400;
    throw e;
  }

  /* Resolve the track to a human label for the email, and
     confirm it actually exists — someone could POST a made-up
     code straight to the API, bypassing the dropdown. */
  let trackLabel = OTHER_TRACKS[track];
  if (!trackLabel) {
    const [rows] = await pool.query(
      `SELECT name, is_active, apply_deadline FROM programs WHERE code = ? LIMIT 1`,
      [track]
    );
    if (!rows.length) {
      cleanupFiles(photo, recommendation, receipt);
      const e = new Error(`Unknown track "${track}".`);
      e.status = 400;
      throw e;
    }
    /* Closed if the admin closed it OR the application deadline has
       passed. Either way, reject — even a direct POST past the
       hidden button. */
    const dl = rows[0].apply_deadline;
    const past = dl && new Date(String(dl).slice(0,10) + "T23:59:59") < new Date(new Date().setHours(0,0,0,0));
    if (!rows[0].is_active || past) {
      cleanupFiles(photo, recommendation, receipt);
      const e = new Error("This one is currently closed for enrolment. Please check back soon.");
      e.status = 409;
      throw e;
    }
    trackLabel = `${track} — ${rows[0].name}`;
  }

  /* ---------- documents required (both letter & receipt) ---------- */
  if (!recommendation) {
    cleanupFiles(photo, recommendation, receipt);
    const e = new Error("Please attach your recommendation letter.");
    e.status = 400;
    throw e;
  }
  if (!receipt) {
    cleanupFiles(photo, recommendation, receipt);
    const e = new Error("Please attach your payment receipt.");
    e.status = 400;
    throw e;
  }

  /* ---------- no duplicate live application to the same track ----------
     A user may only hold ONE non-rejected application per track.
     If their previous one was rejected, they may apply again. */
  if (req.user?.sub) {
    const [dupes] = await pool.query(
      `SELECT id FROM applications
       WHERE user_id = ? AND track = ? AND status <> 'rejected' LIMIT 1`,
      [req.user.sub, track]
    );
    if (dupes.length) {
      cleanupFiles(photo, recommendation, receipt);
      const e = new Error("You already have an application for this one. Check your dashboard for its status.");
      e.status = 409;
      throw e;
    }
  }

  /* ---------- transaction ---------- */
  const conn = await pool.getConnection();
  let applicationId;
  let userId;
  let username;
  let rawToken;
  let expiresHours;
  let isNewUser = false;

  try {
    await conn.beginTransaction();

    /* 1. INSERT APPLICATION */
    const [insApp] = await conn.query(
      `INSERT INTO applications (
         track, full_name, email, phone, national_id, stage,
         province, district, sector, cell, village, address,
         school, department, reg_no, year_of_study,
         supervisor_name, supervisor_email,
         internship_start, internship_end, photo_path,
         recommendation_path, receipt_path,
         message
       ) VALUES (?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?,?, ?,?,?, ?,?, ?)`,
      [
        track,
        fullName,
        email,
        phone,
        b.nationalId || null,
        b.stage || null,

        b.province || null,
        b.district || null,
        b.sector || null,
        b.cell || null,
        b.village || null,
        b.address || null,

        b.school || null,
        b.department || null,
        b.regNo || null,
        b.yearOfStudy || null,

        b.supervisorName || null,
        b.supervisorEmail || null,

        b.internshipStart || null,
        b.internshipEnd || null,
        photo ? photo.path : null,
        recommendation ? recommendation.path : null,
        receipt ? receipt.path : null,

        b.message || null,
      ]
    );
    applicationId = insApp.insertId;

    /* 2. CREATE OR REUSE USER
       Someone may apply twice — for training, then the internship.
       Don't create a second account; link the new application to
       the account they already have. */
    const [existing] = await conn.query(
      `SELECT id, username FROM users WHERE email = ? LIMIT 1`,
      [email]
    );

    if (existing.length) {
      userId = existing[0].id;
      username = existing[0].username;
    } else {
      isNewUser = true;
      username = await generateUsername(fullName);

      /* Phone has a UNIQUE constraint. If someone else already
         registered it, store NULL rather than failing the whole
         application — we still have their email. */
      const [phoneTaken] = await conn.query(
        `SELECT id FROM users WHERE phone = ? LIMIT 1`,
        [phone]
      );

      const [insUser] = await conn.query(
        `INSERT INTO users
           (full_name, username, email, phone, national_id,
            role, stage, photo_path, password_hash)
         VALUES (?,?,?,?,?, 'student', ?, ?, NULL)`,
        [
          fullName,
          username,
          email,
          phoneTaken.length ? null : phone,
          b.nationalId || null,
          mapStage(b.stage),
          photo ? photo.path : null,
        ]
      );
      userId = insUser.insertId;
    }

    /* Link the application to the account */
    await conn.query(`UPDATE applications SET user_id = ? WHERE id = ?`, [
      userId,
      applicationId,
    ]);

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    cleanupFiles(photo, recommendation, receipt);

    /* Duplicate key = they already applied with this email today */
    if (err.code === "ER_DUP_ENTRY") {
      const e = new Error(
        "An account already exists with that email or phone. Try signing in, or use the password reset."
      );
      e.status = 409;
      throw e;
    }
    throw err;
  } finally {
    conn.release();
  }

  /* ---------- 3 + 4. TOKEN AND EMAIL (post-commit) ----------
     The application is safely saved. If email fails now, we log
     it and still return success — the applicant can request a
     fresh link from the login page. Losing the application
     because Gmail was slow would be far worse. */
  /* Only send the set-password link if they haven't got a
     password yet. A returning applicant who is already signed in
     doesn't need one — and telling them to "check your email to
     set your password" would be confusing and wrong. */
  let needsPassword = true;
  try {
    const [pw] = await pool.query(
      `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    needsPassword = !pw.length || !pw[0].password_hash;
  } catch {
    /* if the check fails, fall through and send the link */
  }

  try {
    if (!needsPassword) throw new Error("__skip_welcome__");

    const t = await issueToken(userId, "set_password");
    rawToken = t.raw;
    expiresHours = t.expiresHours;

    await sendWelcomeEmail({
      to: email,
      fullName,
      username,
      phone,
      trackLabel,
      setPasswordUrl: `${CLIENT}/set-password?token=${rawToken}`,
      expiresHours,
    });
  } catch (err) {
    if (err.message !== "__skip_welcome__") {
      console.error("✗ Welcome email failed:", err.message);
    }
  }

  /* Internal alert — never block the response on it */
  sendAdminAlert({
    track,
    full_name: fullName,
    email,
    phone,
    stage: b.stage,
    province: b.province,
    district: b.district,
    sector: b.sector,
    cell: b.cell,
    village: b.village,
    address: b.address,
    school: b.school,
    reg_no: b.regNo,
    message: b.message,
  }).catch((e) => console.error("✗ Admin alert failed:", e.message));

  res.status(201).json({
    ok: true,
    applicationId,
    username,
    isNewUser,
    needsPassword,
    message: needsPassword
      ? "Application received. Check your email for a link to set your password."
      : "Application received. You can track it from your dashboard.",
  });
});

/* ============================================================
   GET /api/applications          (admin only)
   ?status=new  &  ?track=AI-201  &  ?limit=50
   ============================================================ */
export const listApplications = asyncHandler(async (req, res) => {
  const { status, track } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  let sql = `
    SELECT a.id, a.status, a.track, a.full_name, a.email, a.phone,
           a.stage, a.school, a.department, a.reg_no, a.photo_path,
           CONCAT_WS(' / ', a.province, a.district, a.sector, a.cell, a.village)
             AS location,
           a.message, a.created_at,
           p.name AS program_name,
           c.serial AS certificate_serial
    FROM applications a
    LEFT JOIN programs     p ON p.code = a.track
    LEFT JOIN certificates c ON c.application_id = a.id
    WHERE 1 = 1
  `;
  const args = [];

  if (status) {
    sql += " AND a.status = ?";
    args.push(status);
  }
  if (track) {
    sql += " AND a.track = ?";
    args.push(track.toUpperCase());
  }

  sql += " ORDER BY a.created_at DESC LIMIT ?";
  args.push(limit);

  const [rows] = await pool.query(sql, args);
  res.json({ count: rows.length, applications: rows });
});

/* ============================================================
   PATCH /api/applications/:id/status     (admin only)
   ============================================================ */
export const updateStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;

  const VALID = [
    "new",
    "reviewing",
    "accepted",
    "waitlisted",
    "rejected",
    "completed",
  ];
  if (!VALID.includes(status)) {
    const e = new Error(`Status must be one of: ${VALID.join(", ")}.`);
    e.status = 400;
    throw e;
  }

  const [r] = await pool.query(
    `UPDATE applications
     SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW()
     WHERE id = ?`,
    [status, notes || null, req.user.sub, id]
  );

  if (!r.affectedRows) {
    const e = new Error("No application with that id.");
    e.status = 404;
    throw e;
  }

  res.json({ ok: true, id: Number(id), status });
});
