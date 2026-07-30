import { Router } from "express";
import {
  markAttendance,
  markBulk,
  getAttendance,
} from "../controllers/attendance.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* take attendance — instructor or admin */
router.post("/", requireAuth, requireRole("instructor", "admin"), markAttendance);
router.post("/bulk", requireAuth, requireRole("instructor", "admin"), markBulk);

/* view — owner check happens inside the controller */
router.get("/:internshipId", requireAuth, getAttendance);

export default router;
