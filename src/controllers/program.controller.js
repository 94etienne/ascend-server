import { pool } from "../config/db.js";
import { asyncHandler } from "../middleware/error.js";

const MODE_LABEL = { online:"Online", hybrid:"Hybrid — Huye", in_person:"In person — Huye", on_site_or_online:"On site or online" };
const LEVEL_LABEL = { beginner:"Beginner", intermediate:"Intermediate", advanced:"Advanced", scoped:"Scoped" };
const AUDIENCE_LABEL = { secondary:"Secondary students", students:"Students", graduates:"Graduates", professionals:"Professionals", organisations:"Organisations" };
const AUDIENCE_KEYS = Object.keys(AUDIENCE_LABEL);
const LEVEL_KEYS = Object.keys(LEVEL_LABEL);

function formatAudience(set){ if(!set)return""; return set.split(",").map(k=>AUDIENCE_LABEL[k.trim()]||k.trim()).filter(Boolean).join(" · "); }
function formatPrice(rwf,level){ const n=Number(rwf); if(n===0&&level==="scoped")return"Quoted"; if(n===0)return"Free"; return `RWF ${n.toLocaleString("en-US")}`; }

function toApi(r){ return { id:r.id, code:r.code, name:r.name, slug:r.slug, desc:r.description,
  level:LEVEL_LABEL[r.level]||r.level, levelKey:r.level, mode:MODE_LABEL[r.mode]||r.mode, modeKey:r.mode,
  audience:formatAudience(r.audience), audienceKeys:r.audience?r.audience.split(","):[],
  weeks:r.weeks, seats:r.seats, price:formatPrice(r.price_rwf,r.level), priceRwf:Number(r.price_rwf),
  applyDeadline: r.apply_deadline ? String(r.apply_deadline).slice(0,10) : null,
  /* is_active means "admin has it open". A program is OPEN for
     enrolment only if it's active AND the deadline hasn't passed.
     Past the deadline it auto-closes. */
  isActive: Boolean(r.is_active),
  isOpen: Boolean(r.is_active) && !isPastDeadline(r.apply_deadline),
  deadlinePassed: isPastDeadline(r.apply_deadline) }; }

/* True if a deadline exists and is before today (date-only). */
function isPastDeadline(d){
  if(!d) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const dl = new Date(String(d).slice(0,10) + "T23:59:59");
  return dl < today;
}

export const listPrograms = asyncHandler(async (req,res)=>{
  const { audience, level } = req.query;
  /* Every program is visible now — closed ones show "opening soon"
     instead of an enroll button, so we do NOT filter by is_active. */
  let sql = `SELECT id,code,name,slug,description,level,mode,audience,weeks,seats,price_rwf,is_active,apply_deadline FROM programs WHERE 1=1`;
  const args=[];
  if(audience){ const k=String(audience).toLowerCase().trim();
    if(!AUDIENCE_KEYS.includes(k)){const e=new Error(`Unknown audience "${audience}".`);e.status=400;throw e;}
    sql+=" AND FIND_IN_SET(?, audience)"; args.push(k); }
  if(level){ const k=String(level).toLowerCase().trim();
    if(!LEVEL_KEYS.includes(k)){const e=new Error(`Unknown level "${level}".`);e.status=400;throw e;}
    sql+=" AND level = ?"; args.push(k); }
  sql+=" ORDER BY code ASC";
  const [rows]=await pool.query(sql,args);
  res.json({ count:rows.length, programs:rows.map(toApi) });
});

export const getProgram = asyncHandler(async (req,res)=>{
  /* Visible whether open or closed. */
  const [rows]=await pool.query(
    `SELECT id,code,name,slug,description,level,mode,audience,weeks,seats,price_rwf,is_active,apply_deadline
     FROM programs WHERE code=? LIMIT 1`, [req.params.code.toUpperCase()]);
  if(!rows.length){const e=new Error(`No program with code "${req.params.code}".`);e.status=404;throw e;}
  res.json({ program:toApi(rows[0]) });
});

export const getProgramCohorts = asyncHandler(async (req,res)=>{
  const [rows]=await pool.query(
    `SELECT c.id,c.label,c.starts_on,c.ends_on,c.capacity,c.status FROM cohorts c
     JOIN programs p ON p.id=c.program_id WHERE p.code=? AND c.status='open' AND c.starts_on>=CURDATE()
     ORDER BY c.starts_on ASC`, [req.params.code.toUpperCase()]);
  res.json({ count:rows.length, cohorts:rows });
});

/* ============================================================
   ADMIN — open or close a program for enrolment.
   PATCH /api/programs/:code/open   Body: { open: true|false }
   Closing sets is_active = FALSE (still visible, no enroll).
   ============================================================ */
export const setProgramOpen = asyncHandler(async (req,res)=>{
  const { open, applyDeadline } = req.body;
  if(typeof open !== "boolean"){
    const e=new Error("Send { open: true } or { open: false }."); e.status=400; throw e;
  }
  /* When reopening you may also set/clear the deadline. When
     closing we leave it as-is. */
  let sql, args;
  if(applyDeadline !== undefined){
    sql = `UPDATE programs SET is_active = ?, apply_deadline = ? WHERE code = ?`;
    args = [open, applyDeadline || null, req.params.code.toUpperCase()];
  } else {
    sql = `UPDATE programs SET is_active = ? WHERE code = ?`;
    args = [open, req.params.code.toUpperCase()];
  }
  const [result]=await pool.query(sql, args);
  if(!result.affectedRows){
    const e=new Error(`No program with code "${req.params.code}".`); e.status=404; throw e;
  }
  res.json({ ok:true, code:req.params.code.toUpperCase(), isOpen:open });
});
