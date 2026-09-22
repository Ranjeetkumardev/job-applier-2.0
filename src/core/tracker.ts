import type { AppDatabase } from "./database.js";
import { logger } from "../utils/logger.js";

export type ApplicationStatus = "pending" | "applied" | "failed" | "skipped";

export interface TrackApplicationInput {
  platform: string;
  jobId?: string;
  jobTitle?: string;
  company?: string;
  location?: string;
  jobUrl?: string;
  status: ApplicationStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export type Tracker = ReturnType<typeof createTracker>;

export const createTracker = (db: AppDatabase) => {
  const track = (input: TrackApplicationInput) => {
    const stmt = db.connection.prepare(`
      INSERT INTO applications (
        platform, job_id, job_title, company, location, job_url,
        status, error_message, applied_at, metadata
      ) VALUES (
        @platform, @jobId, @jobTitle, @company, @location, @jobUrl,
        @status, @errorMessage, @appliedAt, @metadata
      )
    `);

    const result = stmt.run({
      platform: input.platform,
      jobId: input.jobId ?? null,
      jobTitle: input.jobTitle ?? null,
      company: input.company ?? null,
      location: input.location ?? null,
      jobUrl: input.jobUrl ?? null,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      appliedAt: input.status === "applied" ? new Date().toISOString() : null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });

    logger.info(
      { id: result.lastInsertRowid, platform: input.platform, status: input.status },
      "Application tracked",
    );

    return result.lastInsertRowid;
  };

  const hasAlreadyApplied = (platform: string, jobId: string): boolean => {
    const row = db.connection
      .prepare(
        `SELECT id FROM applications
         WHERE platform = ? AND job_id = ? AND status = 'applied'`,
      )
      .get(platform, jobId);
    return !!row;
  };

  return { track, hasAlreadyApplied };
};