import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  setPassword,
  login,
  forgotPassword,
  resetPassword,
  me,
  prefill,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/* Brute-force guard: 10 attempts per 15 min per IP.
   Without this, someone can try passwords all day. */
const strict = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Wait 15 minutes and try again." },
});

router.post("/set-password", strict, setPassword);
router.post("/login", strict, login);
router.post("/forgot-password", strict, forgotPassword);
router.post("/reset-password", strict, resetPassword);
router.get("/me", requireAuth, me);
router.get("/prefill", requireAuth, prefill);

export default router;
