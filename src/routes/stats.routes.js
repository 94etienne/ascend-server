import { Router } from "express";
import { getPublicStats } from "../controllers/stats.controller.js";

const router = Router();

/* Public — no auth. Homepage headline numbers. */
router.get("/", getPublicStats);

export default router;
