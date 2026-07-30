import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";

/* ============================================================
   ATTENDANCE
   - Instructors take attendance for interns assigned to them.
   - Admins can take it for anyone.
   - Interns/students can only VIEW their own.
   ============================================================ */

/* Confirm the caller may write attendance for this internship.
   Admin: always. Instructor: only if they're the mentor. */
async function canWrite(user, internshipId) {
  if (user.role === "admin") return true;
  if (user.role !== "instructor") return false;
  const [rows] = await pool.query(
    `SELECT id FROM internships WHERE id = ? AND mentor_id = ?`,
    [internshipId, user.sub]
  );
  return rows.length > 0;
}

/* ------------------------------------------------------------
   POST /api/attendance                (instructor / admin)
   Body: { internshipId, date, status, notes }
   Marks one day. Re-marking the same day updates it.
   ------------------------------------------------------------ */
export const markAttendance = asyncHandler(async (req, res) => {
  const { internshipId, date, status, notes } = req.body;

  if (!internshipId || !date || !status) {
    const e = new Error("internshipId, date, and status are required.");
    e.status = 400; throw e;
  }
  const VALID = ["present", "absent", "excused", "holiday"];
  if (!VALID.includes(status)) {
    const e = new Error(`Status must be one of: ${VALID.join(", ")}.`);
    e.status = 400; throw e;
  }
  if (!(await canWrite(req.user, internshipId))) {
    const e = new Error("You can't take attendance for this internship.");
    e.status = 403; throw e;
  }

  /* upsert — one row per (internship, day) */
  await pool.query(
    `INSERT INTO attendance (internship_id, on_date, status, notes, recorded_by)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       notes = VALUES(notes),
       recorded_by = VALUES(recorded_by)`,
    [internshipId, date, status, notes || null, req.user.sub]
  );

  res.status(201).json({ ok: true, internshipId, date, status });
});

/* ------------------------------------------------------------
   POST /api/attendance/bulk           (instructor / admin)
   Body: { internshipId, date, entries: [{internshipId,status}] }
   Actually: mark the SAME day for many interns at once — handy
   for an instructor doing a morning roll call.
   Body: { date, marks: [{internshipId, status, notes}] }
   ------------------------------------------------------------ */
export const markBulk = asyncHandler(async (req, res) => {
  const { date, marks } = req.body;
  if (!date || !Array.isArray(marks) || !marks.length) {
    const e = new Error("date and a non-empty marks array are required.");
    e.status = 400; throw e;
  }

  const done = [];
  for (const m of marks) {
    if (!m.internshipId || !m.status) continue;
    if (!(await canWrite(req.user, m.internshipId))) continue; // silently skip unauthorized
    await pool.query(
      `INSERT INTO attendance (internship_id, on_date, status, notes, recorded_by)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status), notes = VALUES(notes), recorded_by = VALUES(recorded_by)`,
      [m.internshipId, date, m.status, m.notes || null, req.user.sub]
    );
    done.push(m.internshipId);
  }

  res.status(201).json({ ok: true, date, marked: done.length });
});

/* ------------------------------------------------------------
   GET /api/attendance/:internshipId
   Admin/mentor: full log. Intern: only if it's theirs.
   ------------------------------------------------------------ */
export const getAttendance = asyncHandler(async (req, res) => {
  const { internshipId } = req.params;

  const [own] = await pool.query(
    `SELECT user_id, mentor_id FROM internships WHERE id = ? LIMIT 1`,
    [internshipId]
  );
  if (!own.length) {
    const e = new Error("No internship with that id."); e.status = 404; throw e;
  }
  const it = own[0];
  const allowed =
    req.user.role === "admin" ||
    req.user.sub === it.mentor_id ||
    req.user.sub === it.user_id;
  if (!allowed) {
    const e = new Error("You can't view this attendance."); e.status = 403; throw e;
  }

  const [rows] = await pool.query(
    `SELECT a.on_date, a.status, a.notes, u.full_name AS recorded_by_name
     FROM attendance a
     LEFT JOIN users u ON u.id = a.recorded_by
     WHERE a.internship_id = ?
     ORDER BY a.on_date DESC`,
    [internshipId]
  );

  /* quick summary */
  const summary = { present: 0, absent: 0, excused: 0, holiday: 0, total: rows.length };
  for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;

  res.json({ internshipId: Number(internshipId), summary, attendance: rows });
});
