import { Router } from "express";
import {
  overview,
  listInstructors,
  listUsers,
  setUserRole,
} from "../controllers/admin.controller.js";
import {
  createProgram,
  updateProgram,
  listProjectsAdmin,
  createProject,
  updateProject,
  deleteProject,
  createUser,
  resendInvite,
} from "../controllers/admin_crud.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* everything here is admin only */
router.use(requireAuth, requireRole("admin"));

router.get("/overview", overview);
router.get("/instructors", listInstructors);

/* users */
router.get("/users", listUsers);
router.post("/users", createUser);
router.patch("/users/:id/role", setUserRole);
router.post("/users/:id/resend-invite", resendInvite);

/* programs (training + internship programs) */
router.post("/programs", createProgram);
router.patch("/programs/:code", updateProgram);

/* projects */
router.get("/projects", listProjectsAdmin);
router.post("/projects", createProject);
router.patch("/projects/:id", updateProject);
router.delete("/projects/:id", deleteProject);

export default router;
