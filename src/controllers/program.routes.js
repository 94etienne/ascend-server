import { Router } from "express";
import {
  listPrograms,
  getProgram,
  getProgramCohorts,
  setProgramOpen,
} from "../controllers/program.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", listPrograms);
router.get("/:code", getProgram);
router.get("/:code/cohorts", getProgramCohorts);

/* ADMIN — open / close a program for enrolment */
router.patch("/:code/open", requireAuth, requireRole("admin"), setProgramOpen);

export default router;
