import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";
import { renderCertificate } from "../services/certificate.service.js";

const CLIENT = process.env.CLIENT_ORIGIN || "http://localhost:5173";

/* Build the public verify URL for a serial */
const verifyUrl = (serial) => `${CLIENT}/verify/${serial}`;

/* ============================================================
   Reserve the next serial for this year, atomically.
   INSERT ... ON DUPLICATE KEY UPDATE with LAST_INSERT_ID keeps
   the read-modify-write inside one statement, so two admins
   issuing at once can't collide on the same number.
   ============================================================ */
async function nextSerial(conn) {
  const year = new Date().getFullYear();
  await conn.query(
    `INSERT INTO cert_counter (year, n) VALUES (?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE n = LAST_INSERT_ID(n + 1)`,
    [year]
  );
  const [[{ n }]] = await conn.query(`SELECT LAST_INSERT_ID() AS n`);
  return `ASC-${year}-${String(n).padStart(5, "0")}`;
}

/* ============================================================
   POST /api/certificates/issue/:applicationId     (admin)

   Issues (or re-issues) the certificate for one application.
   Guard: the application MUST be status='completed'. That is
   the single gate — no completed status, no certificate.
   ============================================================ */
export const issueCertificate = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { hours } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    /* Lock the application row while we read it, so its status
       can't change under us mid-issue. */
    const [apps] = await conn.query(
      `SELECT a.id, a.user_id, a.status, a.track, a.full_name,
              a.internship_start, a.internship_end,
              COALESCE(p.name, a.track) AS program_name
       FROM applications a
       LEFT JOIN programs p ON p.code = a.track
       WHERE a.id = ?
       FOR UPDATE`,
      [applicationId]
    );

    if (!apps.length) {
      const e = new Error("No application with that id."); e.status = 404; throw e;
    }
    const app = apps[0];

    if (app.status !== "completed") {
      const e = new Error(
        `Can't issue a certificate — this application is "${app.status}", not "completed". Mark it completed first.`
      );
      e.status = 409;
      throw e;
    }
    if (!app.user_id) {
      const e = new Error("This application has no linked user account."); e.status = 409; throw e;
    }

    /* Already has one? Re-issue keeps the same serial. */
    const [existing] = await conn.query(
      `SELECT serial FROM certificates WHERE application_id = ? LIMIT 1`,
      [applicationId]
    );

    let serial;
    if (existing.length) {
      serial = existing[0].serial;
      await conn.query(
        `UPDATE certificates
         SET holder_name = ?, program_name = ?, track = ?,
             started_on = ?, ended_on = ?, hours = ?,
             status = 'valid', revoked_reason = NULL, revoked_at = NULL,
             issued_by = ?, issued_at = NOW()
         WHERE application_id = ?`,
        [app.full_name, app.program_name, app.track,
         app.internship_start, app.internship_end, hours || null,
         req.user.sub, applicationId]
      );
    } else {
      serial = await nextSerial(conn);
      await conn.query(
        `INSERT INTO certificates
           (serial, application_id, user_id, holder_name, track,
            program_name, started_on, ended_on, hours, issued_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [serial, applicationId, app.user_id, app.full_name, app.track,
         app.program_name, app.internship_start, app.internship_end,
         hours || null, req.user.sub]
      );
    }

    await conn.commit();
    res.status(201).json({
      ok: true,
      serial,
      reissued: existing.length > 0,
      verifyUrl: verifyUrl(serial),
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/* ============================================================
   GET /api/certificates/:serial/download        (owner/admin)
   Streams the PDF.
   ============================================================ */
export const downloadCertificate = asyncHandler(async (req, res) => {
  const { serial } = req.params;

  const [rows] = await pool.query(
    `SELECT * FROM certificates WHERE serial = ? LIMIT 1`,
    [serial]
  );
  if (!rows.length) {
    const e = new Error("No certificate with that serial."); e.status = 404; throw e;
  }
  const cert = rows[0];

  /* Holder, admin, or the mentor who supervised this intern may
     download. Instructors legitimately need their own interns'
     certificates. */
  const isOwner = req.user.sub === cert.user_id;
  const isAdmin = req.user.role === "admin";
  let isMentor = false;
  if (!isOwner && !isAdmin && req.user.role === "instructor") {
    const [m] = await pool.query(
      `SELECT 1 FROM internships
        WHERE user_id = ? AND mentor_id = ? LIMIT 1`,
      [cert.user_id, req.user.sub]
    );
    isMentor = m.length > 0;
  }
  if (!isOwner && !isAdmin && !isMentor) {
    const e = new Error("This isn't your certificate."); e.status = 403; throw e;
  }

  if (cert.status === "revoked") {
    const e = new Error("This certificate has been revoked and can't be downloaded.");
    e.status = 410;
    throw e;
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="AscendAI-${serial}.pdf"`
  );

  await renderCertificate(cert, verifyUrl(serial), res);
});

/* ============================================================
   GET /api/certificates/verify/:serial            (PUBLIC)

   No auth. Returns only what an employer needs to trust the
   document — name, programme, dates, status. Never phone,
   email, school, or anything else on the application.
   ============================================================ */
export const verifyCertificate = asyncHandler(async (req, res) => {
  const { serial } = req.params;

  const [rows] = await pool.query(
    `SELECT serial, holder_name, program_name, started_on, ended_on,
            hours, status, issued_at
     FROM certificates WHERE serial = ? LIMIT 1`,
    [serial]
  );

  if (!rows.length) {
    return res.status(404).json({
      valid: false,
      reason: "not_found",
      message: "No certificate carries that serial number.",
    });
  }

  const c = rows[0];
  if (c.status === "revoked") {
    return res.json({
      valid: false,
      reason: "revoked",
      message: "This certificate was issued but has since been revoked.",
      serial: c.serial,
    });
  }

  res.json({
    valid: true,
    serial: c.serial,
    holderName: c.holder_name,
    programName: c.program_name,
    startedOn: c.started_on,
    endedOn: c.ended_on,
    hours: c.hours,
    issuedAt: c.issued_at,
  });
});

/* ============================================================
   POST /api/certificates/:serial/revoke           (admin)
   ============================================================ */
export const revokeCertificate = asyncHandler(async (req, res) => {
  const { serial } = req.params;
  const { reason } = req.body;

  const [r] = await pool.query(
    `UPDATE certificates
     SET status = 'revoked', revoked_reason = ?, revoked_at = NOW()
     WHERE serial = ? AND status = 'valid'`,
    [reason || "Revoked by issuer", serial]
  );

  if (!r.affectedRows) {
    const e = new Error("No valid certificate with that serial to revoke.");
    e.status = 404;
    throw e;
  }
  res.json({ ok: true, serial, status: "revoked" });
});
