import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";

/* ============================================================
   INTERNSHIPS
   Lifecycle: an accepted internship application becomes an
   internship record. An admin assigns an instructor (mentor).
   The instructor then takes daily attendance.
   ============================================================ */

/* ------------------------------------------------------------
   POST /api/internships/from-application/:applicationId   (admin)
   Turn an accepted application into an active internship.
   ------------------------------------------------------------ */
export const createFromApplication = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { mentorId, startsOn, endsOn, feeRwf } = req.body;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [apps] = await conn.query(
      `SELECT id, user_id, status, track, school, department, reg_no,
              supervisor_name, supervisor_email,
              internship_start, internship_end
       FROM applications WHERE id = ? FOR UPDATE`,
      [applicationId]
    );
    if (!apps.length) {
      const e = new Error("No application with that id."); e.status = 404; throw e;
    }
    const a = apps[0];
    if (!a.user_id) {
      const e = new Error("This application has no linked user."); e.status = 409; throw e;
    }

    /* mentor must be an instructor or admin, if provided */
    if (mentorId) {
      const [m] = await conn.query(
        `SELECT id FROM users WHERE id = ? AND role IN ('instructor','admin')`,
        [mentorId]
      );
      if (!m.length) {
        const e = new Error("That mentor isn't an instructor."); e.status = 400; throw e;
      }
    }

    const start = startsOn || a.internship_start;
    const end = endsOn || a.internship_end;
    if (!start || !end) {
      const e = new Error("Start and end dates are required."); e.status = 400; throw e;
    }

    /* upsert — one internship per application */
    const [existing] = await conn.query(
      `SELECT id FROM internships WHERE application_id = ? LIMIT 1`,
      [applicationId]
    );

    let internshipId;
    if (existing.length) {
      internshipId = existing[0].id;
      await conn.query(
        `UPDATE internships
         SET mentor_id = ?, starts_on = ?, ends_on = ?, fee_rwf = ?,
             status = 'active'
         WHERE id = ?`,
        [mentorId || null, start, end, feeRwf || 0, internshipId]
      );
    } else {
      const [ins] = await conn.query(
        `INSERT INTO internships
           (user_id, application_id, mentor_id, school, department, reg_no,
            supervisor_name, supervisor_email, starts_on, ends_on,
            fee_rwf, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?, 'active')`,
        [a.user_id, applicationId, mentorId || null, a.school, a.department,
         a.reg_no, a.supervisor_name, a.supervisor_email, start, end, feeRwf || 0]
      );
      internshipId = ins.insertId;
    }

    /* promote the user's role to intern if they were a student */
    await conn.query(
      `UPDATE users SET role = 'intern' WHERE id = ? AND role = 'student'`,
      [a.user_id]
    );

    await conn.commit();
    res.status(201).json({ ok: true, internshipId, status: "active" });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/* ------------------------------------------------------------
   GET /api/internships                (admin — all)
   GET /api/internships?mentor=me      (instructor — theirs)
   ------------------------------------------------------------ */
export const listInternships = asyncHandler(async (req, res) => {
  const isAdmin = req.user.role === "admin";
  const mentorMe = req.query.mentor === "me";

  let sql = `
    SELECT i.id, i.status, i.starts_on, i.ends_on, i.fee_rwf, i.fee_paid,
           u.id AS intern_id, u.full_name AS intern_name, u.username,
           u.email, u.phone,
           i.school, i.department, i.reg_no,
           m.full_name AS mentor_name, m.id AS mentor_id,
           (SELECT COUNT(*) FROM attendance a
              WHERE a.internship_id = i.id AND a.status = 'present') AS days_present,
           (SELECT COUNT(*) FROM attendance a
              WHERE a.internship_id = i.id) AS days_recorded,
           app.status AS application_status,
           app.track AS track,
           c.serial AS certificate_serial,
           c.status AS certificate_status
    FROM internships i
    JOIN users u ON u.id = i.user_id
    LEFT JOIN users m ON m.id = i.mentor_id
    LEFT JOIN applications app ON app.id = i.application_id
    LEFT JOIN certificates c ON c.application_id = i.application_id AND c.status = 'valid'
    WHERE 1 = 1
  `;
  const args = [];

  /* instructors only ever see their own assignments */
  if (!isAdmin || mentorMe) {
    sql += " AND i.mentor_id = ?";
    args.push(req.user.sub);
  }

  sql += " ORDER BY i.starts_on DESC";

  const [rows] = await pool.query(sql, args);
  res.json({ count: rows.length, internships: rows });
});

/* ------------------------------------------------------------
   GET /api/internships/:id            (admin, mentor, or owner)
   ------------------------------------------------------------ */
export const getInternship = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(
    `SELECT i.*, u.full_name AS intern_name, u.username, u.email, u.phone,
            m.full_name AS mentor_name
     FROM internships i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN users m ON m.id = i.mentor_id
     WHERE i.id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) {
    const e = new Error("No internship with that id."); e.status = 404; throw e;
  }
  const it = rows[0];

  const allowed =
    req.user.role === "admin" ||
    req.user.sub === it.mentor_id ||
    req.user.sub === it.user_id;
  if (!allowed) {
    const e = new Error("You can't view this internship."); e.status = 403; throw e;
  }

  const [att] = await pool.query(
    `SELECT on_date, status, notes FROM attendance
     WHERE internship_id = ? ORDER BY on_date DESC`,
    [id]
  );

  res.json({ internship: it, attendance: att });
});

/* ------------------------------------------------------------
   PATCH /api/internships/:id          (admin)
   Assign/reassign mentor, change status, mark fee paid.
   ------------------------------------------------------------ */
export const updateInternship = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { mentorId, status, feePaid } = req.body;

  const sets = [];
  const args = [];

  if (mentorId !== undefined) {
    if (mentorId) {
      const [m] = await pool.query(
        `SELECT id FROM users WHERE id = ? AND role IN ('instructor','admin')`,
        [mentorId]
      );
      if (!m.length) {
        const e = new Error("That mentor isn't an instructor."); e.status = 400; throw e;
      }
    }
    sets.push("mentor_id = ?"); args.push(mentorId || null);
  }
  if (status !== undefined) {
    const VALID = ["placed", "active", "completed", "terminated"];
    if (!VALID.includes(status)) {
      const e = new Error(`Status must be one of: ${VALID.join(", ")}.`); e.status = 400; throw e;
    }
    sets.push("status = ?"); args.push(status);
  }
  if (feePaid !== undefined) {
    sets.push("fee_paid = ?"); args.push(feePaid ? 1 : 0);
  }

  if (!sets.length) {
    const e = new Error("Nothing to update."); e.status = 400; throw e;
  }

  args.push(id);
  const [r] = await pool.query(
    `UPDATE internships SET ${sets.join(", ")} WHERE id = ?`, args
  );
  if (!r.affectedRows) {
    const e = new Error("No internship with that id."); e.status = 404; throw e;
  }
  res.json({ ok: true, id: Number(id) });
});
