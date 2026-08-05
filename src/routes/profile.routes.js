import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";
import { changePassword, updateAvatar } from "../controllers/profile.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { handleApplicationUpload } from "../middleware/upload.js";

const router = Router();

/* Change own password */
router.patch("/password", requireAuth, changePassword);

/* Update own profile photo (multipart, field "photo") */
router.post("/photo", requireAuth, handleApplicationUpload, updateAvatar);

/* Serve own profile photo — auth required; a user only ever
   fetches their own avatar via this route. */
router.get(
  "/photo",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT photo_path FROM users WHERE id = ? LIMIT 1`,
      [req.user.sub]
    );
    const p = rows[0]?.photo_path;
    if (!p) {
      const e = new Error("No profile photo set.");
      e.status = 404;
      throw e;
    }
    const abs = path.resolve(p);
    const root = path.resolve("uploads");
    if (!abs.startsWith(root + path.sep) || !fs.existsSync(abs)) {
      const e = new Error("Photo not found.");
      e.status = 404;
      throw e;
    }
    const ext = path.extname(abs).toLowerCase();
    const type = ext === ".png" ? "image/png" : "image/jpeg";
    res.setHeader("Content-Type", type);
    fs.createReadStream(abs).pipe(res);
  })
);

export default router;
