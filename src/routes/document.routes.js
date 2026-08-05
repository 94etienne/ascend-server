import { Router } from "express";
import {
  getDocument,
  verifyDocuments,
  listForVerification,
  resubmitDocuments,
} from "../controllers/document.controller.js";
import { handleApplicationUpload } from "../middleware/upload.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* Verification queue — staff only */
router.get("/", requireAuth, requireRole("admin"), listForVerification);

/* Mark verified / rejected — staff only */
router.patch(
  "/:applicationId/verify",
  requireAuth,
  requireRole("admin"),
  verifyDocuments
);

/* Open a document — auth required; the controller decides whether
   this user (staff, or the owner) may see it. */
/* Applicant resubmits corrected documents on their own application. */
router.post(
  "/:applicationId/resubmit",
  requireAuth,
  handleApplicationUpload,
  resubmitDocuments
);

router.get("/:applicationId/:kind", requireAuth, getDocument);

export default router;
