import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";
import {
  hashPassword, verifyPassword, issueToken, consumeToken, signJwt,
} from "../services/auth.service.js";

const MIN_PASSWORD = 8;

/* ============================================================
   POST /api/auth/set-password
   ============================================================ */
export const setPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token) { const e = new Error("Missing token."); e.status = 400; throw e; }
  if (!password || password.length < MIN_PASSWORD) {
    const e = new Error(`Your password must be at least ${MIN_PASSWORD} characters.`);
    e.status = 400; throw e;
  }
  const row = await consumeToken(token, "set_password");
  if (!row) {
    const e = new Error("That link is invalid, already used, or expired. Request a new one.");
    e.status = 400; throw e;
  }
  const hash = await hashPassword(password);
  await pool.query(
    `UPDATE users SET password_hash = ?, email_verified_at = NOW() WHERE id = ?`,
    [hash, row.user_id]);
  const [users] = await pool.query(
    `SELECT id, username, full_name, email, role FROM users WHERE id = ?`, [row.user_id]);
  const user = users[0];
  res.json({
    ok: true, token: signJwt(user),
    user: { id: user.id, username: user.username, fullName: user.full_name,
            email: user.email, role: user.role },
  });
});

/* ============================================================
   POST /api/auth/login   (identifier = username | email | phone)
   ============================================================ */
export const login = asyncHandler(async (req, res) => {
  const identifier = (req.body.identifier || "").trim();
  const { password } = req.body;
  if (!identifier || !password) {
    const e = new Error("Enter your username, email, or phone — and a password.");
    e.status = 400; throw e;
  }
  const [rows] = await pool.query(
    `SELECT id, username, full_name, email, phone, role, password_hash, is_active
     FROM users WHERE username = ? OR email = ? OR phone = ? LIMIT 1`,
    [identifier, identifier.toLowerCase(), identifier]);
  const FAIL = () => { const e = new Error("Those details don't match an account."); e.status = 401; return e; };
  if (!rows.length) throw FAIL();
  const user = rows[0];
  if (!user.is_active) { const e = new Error("That account is disabled. Contact us."); e.status = 403; throw e; }
  if (!user.password_hash) {
    const e = new Error("You haven't set a password yet. Check your email for the link we sent.");
    e.status = 403; throw e;
  }
  if (!(await verifyPassword(password, user.password_hash))) throw FAIL();
  await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);
  res.json({
    ok: true, token: signJwt(user),
    user: { id: user.id, username: user.username, fullName: user.full_name,
            email: user.email, role: user.role },
  });
});

/* ============================================================
   POST /api/auth/forgot-password  +  reset-password
   ============================================================ */
export const forgotPassword = asyncHandler(async (req, res) => {
  const identifier = (req.body.identifier || "").trim();
  const ANSWER = { ok: true, message: "If that matches an account, we've sent a reset link." };
  if (!identifier) return res.json(ANSWER);
  const [rows] = await pool.query(
    `SELECT id, full_name, email FROM users
     WHERE (username = ? OR email = ? OR phone = ?) AND is_active = TRUE LIMIT 1`,
    [identifier, identifier.toLowerCase(), identifier]);
  if (rows.length) {
    try { await issueToken(rows[0].id, "reset_password"); }
    catch (e) { console.error("reset token failed", e.message); }
  }
  res.json(ANSWER);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!password || password.length < MIN_PASSWORD) {
    const e = new Error(`Your password must be at least ${MIN_PASSWORD} characters.`);
    e.status = 400; throw e;
  }
  const row = await consumeToken(token, "reset_password");
  if (!row) { const e = new Error("That link is invalid, used, or expired."); e.status = 400; throw e; }
  const hash = await hashPassword(password);
  await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, row.user_id]);
  res.json({ ok: true, message: "Password updated. You can sign in now." });
});

/* ============================================================
   Application row → dashboard shape (with cert serial)
   ============================================================ */
const OTHER_TRACKS = {
  INTERNSHIP: { name: "Internship — Huye", mode: "In person — Huye" },
  TEAMS: { name: "Team training", mode: "On site or online" },
  BUILD: { name: "Software project", mode: "—" },
};
const MODE_LABEL = { online: "Online", hybrid: "Hybrid — Huye",
  in_person: "In person — Huye", on_site_or_online: "On site or online" };
const LEVEL_LABEL = { beginner: "Beginner", intermediate: "Intermediate",
  advanced: "Advanced", scoped: "Scoped" };

