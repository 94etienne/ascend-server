/* ============================================================
   ADMIN — content management
   Create programs, projects, and users. Admin-only (the router
   already gates every route with requireRole("admin")).

   Users are NEVER given a manual password. On creation we issue
   a one-time set-password token and email them a link, exactly
   like the public application flow does.
   ============================================================ */
import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";
import { issueToken, generateUsername } from "../services/auth.service.js";
import { sendWelcomeEmail } from "../services/mailer.js";

const CLIENT = process.env.CLIENT_ORIGIN || "http://localhost:5173";

/* ---------------- PROGRAMS ---------------- */

const LEVELS = ["beginner", "intermediate", "advanced", "scoped"];
const MODES = ["online", "hybrid", "in_person", "on_site_or_online"];
const AUDIENCES = ["secondary", "students", "graduates", "professionals", "organisations"];

export const createProgram = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || "").trim().toUpperCase();
  const name = String(b.name || "").trim();
  let slug = String(b.slug || "").trim().toLowerCase();

  if (!code) return bad(res, "A program code is required (e.g. CS-101).");
  if (!name) return bad(res, "A program name is required.");

  const level = String(b.level || "").toLowerCase();
  const mode = String(b.mode || "").toLowerCase();
  if (!LEVELS.includes(level)) return bad(res, "Pick a valid level.");
  if (!MODES.includes(mode)) return bad(res, "Pick a valid mode.");

  /* audience: array or comma string → validated, lowercase, no spaces */
  let audienceList = Array.isArray(b.audience)
    ? b.audience
    : String(b.audience || "").split(",");
  audienceList = audienceList.map((a) => String(a).trim().toLowerCase()).filter(Boolean);
  for (const a of audienceList) {
    if (!AUDIENCES.includes(a)) return bad(res, `Unknown audience "${a}".`);
  }
  const audience = audienceList.join(",");

  /* auto-slug from name if not given */
  if (!slug) {
    slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 180);
  }

  const weeks = b.weeks === "" || b.weeks == null ? null : Number(b.weeks);
  const seats = b.seats === "" || b.seats == null ? null : Number(b.seats);
  const priceRwf = Number(b.priceRwf || b.price_rwf || 0);
  const isActive = b.isOpen === false ? 0 : 1; // open by default
  const applyDeadline = b.applyDeadline || null; // YYYY-MM-DD or null

  try {
    const [r] = await pool.query(
      `INSERT INTO programs
        (code, name, slug, description, level, mode, audience, weeks, seats, price_rwf, is_active, apply_deadline)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, name, slug, b.description || null, level, mode, audience,
       Number.isFinite(weeks) ? weeks : null,
       Number.isFinite(seats) ? seats : null,
       Number.isFinite(priceRwf) ? priceRwf : 0, isActive, applyDeadline]
    );
    res.status(201).json({ ok: true, id: r.insertId, code });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return bad(res, "A program with that code or slug already exists.", 409);
    }
    throw e;
  }
});

export const updateProgram = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const code = req.params.code.toUpperCase();

  /* Build a partial update from whatever fields were sent. */
  const fields = [];
  const args = [];
  const set = (col, val) => { fields.push(`${col} = ?`); args.push(val); };

  if (b.name != null) set("name", String(b.name).trim());
  if (b.description != null) set("description", b.description);
  if (b.level != null) {
    const lv = String(b.level).toLowerCase();
    if (!LEVELS.includes(lv)) return bad(res, "Pick a valid level.");
    set("level", lv);
  }
  if (b.mode != null) {
    const md = String(b.mode).toLowerCase();
    if (!MODES.includes(md)) return bad(res, "Pick a valid mode.");
    set("mode", md);
  }
  if (b.audience != null) {
    let list = Array.isArray(b.audience) ? b.audience : String(b.audience).split(",");
    list = list.map((a) => String(a).trim().toLowerCase()).filter(Boolean);
    for (const a of list) if (!AUDIENCES.includes(a)) return bad(res, `Unknown audience "${a}".`);
    set("audience", list.join(","));
  }
  if (b.weeks !== undefined) set("weeks", b.weeks === "" || b.weeks == null ? null : Number(b.weeks));
  if (b.seats !== undefined) set("seats", b.seats === "" || b.seats == null ? null : Number(b.seats));
  if (b.priceRwf !== undefined) set("price_rwf", Number(b.priceRwf) || 0);
  if (b.applyDeadline !== undefined) set("apply_deadline", b.applyDeadline || null);

  if (!fields.length) return bad(res, "Nothing to update.");
  args.push(code);

  const [r] = await pool.query(`UPDATE programs SET ${fields.join(", ")} WHERE code = ?`, args);
  if (!r.affectedRows) return bad(res, `No program with code "${code}".`, 404);
  res.json({ ok: true, code });
});

/* ---------------- PROJECTS ---------------- */

export const listProjectsAdmin = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT id, client, title, tag, result, year, sort_order, is_public
       FROM projects ORDER BY sort_order ASC, year DESC`
  );
  res.json({ count: rows.length, projects: rows });
});

