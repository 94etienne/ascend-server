import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  createApplication,
  listApplications,
  updateStatus,
} from "../controllers/application.controller.js";
import { handlePhotoUpload } from "../middleware/upload.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* 5 applications per hour per IP — generous for a real person,
   restrictive for a script filling your table with junk. */
const submitLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "You've submitted several applications. Try again in an hour.",
  },
});

/* PUBLIC — the Apply form */
router.post("/", submitLimit, handlePhotoUpload, createApplication);

/* ADMIN */
router.get("/", requireAuth, requireRole("admin"), listApplications);
router.patch("/:id/status", requireAuth, requireRole("admin"), updateStatus);

export default router;
