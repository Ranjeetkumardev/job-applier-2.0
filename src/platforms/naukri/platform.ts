import { createTracker } from "../../core/tracker.js";
import { createStealthContext } from "../../core/stealth-context.js";
import { createNaukriPage } from "./page.js";
import { createRun } from "../base/run.js";
import { logger } from "../../utils/logger.js";
import { sendJobToSlack } from "../../utils/slack.js";
import type { AppDatabase } from "../../core/database.js";
import type { ApplyResult, JobCard, PlatformInitOptions } from "../base/types.js";

export type NaukriPlatform = ReturnType<typeof createNaukriPlatform>;
const APPLY_TIMEOUT_MS = 120_000; // 2 minutes per job — then close tab and move on

export const createNaukriPlatform = (db: AppDatabase) => {
  const name = "naukri";
  const baseUrl = "https://www.naukri.com";
  const tracker = createTracker(db);

  let stealth: ReturnType<typeof createStealthContext> | undefined;
  let context: Awaited<ReturnType<ReturnType<typeof createStealthContext>["launch"]>> | undefined;
  let page: Awaited<ReturnType<ReturnType<typeof createStealthContext>["newPage"]>> | undefined;
  let naukriPage: ReturnType<typeof createNaukriPage> | undefined;

  const init = async (options: PlatformInitOptions = {}): Promise<void> => {
    stealth = createStealthContext();
    context = await stealth.launch({
      storageStatePath: options.storageStatePath,
      headless: options.headless,
    });
    page = await stealth.newPage();
    naukriPage = createNaukriPage(page);
    logger.info({ platform: name }, "Naukri platform initialized");
  };

  const close = async (): Promise<void> => {
    await stealth?.close();
  };

 
// ── helpers ─────────────────────────────────────────────
const parseExpRange = (text: string): [number, number] | null => {
  if (!text) return null;
  // "2-5 Yrs" / "4 - 9 Yrs"
  const range = text.match(/(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)/i);
  if (range) return [Number(range[1]), Number(range[2])];
  // "5 Yrs" / "3+ Yrs"
  const single = text.match(/^(\d+(?:\.\d+)?)/);
  if (single) return [Number(single[1]), 99];
  return null;
};

const parsePostedDays = (text: string): number | null => {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/just now|today|few hours/.test(t)) return 0;
  const m = t.match(/(\d+)\s*\+?\s*(day|week|month)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "day") return n;
  if (m[2] === "week") return n * 7;
  if (m[2] === "month") return n * 30;
  return null;
};

const overlaps = (a: [number, number], b: [number, number]) =>
  a[1] >= b[0] && a[0] <= b[1];

// ── searchJobs ──────────────────────────────────────────
const searchJobs = async (
  keywords: string,
  location?: string | string[],
): Promise<JobCard[]> => {
  if (!naukriPage) throw new Error("Platform not initialized");

  let minExp: number | undefined;
  let maxExp: number | undefined;
  const expMatch = keywords.match(/\bexp\s*:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\b/i);
  if (expMatch) {
    minExp = Number(expMatch[1]);
    maxExp = Number(expMatch[2]);
    keywords = keywords.replace(expMatch[0], "").trim();
  }

  const locations: string[] =
    Array.isArray(location)
      ? location
      : typeof location === "string" && location.includes(",")
        ? location.split(",").map((s) => s.trim()).filter(Boolean)
        : typeof location === "string" && location
          ? [location]
          : [];

  const combined = new Map<string, JobCard>();
  const searchLocations = locations.length > 0 ? locations : [undefined];

  // Post-filter ceilings
  const MAX_AGE_DAYS = 3;                       // match the "3 days" requirement
  const wantRange: [number, number] | undefined =
    minExp !== undefined && maxExp !== undefined ? [minExp, maxExp] : undefined;

  for (const loc of searchLocations) {
    await naukriPage.search(keywords, {
      location: loc,
      minExp,
      maxExp,
      jobAge: MAX_AGE_DAYS,
    });

    const extracted = await naukriPage.extractJobCards(30); // grab more, filter later
    let keptCount = 0;

    for (const job of extracted) {
      if (combined.has(job.jobId)) continue;

      // Experience post-filter
      if (wantRange) {
        const cardExp = parseExpRange(job.experience ?? "");
        if (cardExp && !overlaps(cardExp, wantRange)) {
          logger.debug(
            { jobId: job.jobId, cardExp, wantRange },
            "Skipping job — experience out of range",
          );
          continue;
        }
      }

      // Age post-filter
      const days = parsePostedDays(job.postedAt ?? "");
      if (days !== null && days > MAX_AGE_DAYS) {
        logger.debug(
          { jobId: job.jobId, postedAt: job.postedAt, days },
          "Skipping job — too old",
        );
        continue;
      }

      combined.set(job.jobId, {
        jobId: job.jobId,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
      });
      keptCount++;
    }

    logger.info(
      { location: loc, extracted: extracted.length, kept: keptCount },
      "Search page filtered",
    );
  }

  const jobs = Array.from(combined.values());
  logger.info({ count: jobs.length, keywords, location }, "Naukri jobs after filter");
  return jobs;
};



const applyToJob = async (job: JobCard): Promise<ApplyResult> => {
//   const mainSearchPage = this.page;
//   if (!context || !mainSearchPage) throw new Error("Platform not initialized");

//   if (tracker.hasAlreadyApplied(name, job.jobId)) {
//     return {
//       success: false, job, alreadyApplied: true,
//       metadata: { stage: "already-applied-precheck" },
//     };
//   }

//   const jobPage = await context.newPage();
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
    const jobNaukriPage = createNaukriPage(jobPage);
    await jobNaukriPage.goto(job.url);

    if (await jobNaukriPage.isExternalApplyPage()) {
      logger.info({ jobId: job.jobId }, "External apply — sending to Slack");
      await sendJobToSlack(job, "external").catch(() => {});
      return {
        success: false, job, alreadyApplied: true,
        metadata: { stage: "external-apply-sent-to-slack" },
      };
    }

    const result = await jobNaukriPage.handleSimpleApply(job);

    if (result.metadata?.stage === "external-apply-sent-to-slack") {
      await sendJobToSlack(job, "external").catch(() => {});
      return { success: false, job, error: "External apply required", metadata: result.metadata };
    }

    const isSoftSuccess =
      result.success ||
      result.message?.includes("confirmation page") ||
      result.message?.includes("recruiter") ||
      (Array.isArray((result.metadata as any)?.steps) &&
        (result.metadata as any).steps.some(
          (s: { step: string }) =>
            s.step === "recruiter-questions-completed" ||
            s.step === "confirmation-page-without-success",
        ));

    if (isSoftSuccess) {
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
      logger.warn(
        { jobId: job.jobId, ms: APPLY_TIMEOUT_MS },
        "Apply timed out — closing tab and moving on",
      );
      resolve({
        success: false,
        job,
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
    // Always clean up the tab and restore focus, regardless of outcome
    await jobPage.close().catch(() => {});
    await mainSearchPage.bringToFront().catch(() => {});
  }
};
 
  const run = createRun(searchJobs, applyToJob);
   
  // return { name, baseUrl, init, close, searchJobs, applyToJob, run };
  // AFTER
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
  get naukriPage() {
    if (!naukriPage) throw new Error("Call init() before accessing naukriPage");
    return naukriPage;
  },
};
};