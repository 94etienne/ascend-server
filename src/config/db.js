import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config();

const useSSL = process.env.DB_SSL === "true";

export const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "ascend_ai",
  waitForConnections: true, connectionLimit: 10, queueLimit: 0,
  dateStrings: true, charset: "utf8mb4",
  ...(useSSL ? { ssl: { rejectUnauthorized: true } } : {}),
});

export async function testConnection(){
  const c = await pool.getConnection();
  try { await c.ping(); console.log(`✓ MySQL connected — ${process.env.DB_NAME} @ ${process.env.DB_HOST}`); }
  finally { c.release(); }
}