export const createProject = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim();
  if (!title) return bad(res, "A project title is required.");

  const [r] = await pool.query(
    `INSERT INTO projects (client, title, tag, result, year, sort_order, is_public)
     VALUES (?,?,?,?,?,?,?)`,
    [b.client || null, title, b.tag || null, b.result || null,
     b.year ? Number(b.year) : null,
     b.sortOrder ? Number(b.sortOrder) : 0,
     b.isPublic === false ? 0 : 1]
  );
  res.status(201).json({ ok: true, id: r.insertId });
});

export const updateProject = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const id = Number(req.params.id);
  const fields = [];
  const args = [];
  const set = (c, v) => { fields.push(`${c} = ?`); args.push(v); };

  if (b.client !== undefined) set("client", b.client || null);
  if (b.title != null) set("title", String(b.title).trim());
  if (b.tag !== undefined) set("tag", b.tag || null);
  if (b.result !== undefined) set("result", b.result || null);
  if (b.year !== undefined) set("year", b.year ? Number(b.year) : null);
  if (b.sortOrder !== undefined) set("sort_order", Number(b.sortOrder) || 0);
  if (b.isPublic !== undefined) set("is_public", b.isPublic ? 1 : 0);

  if (!fields.length) return bad(res, "Nothing to update.");
  args.push(id);
  const [r] = await pool.query(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`, args);
  if (!r.affectedRows) return bad(res, "Project not found.", 404);
  res.json({ ok: true, id });
});

export const deleteProject = asyncHandler(async (req, res) => {
  const [r] = await pool.query(`DELETE FROM projects WHERE id = ?`, [Number(req.params.id)]);
  if (!r.affectedRows) return bad(res, "Project not found.", 404);
  res.json({ ok: true });
});

/* ---------------- USERS ---------------- */

const ROLES = ["student", "intern", "instructor", "admin"];

export const createUser = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const fullName = String(b.fullName || b.full_name || "").trim();
  const email = String(b.email || "").trim().toLowerCase();
  const role = String(b.role || "student").toLowerCase();
  const phone = b.phone ? String(b.phone).trim() : null;

  if (!fullName) return bad(res, "Full name is required.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, "A valid email is required.");
  if (!ROLES.includes(role)) return bad(res, "Pick a valid role.");

  /* username: use provided, else auto-generate */
  const username = b.username
    ? String(b.username).trim().toLowerCase()
    : await generateUsername(fullName);

  let userId;
  try {
    const [r] = await pool.query(
      `INSERT INTO users (full_name, username, email, phone, role, is_active)
       VALUES (?,?,?,?,?, TRUE)`,
      [fullName, username, email, phone, role]
    );
    userId = r.insertId;
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return bad(res, "A user with that email, username, or phone already exists.", 409);
    }
    throw e;
  }

  /* Issue a one-time set-password token and email the invite.
     No password is ever set here. */
  let emailed = false;
  try {
    const { raw, expiresHours } = await issueToken(userId, "set_password");
    await sendWelcomeEmail({
      to: email,
      fullName,
      username,
      phone: phone || "—",
      trackLabel: `${role} account`,
      setPasswordUrl: `${CLIENT}/set-password?token=${raw}`,
      expiresHours,
    });
    emailed = true;
  } catch (e) {
    console.error("✗ Invite email failed:", e.message);
    /* The account still exists; admin can resend later. */
  }

  res.status(201).json({ ok: true, id: userId, username, email, emailed });
});

/* Resend the set-password invite for a user who hasn't set one. */
export const resendInvite = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query(
    `SELECT id, full_name, username, email, phone, role, password_hash
       FROM users WHERE id = ? LIMIT 1`, [id]
  );
  if (!rows.length) return bad(res, "User not found.", 404);
  const u = rows[0];

  const { raw, expiresHours } = await issueToken(u.id, "set_password");
  await sendWelcomeEmail({
    to: u.email,
    fullName: u.full_name,
    username: u.username,
    phone: u.phone || "—",
    trackLabel: `${u.role} account`,
    setPasswordUrl: `${CLIENT}/set-password?token=${raw}`,
    expiresHours,
  });
  res.json({ ok: true, emailed: true });
});

/* ---------------- helper ---------------- */
function bad(res, message, status = 400) {
  return res.status(status).json({ error: message });
}
