import { Router } from "express";
import {
  issueCertificate,
  downloadCertificate,
  verifyCertificate,
  revokeCertificate,
} from "../controllers/certificate.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

/* PUBLIC — an employer checking a serial. No auth. */
router.get("/verify/:serial", verifyCertificate);

/* OWNER or ADMIN — download the PDF */
router.get("/:serial/download", requireAuth, downloadCertificate);

/* ADMIN — issue / revoke */
router.post("/issue/:applicationId", requireAuth, requireRole("admin"), issueCertificate);
router.post("/:serial/revoke", requireAuth, requireRole("admin"), revokeCertificate);

export default router;
