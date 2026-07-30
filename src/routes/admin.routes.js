import { Router } from "express";
import {
  overview,
  listInstructors,
  listUsers,
  setUserRole,
} from "../controllers/admin.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* everything here is admin only */
router.use(requireAuth, requireRole("admin"));

router.get("/overview", overview);
router.get("/instructors", listInstructors);
router.get("/users", listUsers);
router.patch("/users/:id/role", setUserRole);

export default router;
