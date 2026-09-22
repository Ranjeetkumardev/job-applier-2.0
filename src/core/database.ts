import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export type AppDatabase = ReturnType<typeof createDatabase>;

export const createDatabase = (dbPath: string = env.DB_PATH) => {
  const resolvedPath = path.resolve(process.cwd(), dbPath);

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const connection = new Database(resolvedPath);

  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.pragma("busy_timeout = 5000");

  logger.info({ path: resolvedPath }, "Database connected");

  const initSchema = (): void => {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        job_id TEXT,
        job_title TEXT,
        company TEXT,
        location TEXT,
        job_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','applied','failed','skipped')),
        error_message TEXT,
        applied_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_applications_platform ON applications(platform);
      CREATE INDEX IF NOT EXISTS idx_applications_status   ON applications(status);
      CREATE INDEX IF NOT EXISTS idx_applications_job_id   ON applications(job_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_platform_job_applied
        ON applications(platform, job_id)
        WHERE (job_id IS NOT NULL AND status = 'applied');
    `);
    logger.info("Database schema initialized");
  };

  const close = (): void => {
    if (connection.open) {
      connection.close();
      logger.info("Database connection closed");
    }
  };

  return { connection, initSchema, close };
};