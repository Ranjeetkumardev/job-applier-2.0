import { createTracker } from "../../core/tracker.js";
import { createStealthContext } from "../../core/stealth-context.js";
import { createWellfoundPage } from "./page.js";
import { createRun } from "../base/run.js";
import { logger } from "../../utils/logger.js";
import { sendJobToSlack } from "../../utils/slack.js";
import type { AppDatabase } from "../../core/database.js";
import type { ApplyResult, JobCard, PlatformInitOptions } from "../base/types.js";

export type WellfoundPlatform = ReturnType<typeof createWellfoundPlatform>;
const APPLY_TIMEOUT_MS = 120_000;

export const createWellfoundPlatform = (db: AppDatabase) => {
  const name = "wellfound";
  const baseUrl = "https://wellfound.com";
  const tracker = createTracker(db);

  let stealth: ReturnType<typeof createStealthContext> | undefined;
  let context: Awaited<ReturnType<ReturnType<typeof createStealthContext>["launch"]>> | undefined;
  let page: Awaited<ReturnType<ReturnType<typeof createStealthContext>["newPage"]>> | undefined;
  let wellfoundPage: ReturnType<typeof createWellfoundPage> | undefined;

  const init = async (options: PlatformInitOptions = {}): Promise<void> => {
    stealth = createStealthContext();
    context = await stealth.launch({
      storageStatePath: options.storageStatePath,
      headless: options.headless,
    });
    page = await stealth.newPage();
    wellfoundPage = createWellfoundPage(page);
    logger.info({ platform: name }, "Wellfound platform initialized");
  };

  const close = async (): Promise<void> => {
    await stealth?.close();
  };

  const searchJobs = async (
    keywords: string,
    location?: string | string[],
  ): Promise<JobCard[]> => {
    if (!wellfoundPage) throw new Error("Platform not initialized");

    const locations: string[] = Array.isArray(location)
      ? location
      : typeof location === "string" && location
        ? [location]
        : [];

    const combined = new Map<string, JobCard>();
    const searchLocations = locations.length > 0 ? locations : [undefined];

    for (const loc of searchLocations) {
      await wellfoundPage.search(keywords, { location: loc });
      const extracted = await wellfoundPage.extractJobCards(30);

      for (const job of extracted) {
        if (combined.has(job.jobId)) continue;
        combined.set(job.jobId, {
          jobId: job.jobId,
          title: job.title,
          company: job.company,
          location: job.location,
          url: job.url,
        });
      }
      logger.info({ location: loc, extracted: extracted.length }, "Wellfound search page processed");
    }

    const jobs = Array.from(combined.values());
    logger.info({ count: jobs.length, keywords, location }, "Wellfound jobs after filter");
    return jobs;
  };

  const applyToJob = async (job: JobCard): Promise<ApplyResult> => {
    const mainSearchPage = page;
    const mainContext = context;

    if (!mainContext || !mainSearchPage) {
      throw new Error("Platform not initialized");
    }

    if (tracker.hasAlreadyApplied(name, job.jobId)) {
      return {
        success: false, job, alreadyApplied: true,
        metadata: { stage: "already-applied-precheck" },
      };
    }

    const jobPage = await mainContext.newPage();

    const runFlow = async (): Promise<ApplyResult> => {
      const jobWellfoundPage = createWellfoundPage(jobPage);
      await jobWellfoundPage.goto(job.url);

      const result = await jobWellfoundPage.handleSimpleApply(job);

      if (result.metadata?.stage === "external-apply-sent-to-slack") {
        await sendJobToSlack(job, "external").catch(() => {});
        return { success: false, job, error: "External apply required", metadata: result.metadata };
      }

      if (result.success) {
        tracker.track({
          platform: name,
          jobId: job.jobId,
          jobTitle: job.title,
          company: job.company,
          location: job.location,
          jobUrl: job.url,
          status: "applied",
          metadata: result.metadata as Record<string, unknown>,
        });
        await sendJobToSlack(job, "applied").catch(() => {});
        return {
          success: true, job,
          metadata: { ...result.metadata, stage: "application-submitted" },
        };
      }

      tracker.track({
        platform: name,
        jobId: job.jobId,
        jobTitle: job.title,
        company: job.company,
        location: job.location,
        jobUrl: job.url,
        status: "failed",
        errorMessage: result.message,
        metadata: result.metadata as Record<string, unknown>,
      });
      return { success: false, job, error: result.message, metadata: result.metadata };
    };

    const timeoutPromise = new Promise<ApplyResult>((resolve) =>
      setTimeout(() => {
        logger.warn({ jobId: job.jobId, ms: APPLY_TIMEOUT_MS }, "Apply timed out — closing tab");
        resolve({
          success: false, job,
          error: `Apply timed out after ${APPLY_TIMEOUT_MS / 1000}s`,
          metadata: { stage: "timeout", timeoutMs: APPLY_TIMEOUT_MS },
        });
      }, APPLY_TIMEOUT_MS),
    );

    try {
      return await Promise.race([runFlow(), timeoutPromise]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, jobId: job.jobId }, "Apply threw");
      return {
        success: false, job, error: message,
        metadata: { stage: "unexpected-error", occurredAt: new Date().toISOString() },
      };
    } finally {
      await jobPage.close().catch(() => {});
      await mainSearchPage.bringToFront().catch(() => {});
    }
  };

  const run = createRun(searchJobs, applyToJob);

  return {
    name,
    baseUrl,
    init,
    close,
    searchJobs,
    applyToJob,
    run,
    get page() {
      if (!page) throw new Error("Call init() before accessing page");
      return page;
    },
    get context() {
      if (!context) throw new Error("Call init() before accessing context");
      return context;
    },
    get wellfoundPage() {
      if (!wellfoundPage) throw new Error("Call init() before accessing wellfoundPage");
      return wellfoundPage;
    },
  };
};