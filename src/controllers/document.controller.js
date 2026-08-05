import fs from "node:fs";
import path from "node:path";
import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";

/* ============================================================
   Serves an application's uploaded documents through an ACCESS
   CHECK — never as static files.

     - admin               → may open ANY application's documents
                             (this is the verification job)
     - the applicant       → may open only their OWN documents
     - everyone else       → 403

   Documents are private (payment receipts, recommendation
   letters). They are NEVER served without auth, and never to a
   user who isn't an admin or the owner.
   ============================================================ */

const KINDS = {
  photo: "photo_path",
  recommendation: "recommendation_path",
  receipt: "receipt_path",
};

const STAFF = new Set(["admin"]);

/* GET /api/documents/:applicationId/:kind
   kind ∈ photo | recommendation | receipt                     */
export const getDocument = asyncHandler(async (req, res) => {
  const { applicationId, kind } = req.params;
  const column = KINDS[kind];

  if (!column) {
    const e = new Error("Unknown document type.");
    e.status = 400;
    throw e;
  }

  const [rows] = await pool.query(
    `SELECT user_id, ${column} AS file_path FROM applications WHERE id = ? LIMIT 1`,
    [applicationId]
  );
  if (!rows.length) {
    const e = new Error("Application not found.");
    e.status = 404;
    throw e;
  }

  const app = rows[0];

  /* ---- access check ---- */
  const isStaff = STAFF.has(req.user.role);
  const isOwner = app.user_id && Number(app.user_id) === Number(req.user.sub);
  if (!isStaff && !isOwner) {
    const e = new Error("You don't have permission to view this document.");
    e.status = 403;
    throw e;
  }

  if (!app.file_path) {
    const e = new Error("No such document was uploaded.");
    e.status = 404;
    throw e;
  }

  /* ---- resolve & guard the path ----
     Confirm the stored path really sits inside our uploads
     folder before streaming it — defence in depth against a
     bad row pointing somewhere it shouldn't. */
  const abs = path.resolve(app.file_path);
  const root = path.resolve("uploads");
  if (!abs.startsWith(root + path.sep)) {
    const e = new Error("Document path is invalid.");
    e.status = 400;
    throw e;
  }
  if (!fs.existsSync(abs)) {
    const e = new Error("The file is missing from storage.");
    e.status = 404;
    throw e;
  }

  /* inline so the browser previews PDFs/images rather than
     forcing a download */
  const ext = path.extname(abs).toLowerCase();
  const type =
    ext === ".pdf" ? "application/pdf"
    : ext === ".png" ? "image/png"
    : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : "application/octet-stream";

  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `inline; filename="${kind}${ext}"`);
  fs.createReadStream(abs).pipe(res);
});

/* ============================================================
   VERIFICATION — admin only.
   PATCH /api/documents/:applicationId/verify
   Body: { status: 'verified' | 'rejected', note?: string }
   ============================================================ */
export const verifyDocuments = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { status, note, rejected } = req.body;

  if (!["verified", "rejected"].includes(status)) {
    const e = new Error("Status must be 'verified' or 'rejected'.");
    e.status = 400;
    throw e;
  }

  /* `rejected` is an array naming which documents are wrong, e.g.
     ["recommendation","receipt"]. Only meaningful when rejecting.
     On verify, all per-document flags are cleared back to 'ok'. */
  const DOCS = ["photo", "recommendation", "receipt"];
  const rejectedSet = new Set(
    Array.isArray(rejected) ? rejected.filter((d) => DOCS.includes(d)) : []
  );

  if (status === "rejected" && rejectedSet.size === 0) {
    const e = new Error("Tick at least one document to reject.");
    e.status = 400;
    throw e;
  }

  /* Per-document flags: 'rejected' for the ones ticked (only when
     rejecting), 'ok' for everything else. */
  const photoFlag = status === "rejected" && rejectedSet.has("photo") ? "rejected" : "ok";
  const recFlag = status === "rejected" && rejectedSet.has("recommendation") ? "rejected" : "ok";
  const rcptFlag = status === "rejected" && rejectedSet.has("receipt") ? "rejected" : "ok";

  const [result] = await pool.query(
    `UPDATE applications
        SET verification_status = ?,
            verify_note = ?,
            verified_by = ?,
            verified_at = NOW(),
            photo_status = ?,
            recommendation_status = ?,
            receipt_status = ?
      WHERE id = ?`,
    [status, note || null, req.user.sub, photoFlag, recFlag, rcptFlag, applicationId]
  );

  if (!result.affectedRows) {
    const e = new Error("Application not found.");
    e.status = 404;
    throw e;
  }

  res.json({ ok: true, applicationId: Number(applicationId), status });
});

