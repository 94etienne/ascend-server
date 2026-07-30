import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";

/* ============================================================
   ADMIN
   Overview metrics + user/instructor management.
   ============================================================ */

/* ------------------------------------------------------------
   GET /api/admin/overview
   Numbers for the admin dashboard header.
   ------------------------------------------------------------ */
export const overview = asyncHandler(async (_req, res) => {
  const [[apps]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'new') AS new_apps,
       SUM(status = 'reviewing') AS reviewing,
       SUM(status = 'accepted') AS accepted,
       SUM(status = 'completed') AS completed
     FROM applications`
  );
  const [[interns]] = await pool.query(
    `SELECT
       COUNT(*) AS total,
       SUM(status = 'active') AS active,
       SUM(status = 'completed') AS completed
     FROM internships`
  );
  const [[users]] = await pool.query(
    `SELECT
       SUM(role = 'student') AS students,
       SUM(role = 'intern') AS interns,
       SUM(role = 'instructor') AS instructors
     FROM users`
  );
  const [[certs]] = await pool.query(
    `SELECT COUNT(*) AS issued FROM certificates WHERE status = 'valid'`
  );

  res.json({
    applications: {
      total: Number(apps.total) || 0,
      new: Number(apps.new_apps) || 0,
      reviewing: Number(apps.reviewing) || 0,
      accepted: Number(apps.accepted) || 0,
      completed: Number(apps.completed) || 0,
    },
    internships: {
      total: Number(interns.total) || 0,
      active: Number(interns.active) || 0,
      completed: Number(interns.completed) || 0,
    },
    people: {
      students: Number(users.students) || 0,
      interns: Number(users.interns) || 0,
      instructors: Number(users.instructors) || 0,
    },
    certificates: { issued: Number(certs.issued) || 0 },
  });
});

/* ------------------------------------------------------------
   GET /api/admin/instructors
   The list an admin picks from when assigning a mentor.
   ------------------------------------------------------------ */
export const listInstructors = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.full_name, u.username, u.email,
            (SELECT COUNT(*) FROM internships i
               WHERE i.mentor_id = u.id AND i.status = 'active') AS active_interns
     FROM users u
     WHERE u.role IN ('instructor','admin') AND u.is_active = TRUE
     ORDER BY u.full_name ASC`
  );
  res.json({ instructors: rows });
});

/* ------------------------------------------------------------
   GET /api/admin/users?role=student
   Full user list with a role filter.
   ------------------------------------------------------------ */
export const listUsers = asyncHandler(async (req, res) => {
  const { role, q } = req.query;
  let sql = `
    SELECT id, full_name, username, email, phone, role, stage,
           is_active, last_login_at, created_at
    FROM users WHERE 1 = 1
  `;
  const args = [];
  if (role) { sql += " AND role = ?"; args.push(role); }
  if (q) {
    sql += " AND (full_name LIKE ? OR email LIKE ? OR username LIKE ?)";
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  sql += " ORDER BY created_at DESC LIMIT 200";
  const [rows] = await pool.query(sql, args);
  res.json({ count: rows.length, users: rows });
});

/* ------------------------------------------------------------
   PATCH /api/admin/users/:id/role
   Promote / demote. Admin only. Can't demote the last admin.
   ------------------------------------------------------------ */
export const setUserRole = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const VALID = ["student", "intern", "instructor", "admin"];
  if (!VALID.includes(role)) {
    const e = new Error(`Role must be one of: ${VALID.join(", ")}.`); e.status = 400; throw e;
  }

  /* guard: never leave the system with zero admins */
  if (role !== "admin") {
    const [[{ n }]] = await pool.query(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = TRUE`
    );
    const [[target]] = await pool.query(`SELECT role FROM users WHERE id = ?`, [id]);
    if (target && target.role === "admin" && n <= 1) {
      const e = new Error("You can't demote the last admin.");
      e.status = 409; throw e;
    }
  }

  const [r] = await pool.query(`UPDATE users SET role = ? WHERE id = ?`, [role, id]);
  if (!r.affectedRows) {
    const e = new Error("No user with that id."); e.status = 404; throw e;
  }
  res.json({ ok: true, id: Number(id), role });
});
