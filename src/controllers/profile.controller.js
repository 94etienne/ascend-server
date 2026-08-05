/* ============================================================
   PROFILE — the logged-in user updates their OWN photo and
   password. Every handler acts on req.user.sub (their own id),
   so one user can never change another's.
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";
import { hashPassword, verifyPassword } from "../services/auth.service.js";

const MIN_PASSWORD = 8;

/* PATCH /api/me/password
   Body: { currentPassword, newPassword }
   Requires the current password — so a stolen session can't
   silently lock the real owner out by changing it. */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!newPassword || String(newPassword).length < MIN_PASSWORD) {
    const e = new Error(`Your new password must be at least ${MIN_PASSWORD} characters.`);
    e.status = 400;
    throw e;
  }

  const [rows] = await pool.query(
    `SELECT password_hash FROM users WHERE id = ? LIMIT 1`,
    [req.user.sub]
  );
  if (!rows.length) {
    const e = new Error("User not found.");
    e.status = 404;
    throw e;
  }

  const hash = rows[0].password_hash;

  /* If they already have a password, the current one must match.
     (A user who set up via invite always has one by now.) */
  if (hash) {
    if (!currentPassword) {
      const e = new Error("Enter your current password.");
      e.status = 400;
      throw e;
    }
    const ok = await verifyPassword(currentPassword, hash);
    if (!ok) {
      const e = new Error("Your current password isn't right.");
      e.status = 400;
      throw e;
    }
  }

  const newHash = await hashPassword(newPassword);
  await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, req.user.sub]);

  res.json({ ok: true });
});

/* POST /api/me/photo   (multipart, field "photo")
   Replaces the user's profile image. */
export const updateAvatar = asyncHandler(async (req, res) => {
  const file = req.files?.photo?.[0];
  if (!file) {
    const e = new Error("Attach an image (JPG or PNG).");
    e.status = 400;
    throw e;
  }

  /* remove the old photo from disk, if any */
  const [rows] = await pool.query(
    `SELECT photo_path FROM users WHERE id = ? LIMIT 1`,
    [req.user.sub]
  );
  const old = rows[0]?.photo_path;

  await pool.query(`UPDATE users SET photo_path = ? WHERE id = ?`, [file.path, req.user.sub]);

  if (old && old !== file.path) {
    fs.unlink(path.resolve(old), () => {});
  }

  res.json({ ok: true, photo: file.path });
});