function toApp(r) {
  const other = OTHER_TRACKS[r.track];
  const price = r.price_rwf == null ? null
    : Number(r.price_rwf) === 0 ? "Quoted"
    : `RWF ${Number(r.price_rwf).toLocaleString("en-US")}`;
  return {
    id: r.id, track: r.track,
    name: r.program_name || (other && other.name) || r.track,
    level: LEVEL_LABEL[r.level] || null,
    mode: MODE_LABEL[r.mode] || (other && other.mode) || null,
    weeks: r.weeks, price, status: r.status,
    location: r.location || null,
    school: r.school, department: r.department, regNo: r.reg_no,
    internshipStart: r.internship_start, internshipEnd: r.internship_end,
    certSerial: r.cert_serial || null,
    createdAt: r.created_at, reviewedAt: r.reviewed_at,
  };
}

/* ============================================================
   GET /api/auth/me   — ROLE-AWARE
   Everyone gets user + their applications.
   Interns also get their internship + attendance summary.
   ============================================================ */
export const me = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, full_name, email, phone, role, stage,
            photo_path, created_at, last_login_at
     FROM users WHERE id = ? LIMIT 1`, [req.user.sub]);
  if (!rows.length) { const e = new Error("Account not found."); e.status = 404; throw e; }
  const u = rows[0];

  const [apps] = await pool.query(
    `SELECT a.id, a.track, a.status, a.created_at, a.reviewed_at,
            a.school, a.department, a.reg_no,
            a.internship_start, a.internship_end,
            CONCAT_WS(' / ', NULLIF(a.province,''), NULLIF(a.district,''),
                     NULLIF(a.sector,''), NULLIF(a.cell,''), NULLIF(a.village,'')) AS location,
            p.name AS program_name, p.level, p.mode, p.weeks, p.price_rwf,
            c.serial AS cert_serial
     FROM applications a
     LEFT JOIN programs p ON p.code = a.track
     LEFT JOIN certificates c ON c.application_id = a.id AND c.status = 'valid'
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC`, [u.id]);

  const payload = {
    user: {
      id: u.id, username: u.username, fullName: u.full_name, email: u.email,
      phone: u.phone, role: u.role, stage: u.stage, photo: u.photo_path,
      createdAt: u.created_at, lastLoginAt: u.last_login_at,
    },
    applications: apps.map(toApp),
  };

  /* Interns: attach their internship + attendance snapshot */
  if (u.role === "intern") {
    const [ints] = await pool.query(
      `SELECT i.id, i.status, i.starts_on, i.ends_on, i.fee_paid,
              m.full_name AS mentor_name,
              (SELECT COUNT(*) FROM attendance a WHERE a.internship_id = i.id AND a.status='present') AS present,
              (SELECT COUNT(*) FROM attendance a WHERE a.internship_id = i.id) AS total
       FROM internships i
       LEFT JOIN users m ON m.id = i.mentor_id
       WHERE i.user_id = ? ORDER BY i.starts_on DESC LIMIT 1`, [u.id]);
    payload.internship = ints[0] || null;
  }

  res.json(payload);
});

/* ============================================================
   GET /api/auth/prefill
   ============================================================ */
export const prefill = asyncHandler(async (req, res) => {
  const [users] = await pool.query(
    `SELECT id, full_name, email, phone, national_id, stage FROM users WHERE id = ? LIMIT 1`,
    [req.user.sub]);
  if (!users.length) { const e = new Error("Account not found."); e.status = 404; throw e; }
  const u = users[0];
  const [apps] = await pool.query(
    `SELECT stage, province, district, sector, cell, village, address,
            school, department, reg_no, supervisor_name, supervisor_email
     FROM applications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, [u.id]);
  const a = apps[0] || {};
  const STAGE = { secondary: "Secondary / high school student", university: "University student",
    graduate: "Recent graduate", professional: "Working professional", organisation: "Organisation / employer" };
  res.json({
    prefill: {
      name: u.full_name || "", email: u.email || "", phone: u.phone || "",
      nationalId: u.national_id || "", stage: a.stage || STAGE[u.stage] || "",
      province: a.province || "", district: a.district || "", sector: a.sector || "",
      cell: a.cell || "", village: a.village || "", address: a.address || "",
      school: a.school || "", department: a.department || "", regNo: a.reg_no || "",
      supervisorName: a.supervisor_name || "", supervisorEmail: a.supervisor_email || "",
    },
    hasPrevious: apps.length > 0,
  });
});
