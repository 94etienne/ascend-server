import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import path from "node:path";

import { testConnection } from "./config/db.js";
import { verifyMailer } from "./services/mailer.js";
import { notFound, errorHandler } from "./middleware/error.js";

import programRoutes from "./routes/program.routes.js";
import statsRoutes from "./routes/stats.routes.js";
import applicationRoutes from "./routes/application.routes.js";
import authRoutes from "./routes/auth.routes.js";
import certificateRoutes from "./routes/certificate.routes.js";
import documentRoutes from "./routes/document.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import internshipRoutes from "./routes/internship.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import adminRoutes from "./routes/admin.routes.js";

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT) || 5000;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("✗ JWT_SECRET missing or too short (need 32+ chars).");
  process.exit(1);
}

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api", rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests. Try again shortly." } }));
app.use((req,_res,next)=>{ console.log(`${req.method} ${req.originalUrl}`); next(); });

app.get("/api/health", (_req,res)=>res.json({ ok:true, service:"ascend-api", time:new Date().toISOString() }));
app.use("/api/programs", programRoutes);
  app.use("/api/stats", statsRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/documents", documentRoutes);
  app.use("/api/me", profileRoutes);
app.use("/api/internships", internshipRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

async function start(){
  try { await testConnection(); } catch(e){ console.error("✗ MySQL failed:",e.message); process.exit(1); }
  try { await verifyMailer(); } catch(e){ console.warn("⚠ SMTP:",e.message); }
  app.listen(PORT, ()=>{
    console.log(`\n✓ API running — http://localhost:${PORT}\n`);
    console.log("  /api/programs /api/applications /api/auth");
    console.log("  /api/certificates /api/internships /api/attendance /api/admin\n");
  });
}
start();
