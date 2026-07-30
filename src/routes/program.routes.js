import { Router } from "express";
import {
  listPrograms,
  getProgram,
  getProgramCohorts,
} from "../controllers/program.controller.js";

const router = Router();

router.get("/", listPrograms);
router.get("/:code", getProgram);
router.get("/:code/cohorts", getProgramCohorts);

export default router;
