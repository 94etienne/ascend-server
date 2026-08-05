/* ============================================================
   PUBLIC STATS — the headline numbers on the homepage.
   All counts come live from the DB. The founding year is the
   current year, computed here (not stored).

   Mappings (confirmed):
     people trained    → valid certificates (completed programs)
     interns placed    → applications with status 'completed'
     projects delivered→ public projects
   ============================================================ */
import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";

export const getPublicStats = asyncHandler(async (_req, res) => {
  const [[trained]] = await pool.query(
    `SELECT COUNT(*) AS n FROM certificates WHERE status = 'valid'`
  );
  const [[interns]] = await pool.query(
    `SELECT COUNT(*) AS n FROM applications WHERE status = 'completed'`
  );
  const [[projects]] = await pool.query(
    `SELECT COUNT(*) AS n FROM projects WHERE is_public = TRUE`
  );

  res.json({
    peopleTrained: trained.n,
    internsPlaced: interns.n,
    projectsDelivered: projects.n,
    foundedYear: new Date().getFullYear(),
  });
});
