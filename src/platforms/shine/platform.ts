// src/platforms/shine/platform.ts

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import fs from "fs";
import path from "path";
import { createShinePage } from "./page.js";
import { createRun } from "../base/run.js";
import { logger } from "../../utils/logger.js";
import { sendJobToSlack } from "../../utils/slack.js";
import type { AppDatabase } from "../../core/database.js";
import type {
  ApplyResult,
  JobCard,
  PlatformInitOptions,
} from "../base/types.js";

export type ShinePlatform = ReturnType<typeof createShinePlatform>;

const APPLY_TIMEOUT_MS = 120_000;
const HOME_URL = "https://www.shine.com/";


  // ── Title matcher ───────────────────────────────────────
  // Terms we DO want in job titles (case-insensitive)
  const ROLE_INCLUDE_TERMS = [
    // Core stack
    "node",
    "nodejs",
    "node.js",
    "node js",
    "backend",
    "back-end",
    "back end",
    "mern",
    "mean",
    "full stack",
    "fullstack",
    "full-stack",
    "frontend",
    "front-end",
    "front end",
    "react",
    "express",
    "javascript",
    "typescript",
    "nextjs",
    "next.js",
    "next js",
    "nestjs",
    "nest.js",
    "graphql",
    "rest api",
    "api developer",
    "api engineer",
    "web developer",
    "software developer",
    "software engineer",
    "sde",
    "ai",
    "gen ai",
    "genai",
    "llm",
    "machine learning",
    "ml engineer",
    "ai engineer",
    "ai developer",
    "python developer",
    "web3",
    "mongodb",
    "mongo",
  ];

  // Terms that DISQUALIFY a job (wrong stack)
  const ROLE_EXCLUDE_TERMS = [
    ".net",
    "dotnet",
    "dot net",
    "java developer",
    "java engineer",
    "java full stack",       // Java-heavy
    "spring boot",
    "springboot",
    "android",
    "ios",
    "flutter",
    "react native",
    "php",
    "laravel",
    "wordpress",
    "drupal",
    "magento",
    "shopify",
    "salesforce",
    "servicenow",
    "sap ",
    " sap",
    "oracle",
    "pega",
    "guidewire",
    "mainframe",
    "cobol",
    "devops engineer",       // different role
    "sre ",
    "site reliability",
    "cloud engineer",        // infra, not code
    "data scientist",        // different role
    "data analyst",
    "business analyst",
    "qa engineer",
    "test engineer",
    "automation tester",
    "manual tester",
    "support engineer",
    "technical support",
    "helpdesk",
    "network engineer",
    "system admin",
    "sysadmin",
    "cyber security",
    "security engineer",
    "product manager",
    "project manager",
    "scrum master",
    "sales ",
    "marketing ",
    "recruiter",
    "hr ",
    " hr",
    "finance",
    "accountant",
    "teacher",
    "trainer",               // hmm — actually you may want trainers
    "intern",                // usually below your exp
    "fresher",
    "graphic designer",
    "ui designer",           // pure design, not engineering
    "ux designer",
    "content writer",
    "seo ",
    "customer service",
    "customer support",
  ];

  const titleMatchesRoles = (title: string): boolean => {
    if (!title) return false;
    const t = ` ${title.toLowerCase()} `;

    // Hard rejects first
    for (const bad of ROLE_EXCLUDE_TERMS) {
      if (t.includes(bad)) return false;
    }

    // Then require at least one positive term
    for (const good of ROLE_INCLUDE_TERMS) {
      if (t.includes(good)) return true;
    }

    return false;
  };