/* ============================================================
   RESUBMIT — the applicant replaces the rejected documents on
   their OWN application, then it goes back to pending.

   POST /api/documents/:applicationId/resubmit   (multipart)
   Files: any of photo | recommendation | receipt
   Only files whose flag is 'rejected' are accepted; uploading a
   file for an 'ok' document is ignored (nothing to fix there).
   ============================================================ */
export const resubmitDocuments = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const files = req.files || {};

  /* Load the application and confirm ownership + that it was
     actually rejected. */
  const [rows] = await pool.query(
    `SELECT user_id, verification_status,
            photo_status, recommendation_status, receipt_status,
            photo_path, recommendation_path, receipt_path
       FROM applications WHERE id = ? LIMIT 1`,
    [applicationId]
  );
  if (!rows.length) {
    const e = new Error("Application not found.");
    e.status = 404;
    throw e;
  }
  const app = rows[0];

  const isOwner = app.user_id && Number(app.user_id) === Number(req.user.sub);
  if (!isOwner) {
    const e = new Error("You can only resubmit your own application.");
    e.status = 403;
    throw e;
  }
  if (app.verification_status !== "rejected") {
    const e = new Error("This application isn't awaiting a resubmission.");
    e.status = 409;
    throw e;
  }

  /* For each document flagged 'rejected', require a new file and
     swap it in. Delete the old file from disk. */
  const map = [
    { key: "photo", col: "photo_path", flag: app.photo_status, statusCol: "photo_status" },
    { key: "recommendation", col: "recommendation_path", flag: app.recommendation_status, statusCol: "recommendation_status" },
    { key: "receipt", col: "receipt_path", flag: app.receipt_status, statusCol: "receipt_status" },
  ];

  const rejectedDocs = map.filter((m) => m.flag === "rejected");
  const sets = [];
  const args = [];

  for (const m of rejectedDocs) {
    const uploaded = files[m.key]?.[0];
    if (!uploaded) {
      const e = new Error(`Please attach a new ${m.key === "recommendation" ? "recommendation letter" : m.key}.`);
      e.status = 400;
      /* clean up any files that DID arrive before we bail */
      for (const mm of map) {
        const f = files[mm.key]?.[0];
        if (f?.path) fs.unlink(f.path, () => {});
      }
      throw e;
    }
    /* delete the old file */
    if (app[m.col]) fs.unlink(path.resolve(app[m.col]), () => {});
    sets.push(`${m.col} = ?`, `${m.statusCol} = 'ok'`);
    args.push(uploaded.path);
  }

  /* Ignore uploads for documents that weren't rejected — nothing
     to fix there, and we don't let them silently overwrite a good
     file. Clean those stray uploads up. */
  for (const m of map) {
    if (m.flag !== "rejected") {
      const stray = files[m.key]?.[0];
      if (stray?.path) fs.unlink(stray.path, () => {});
    }
  }

  /* Back to pending, note cleared. */
  sets.push("verification_status = 'pending'", "verify_note = NULL", "verified_by = NULL", "verified_at = NULL");

  args.push(applicationId);
  await pool.query(
    `UPDATE applications SET ${sets.join(", ")} WHERE id = ?`,
    args
  );

  res.json({ ok: true, applicationId: Number(applicationId), status: "pending" });
});

/* ============================================================
   LIST for verification — admin only.
   GET /api/documents?status=pending
   Returns applications with their document presence + status,
   so staff have a verification queue.
   ============================================================ */
export const listForVerification = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const args = [];
  let where = "1 = 1";
  if (status && ["pending", "verified", "rejected"].includes(status)) {
    where = "a.verification_status = ?";
    args.push(status);
  }

  const [rows] = await pool.query(
    `SELECT a.id, a.full_name, a.email, a.track, a.status,
            a.verification_status, a.verify_note, a.verified_at,
            (a.recommendation_path IS NOT NULL) AS has_recommendation,
            (a.receipt_path IS NOT NULL)        AS has_receipt,
            (a.photo_path IS NOT NULL)          AS has_photo,
            v.full_name AS verified_by_name,
            a.created_at
       FROM applications a
       LEFT JOIN users v ON v.id = a.verified_by
      WHERE ${where}
      ORDER BY a.created_at DESC
      LIMIT 300`,
    args
  );

  res.json({ count: rows.length, applications: rows });
});
