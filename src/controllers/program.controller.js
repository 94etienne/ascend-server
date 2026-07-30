import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";

/* ============================================================
   The DB stores machine-friendly values; the UI wants
   human-friendly ones. Translate here, once.
   ============================================================ */

const MODE_LABEL = {
  online: "Online",
  hybrid: "Hybrid — Huye",
  in_person: "In person — Huye",
  on_site_or_online: "On site or online",
};

const LEVEL_LABEL = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  scoped: "Scoped",
};

/* audience is a SET column: "graduates,professionals" */
const AUDIENCE_LABEL = {
  secondary: "Secondary students",
  students: "Students",
  graduates: "Graduates",
  professionals: "Professionals",
  organisations: "Organisations",
};

const AUDIENCE_KEYS = Object.keys(AUDIENCE_LABEL);
const LEVEL_KEYS = Object.keys(LEVEL_LABEL);

/* "graduates,professionals" → "Graduates · Professionals" */
function formatAudience(set) {
  if (!set) return "";
  return set
    .split(",")
    .map((k) => AUDIENCE_LABEL[k.trim()] || k.trim())
    .filter(Boolean)
    .join(" · ");
}

/* 220000 → "RWF 220,000"  |  0 + scoped → "Quoted"  |  0 → "Free" */
function formatPrice(rwf, level) {
  const n = Number(rwf);
  if (n === 0 && level === "scoped") return "Quoted";
  if (n === 0) return "Free";
  return `RWF ${n.toLocaleString("en-US")}`;
}

function toApi(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    slug: row.slug,
    desc: row.description,
    level: LEVEL_LABEL[row.level] || row.level,
    levelKey: row.level,
    mode: MODE_LABEL[row.mode] || row.mode,
    modeKey: row.mode,
    audience: formatAudience(row.audience),
    audienceKeys: row.audience ? row.audience.split(",") : [],
    weeks: row.weeks,
    seats: row.seats,
    price: formatPrice(row.price_rwf, row.level),
    priceRwf: Number(row.price_rwf),
  };
}

/* ============================================================
   GET /api/programs
   ?audience=professionals  ?level=beginner  ?all=true
   ============================================================ */
export const listPrograms = asyncHandler(async (req, res) => {
  const { audience, level, all } = req.query;

  let sql = `
    SELECT id, code, name, slug, description, level, mode,
           audience, weeks, seats, price_rwf, is_active
    FROM programs
    WHERE 1 = 1
  `;
  const args = [];

  if (all !== "true") sql += " AND is_active = TRUE";

  /* FIND_IN_SET is the native way to query a SET column —
     exact member match, unlike LIKE '%x%'. */
  if (audience) {
    const key = String(audience).toLowerCase().trim();
    if (!AUDIENCE_KEYS.includes(key)) {
      const e = new Error(
        `Unknown audience "${audience}". Valid: ${AUDIENCE_KEYS.join(", ")}.`
      );
      e.status = 400;
      throw e;
    }
    sql += " AND FIND_IN_SET(?, audience)";
    args.push(key);
  }

  if (level) {
    const key = String(level).toLowerCase().trim();
    if (!LEVEL_KEYS.includes(key)) {
      const e = new Error(
        `Unknown level "${level}". Valid: ${LEVEL_KEYS.join(", ")}.`
      );
      e.status = 400;
      throw e;
    }
    sql += " AND level = ?";
    args.push(key);
  }

  sql += " ORDER BY code ASC";

  const [rows] = await pool.query(sql, args);
  res.json({ count: rows.length, programs: rows.map(toApi) });
});

/* ============================================================
   GET /api/programs/:code
   ============================================================ */
export const getProgram = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const [rows] = await pool.query(
    `SELECT id, code, name, slug, description, level, mode,
            audience, weeks, seats, price_rwf, is_active
     FROM programs
     WHERE code = ? AND is_active = TRUE
     LIMIT 1`,
    [code.toUpperCase()]
  );

  if (!rows.length) {
    const e = new Error(`No program with code "${code}".`);
    e.status = 404;
    throw e;
  }

  res.json({ program: toApi(rows[0]) });
});

/* ============================================================
   GET /api/programs/:code/cohorts
   ============================================================ */
export const getProgramCohorts = asyncHandler(async (req, res) => {
  const { code } = req.params;

  const [rows] = await pool.query(
    `SELECT c.id, c.label, c.starts_on, c.ends_on, c.capacity, c.status
     FROM cohorts c
     JOIN programs p ON p.id = c.program_id
     WHERE p.code = ?
       AND c.status = 'open'
       AND c.starts_on >= CURDATE()
     ORDER BY c.starts_on ASC`,
    [code.toUpperCase()]
  );

  res.json({ count: rows.length, cohorts: rows });
});