// ─────────────────────────────────────────────────────────────
// SHINE PLATFORM
// ─────────────────────────────────────────────────────────────
export const createShinePlatform = (db: AppDatabase) => {
  const name = "shine";

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let shinePage: ReturnType<typeof createShinePage> | undefined;

  const init = async (options: PlatformInitOptions = {}): Promise<void> => {
    browser = await chromium.launch({
      headless: options.headless ?? false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    const storageState = options.storageStatePath
      ? path.resolve(process.cwd(), options.storageStatePath)
      : undefined;

    const contextOptions: Parameters<Browser["newContext"]>[0] = {
      viewport: { width: 1366, height: 768 },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    };

    if (storageState && fs.existsSync(storageState)) {
      contextOptions.storageState = storageState;
      logger.info({ path: storageState }, "Loaded Shine storage state");
    }

    context = await browser.newContext(contextOptions);

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // @ts-ignore
      window.chrome = { runtime: {} };
    });

    page = await context.newPage();
    shinePage = createShinePage(page);

    logger.info({ platform: name }, "Shine platform initialized");
  };

  const close = async (): Promise<void> => {
    await browser?.close();
  };

  // ── Helpers ─────────────────────────────────────────────
  const parseExpRange = (text: string): [number, number] | null => {
    if (!text) return null;
    const range = text.match(
      /(\d+(?:\.\d+)?)\s*[-\u2013to]+\s*(\d+(?:\.\d+)?)/i,
    );
    if (range) return [Number(range[1]), Number(range[2])];
    const single = text.match(/^(\d+(?:\.\d+)?)/);
    if (single) return [Number(single[1]), 99];
    return null;
  };

  const parsePostedDays = (text: string): number | null => {
    if (!text) return null;
    const t = text.toLowerCase();
    if (/just now|today|few hours|hour/i.test(t)) return 0;
    const m = t.match(/(\d+)\s*\+?\s*(day|week|month|hour)/);
    if (!m) return null;
    const n = Number(m[1]);
    if (m[2].startsWith("hour")) return 0;
    if (m[2] === "day") return n;
    if (m[2] === "week") return n * 7;
    if (m[2] === "month") return n * 30;
    return null;
  };

  const overlaps = (a: [number, number], b: [number, number]) =>
    a[1] >= b[0] && a[0] <= b[1];

  // ── searchJobs ──────────────────────────────────────────
//   const searchJobs = async (
//     keywords: string,
//     location?: string | string[],
//   ): Promise<JobCard[]> => {
//     if (!shinePage) throw new Error("Platform not initialized");

//     let minExp: number | undefined;
//     let maxExp: number | undefined;
//     const expMatch = keywords.match(
//       /\bexp\s*:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\b/i,
//     );
//     if (expMatch) {
//       minExp = Number(expMatch[1]);
//       maxExp = Number(expMatch[2]);
//       keywords = keywords.replace(expMatch[0], "").trim();
//     }

//     const locations: string[] = Array.isArray(location)
//       ? location
//       : typeof location === "string" && location.includes(",")
//         ? location.split(",").map((s) => s.trim()).filter(Boolean)
//         : typeof location === "string" && location
//           ? [location]
//           : [];

//     const combined = new Map<string, JobCard>();
//     const searchLocations = locations.length > 0 ? locations : [undefined];

//     const MAX_AGE_DAYS = 3;
//     const wantRange: [number, number] | undefined =
//       minExp !== undefined && maxExp !== undefined
//         ? [minExp, maxExp]
//         : undefined;

//     for (const loc of searchLocations) {
//       await shinePage.search(keywords, {
//         location: loc,
//         minExp,
//         maxExp,
//         jobAge: MAX_AGE_DAYS,
//         filters: {
//           experiences: ["1 to 2 Years", "3 to 5 Years"],
//           // locations: loc ? [loc] : undefined,
//           // salaries: ["6 To 8 Lakh", "9 To 12 Lakh"],
//           // departments: ["General / Other Software"],
//           // industries: ["IT Services & Consulting"],
//         },
//       });

//       const extracted = await shinePage.extractJobCards(30);
//       let keptCount = 0;

//       for (const job of extracted) {
//         if (combined.has(job.jobId)) continue;

//         if (wantRange) {
//           const cardExp = parseExpRange(job.experience ?? "");
//           if (cardExp && !overlaps(cardExp, wantRange)) continue;
//         }

//         const days = parsePostedDays(job.postedAt ?? "");
//         if (days !== null && days > MAX_AGE_DAYS) continue;

//         combined.set(job.jobId, {
//           jobId: job.jobId,
//           title: job.title,
//           company: job.company,
//           location: job.location,
//           url: job.url,
//         });
//         keptCount++;
//       }

//       logger.info(
//         { location: loc, extracted: extracted.length, kept: keptCount },
//         "Shine search page filtered",
//       );
//     }

//     const jobs = Array.from(combined.values());
//     logger.info(
//       { count: jobs.length, keywords, location },
//       "Shine jobs after filter",
//     );
//     return jobs;
//   };
  const searchJobs = async (
    keywords: string,
    location?: string | string[],
  ): Promise<JobCard[]> => {
    if (!shinePage) throw new Error("Platform not initialized");

    let minExp: number | undefined;
    let maxExp: number | undefined;
    const expMatch = keywords.match(
      /\bexp\s*:\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\b/i,
    );
    if (expMatch) {
      minExp = Number(expMatch[1]);
      maxExp = Number(expMatch[2]);
      keywords = keywords.replace(expMatch[0], "").trim();
    }

    const locations: string[] = Array.isArray(location)
      ? location
      : typeof location === "string" && location.includes(",")
        ? location.split(",").map((s) => s.trim()).filter(Boolean)
        : typeof location === "string" && location
          ? [location]
          : [];

    const combined = new Map<string, JobCard>();
    const searchLocations = locations.length > 0 ? locations : [undefined];

    const MAX_AGE_DAYS = 3;
    const wantRange: [number, number] | undefined =
      minExp !== undefined && maxExp !== undefined
        ? [minExp, maxExp]
        : undefined;

    for (const loc of searchLocations) {
      await shinePage.search(keywords, {
        location: loc,
        minExp,
        maxExp,
        jobAge: MAX_AGE_DAYS,
        filters: {
          experiences: ["1 to 2 Years", "3 to 5 Years"],
        },
      });

      const extracted = await shinePage.extractJobCards(30);
      let keptCount = 0;
      let skippedByTitle = 0;
      let skippedByExp = 0;
      let skippedByAge = 0;

      for (const job of extracted) {
        if (combined.has(job.jobId)) continue;

        // 1. Title relevance
        if (!titleMatchesRoles(job.title)) {
          logger.debug(
            { jobId: job.jobId, title: job.title },
            "Skipping — title not relevant",
          );
          skippedByTitle++;
          continue;
        }

        // 2. Experience overlap
        if (wantRange) {
          const cardExp = parseExpRange(job.experience ?? "");
          if (cardExp && !overlaps(cardExp, wantRange)) {
            skippedByExp++;
            continue;
          }
        }

        // 3. Freshness
        const days = parsePostedDays(job.postedAt ?? "");
        if (days !== null && days > MAX_AGE_DAYS) {
          skippedByAge++;
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
        {
          location: loc,
          extracted: extracted.length,
          kept: keptCount,
          skippedByTitle,
          skippedByExp,
          skippedByAge,
        },
        "Shine search page filtered",
      );
    }

    const jobs = Array.from(combined.values());
    logger.info(
      { count: jobs.length, keywords, location },
      "Shine jobs after filter",
    );
    return jobs;
  };

  // ── applyToJob ──────────────────────────────────────────
  const applyToJob = async (job: JobCard): Promise<ApplyResult> => {
    if (!context || !page) throw new Error("Platform not initialized");

    const jobPage = await context.newPage();

    const runFlow = async (): Promise<ApplyResult> => {
      const jobShinePage = createShinePage(jobPage);
      await jobShinePage.goto(job.url);

      if (await jobShinePage.isExternalApplyPage()) {
        logger.info({ jobId: job.jobId }, "Shine external apply");
        await sendJobToSlack(job, "external").catch(() => {});
        return {
          success: false,
          job,
          alreadyApplied: true,
          metadata: { stage: "external-apply-sent-to-slack" },
        };
      }

      const result = await jobShinePage.handleSimpleApply(job);

      if (result.success) {
        await sendJobToSlack(job, "applied").catch(() => {});
        return {
          success: true,
          job,
          metadata: { ...result.metadata, stage: "application-submitted" },
        };
      }

      return {
        success: false,
        job,
        error: result.message,
        metadata: result.metadata,
      };
    };

    const timeoutPromise = new Promise<ApplyResult>((resolve) =>
      setTimeout(() => {
        logger.warn({ jobId: job.jobId }, "Shine apply timed out");
        resolve({
          success: false,
          job,
          error: `Timed out after ${APPLY_TIMEOUT_MS / 1000}s`,
          metadata: { stage: "timeout" },
        });
      }, APPLY_TIMEOUT_MS),
    );

    try {
      return await Promise.race([runFlow(), timeoutPromise]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, jobId: job.jobId }, "Shine apply threw");
      return {
        success: false,
        job,
        error: message,
        metadata: { stage: "unexpected-error" },
      };
    } finally {
      await jobPage.close().catch(() => {});
      await page!.bringToFront().catch(() => {});
    }
  };

  const run = createRun(searchJobs, applyToJob);

  return {
    name,
    baseUrl: HOME_URL,
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
    get shinePage() {
      if (!shinePage) throw new Error("Call init() before accessing shinePage");
      return shinePage;
    },
  };
};
 