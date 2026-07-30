import { Router } from "express";
import {
  createFromApplication,
  listInternships,
  getInternship,
  updateInternship,
} from "../controllers/internship.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* instructors see their own; admins see all */
router.get("/", requireAuth, requireRole("instructor", "admin"), listInternships);
router.get("/:id", requireAuth, getInternship); // owner check inside

/* admin only */
router.post(
  "/from-application/:applicationId",
  requireAuth,
  requireRole("admin"),
  createFromApplication
);
router.patch("/:id", requireAuth, requireRole("admin"), updateInternship);

export default router;
