import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";

const BCRYPT_ROUNDS = 12;
const TOKEN_TTL_HOURS = Number(process.env.TOKEN_TTL_HOURS) || 48;
const JWT_TTL = process.env.JWT_TTL || "7d";

/* ============================================================
   PASSWORDS
   ============================================================ */
export const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/* ============================================================
   ONE-TIME TOKENS

   We generate a long random token, email the RAW value in the
   link, and store only its SHA-256 hash. If the DB leaks, the
   hashes can't be turned back into working links.

   This is the same reason we hash passwords — and the same
   reason we never email one.
   ============================================================ */
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

export async function issueToken(userId, purpose = "set_password") {
  /* Invalidate any outstanding token of the same purpose, so an
     old email can't be replayed after a new one is requested. */
  await pool.query(
    `UPDATE auth_tokens
     SET used_at = NOW()
     WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
    [userId, purpose]
  );

  const raw = crypto.randomBytes(32).toString("hex"); // 64 chars
  const hash = sha256(raw);

  await pool.query(
    `INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [userId, hash, purpose, TOKEN_TTL_HOURS]
  );

  return { raw, expiresHours: TOKEN_TTL_HOURS };
}

/* Returns the user row if the token is valid, else null. */
export async function consumeToken(raw, purpose = "set_password") {
  const hash = sha256(raw);

  const [rows] = await pool.query(
    `SELECT t.id AS token_id, u.id AS user_id, u.email, u.full_name, u.username
     FROM auth_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ?
       AND t.purpose    = ?
       AND t.used_at IS NULL
       AND t.expires_at > NOW()
     LIMIT 1`,
    [hash, purpose]
  );

  if (!rows.length) return null;

  /* Mark used immediately — a token works exactly once. */
  await pool.query(`UPDATE auth_tokens SET used_at = NOW() WHERE id = ?`, [
    rows[0].token_id,
  ]);

  return rows[0];
}

/* ============================================================
   USERNAME
   "NTAMBARA Etienne" → "netienne", "netienne2", "netienne3"…
   ============================================================ */
export async function generateUsername(fullName) {
  const parts = String(fullName)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  let base;
  if (parts.length >= 2) {
    base = parts[0][0] + parts[parts.length - 1]; // first initial + surname
  } else {
    base = parts[0] || "user";
  }
  base = base.slice(0, 30);

  /* Walk forward until we find one that isn't taken. */
  for (let n = 0; n < 200; n++) {
    const candidate = n === 0 ? base : `${base}${n + 1}`;
    const [rows] = await pool.query(
      `SELECT id FROM users WHERE username = ? LIMIT 1`,
      [candidate]
    );
    if (!rows.length) return candidate;
  }

  /* Pathological fallback */
  return `${base}${crypto.randomBytes(3).toString("hex")}`;
}

/* ============================================================
   JWT
   ============================================================ */
export function signJwt(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL }
  );
}

export function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/* ============================================================
   STAGE MAPPING
   The form sends display strings; users.stage is an ENUM.
   ============================================================ */
export function mapStage(formStage = "") {
  const s = formStage.toLowerCase();
  if (s.includes("secondary") || s.includes("high school")) return "secondary";
  if (s.includes("university")) return "university";
  if (s.includes("graduate")) return "graduate";
  if (s.includes("professional")) return "professional";
  if (s.includes("organisation") || s.includes("employer")) return "organisation";
  return null;
}
