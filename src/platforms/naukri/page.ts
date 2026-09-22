import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { createHumanBehavior } from "../../core/human-behavior.js";
import { createFormSolver } from "../../engine/form-solver.js";
import { loadProfile } from "../../config/profile.js";
import {  selectExperienceOnNaukri,selectFreshnessOnNaukri, selectExperienceSliderOnNaukri, selectExperienceFromTopDropdown } from "./ui.js";


import { NaukriSelectors as S } from "./selectors.js";
import { logger } from "../../utils/logger.js";
import { sendExternalJobToSlack } from "../../utils/slack.js";
import type { JobCard } from "../base/types.js";

export interface ExtractedNaukriJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  experience?: string;   // e.g. "2-5 Yrs"
  postedAt?: string;     // e.g. "1 day ago", "3+ weeks ago"
}

export interface ApplyStep {
  step: string;
  at: string;
  delayMs?: number;
}

export interface SimpleApplyResult {
  success: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface RecruiterFlowResult {
  detected: boolean;
  completed: boolean;
  answered: number;
  unansweredQuestions: string[];
}

export interface SearchOptions {
  location?: string;
  minExp?: number;
  maxExp?: number;
  jobAge?: number;
  useUiExperience?: boolean;
   useUiFreshness?: boolean;   // ← new
}

export type NaukriPage = ReturnType<typeof createNaukriPage>;

export const createNaukriPage = (page: Page) => {
  const human = createHumanBehavior(page);
  let lastSearchUrl: string | undefined;

  // ── low-level helpers (previously BasePage) ─────────────
  const goto = async (url: string): Promise<void> => {
    logger.debug({ url }, "Navigating");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await human.randomDelay(1500, 3200);
  };

  const isVisible = async (selector: string, timeout = 5000): Promise<boolean> => {
    try {
      await page.locator(selector).waitFor({ state: "visible", timeout });
      return true;
    } catch {
      return false;
    }
  };

  const screenshot = async (name: string): Promise<string> => {
    const dir = path.resolve(process.cwd(), "storage", "screenshots");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  };

  // ── navigation ──────────────────────────────────────────
  const goToHome = () => goto("https://www.naukri.com");
  const goToLogin = () => goto("https://www.naukri.com/nlogin/login");
  const goToJobs = () => goto("https://www.naukri.com/jobs-in-india");

  const isLoggedIn = async (): Promise<boolean> => {
    const selectors = [
      S.profileIcon,
      S.userName,
      'a[href*="mnjuser/profile"]',
      '[data-type="userProfile"]',
    ];
    for (const selector of selectors) {
      if (await isVisible(selector, 4000)) return true;
    }
    return false;
  };

  const fillLogin = async (email: string, password: string): Promise<void> => {
    await human.humanType(S.loginEmail, email);
    await human.humanType(S.loginPassword, password);
    await human.humanClick(S.loginSubmit);
  };

  // ── search ──────────────────────────────────────────────
//   const search = async (keywords: string, options: SearchOptions = {}): Promise<void> => {
//     const { location, minExp = 1, maxExp = 4, jobAge = 3, useUiExperience = false } = options;

//     const cleanKeywordForSlug = keywords
//       .replace(/[\(\)"']/g, "")
//       .replace(/\b(AND|OR|NOT)\b/gi, " ")
//       .replace(/\s+/g, " ")
//       .trim();

//     const keywordSlug =
//       cleanKeywordForSlug
//         .toLowerCase()
//         .replace(/[^a-z0-9]+/g, "-")
//         .replace(/^-+|-+$/g, "") || "jobs";

//     const locationSlug = location
//       ? location
//           .toLowerCase()
//           .trim()
//           .replace(/[^a-z0-9]+/g, "-")
//           .replace(/^-+|-+$/g, "")
//       : "";

//     const pathname = locationSlug
//       ? `${keywordSlug}-jobs-in-${locationSlug}`
//       : `${keywordSlug}-jobs`;

//     // const searchUrl = new URL(`https://www.naukri.com/${pathname}`);
//     // searchUrl.searchParams.set("k", keywords);
//     // if (location) searchUrl.searchParams.set("l", location);
//     // searchUrl.searchParams.set("jobAge", jobAge.toString());
//     // searchUrl.searchParams.set("sortBy", "day");
//     // searchUrl.searchParams.set("experience", minExp.toString());
//     // searchUrl.searchParams.set("expMin", minExp.toString());
//     // searchUrl.searchParams.set("expMax", maxExp.toString());
//     const searchUrl = new URL(`https://www.naukri.com/${pathname}`);
//     searchUrl.searchParams.set("k", keywords);
//     if (location) searchUrl.searchParams.set("l", location);

//     // Freshness — Naukri accepts 1, 3, 7, 15, 30
//     searchUrl.searchParams.set("jobAge", String(jobAge));

//     // Date sort — the ONLY valid values are r / d / p.
//     // "day" was silently ignored and broke the freshness filter on some pages.
//     searchUrl.searchParams.set("sortBy", "d");

//     searchUrl.searchParams.set("experience", String(minExp));
//     searchUrl.searchParams.set("expMin", String(minExp));
//     searchUrl.searchParams.set("expMax", String(maxExp));

//     logger.info({ url: searchUrl.toString(), keywords, location }, "Opening Naukri search");
//     lastSearchUrl = searchUrl.toString();
//     await goto(searchUrl.toString());

//     if (useUiExperience) {
//       await selectExperienceOnNaukri(page, minExp).catch(() => {});
//       await human.randomDelay(800, 1500);
//     }
//     await human.randomDelay(2500, 4500);

//     const cards = page.locator(S.jobCard);
//     const cardsVisible = await cards.first().isVisible({ timeout: 20_000 }).catch(() => false);

//     if (cardsVisible) {
//       logger.info({ count: await cards.count(), keywords, location }, "Naukri results loaded");
//       return;
//     }

//     const currentUrl = page.url();
//     const bodyText = ((await page.locator("body").textContent().catch(() => "")) || "").toLowerCase();
//     await screenshot("naukri-search-no-results");

//     if (currentUrl.includes("/login") || currentUrl.includes("/nlogin")) {
//       throw new Error("Naukri redirected to login while opening search results");
//     }
//     if (
//       bodyText.includes("captcha") ||
//       bodyText.includes("verify you are human") ||
//       bodyText.includes("unusual activity")
//     ) {
//       throw new Error("Naukri blocked the search page or requested CAPTCHA");
//     }
//     if (bodyText.includes("no jobs found") || bodyText.includes("no results found")) {
//       logger.warn({ keywords, location }, "Naukri returned no matching jobs");
//       return;
//     }

//     throw new Error(`Naukri job cards did not appear. URL: ${currentUrl}`);
//   };

// ── search ──────────────────────────────────────────────
const search = async (keywords: string, options: SearchOptions = {}): Promise<void> => {
  const {
    location,
    minExp = 2,
    maxExp = 4,
    jobAge = 3,
    useUiExperience = true,
    useUiFreshness = true,
  } = options;

  const cleanKeywordForSlug = keywords
    .replace(/[\(\)"']/g, "")
    .replace(/\b(AND|OR|NOT)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const keywordSlug =
    cleanKeywordForSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "jobs";

  const locationSlug = location
    ? location
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    : "";

  const pathname = locationSlug
    ? `${keywordSlug}-jobs-in-${locationSlug}`
    : `${keywordSlug}-jobs`;

  const searchUrl = new URL(`https://www.naukri.com/${pathname}`);
  searchUrl.searchParams.set("k", keywords);
  if (location) searchUrl.searchParams.set("l", location);
  searchUrl.searchParams.set("jobAge", String(jobAge));
  searchUrl.searchParams.set("sortBy", "d");
  searchUrl.searchParams.set("experience", String(minExp));
  searchUrl.searchParams.set("expMin", String(minExp));
  searchUrl.searchParams.set("expMax", String(maxExp));

  logger.info(
    { url: searchUrl.toString(), keywords, location },
    "Opening Naukri search",
  );
  lastSearchUrl = searchUrl.toString();

  // Fast timeout wrapper so a stuck page never blocks the whole run
  const withTimeout = async <T>(
    work: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T | undefined> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            logger.warn({ label, ms }, "Search step timed out");
            resolve(undefined);
          }, ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  await goto(searchUrl.toString());

  // ── UI FILTER APPLICATION ───────────────────────────────────
  // Each step has its own 25s cap so a broken filter can't hang the run.
  if (useUiFreshness) {
    await withTimeout(
      selectFreshnessOnNaukri(page, jobAge as 1 | 3 | 7 | 15 | 30),
      25_000,
      "freshness filter",
    );
    await human.randomDelay(1200, 2000);
  }

//   if (useUiExperience) {
//     // Use the top-bar dropdown (minExp).
//     await withTimeout(
//       selectExperienceFromTopDropdown(page, minExp),
//       25_000,
//       "experience dropdown",
//     );
//     await human.randomDelay(1200, 2000);
//   }
  if (useUiExperience) {
    // ── PRIMARY: SRP left-sidebar filter ────────────────────
    const beforeUrl = page.url();
    let srpChanged = false;

    if (typeof selectExperienceSliderOnNaukri === "function") {
      srpChanged = await withTimeout(
        selectExperienceSliderOnNaukri(page, minExp).then((ok) => Boolean(ok)),
        25_000,
        "srp experience filter",
      ) as boolean;
    }

    // If SRP didn't cause a URL change, it silently failed — fall back.
    const urlAfterSrp = page.url();
    const srpReallyWorked = srpChanged && urlAfterSrp !== beforeUrl;

    if (!srpReallyWorked) {
      logger.info(
        { minExp },
        "SRP experience filter did not take effect — falling back to top dropdown",
      );
      await withTimeout(
        selectExperienceFromTopDropdown(page, minExp),
        25_000,
        "top experience dropdown",
      );
    } else {
      logger.info({ minExp }, "SRP experience filter applied");
    }

    await human.randomDelay(1200, 2000);
  }
  // Wait for results to settle
  await withTimeout(
    page
      .locator(S.jobCard)
      .first()
      .waitFor({ state: "visible", timeout: 18_000 }),
    20_000,
    "job-card wait",
  );
  await human.randomDelay(2000, 3200);

  const cards = page.locator(S.jobCard);
  const cardsVisible = await cards
    .first()
    .isVisible({ timeout: 12_000 })
    .catch(() => false);

  if (cardsVisible) {
    logger.info(
      { count: await cards.count(), keywords, location },
      "Naukri results loaded",
    );
    return;
  }

  const currentUrl = page.url();
  const bodyText = (
    (await page.locator("body").textContent().catch(() => "")) || ""
  ).toLowerCase();
  await screenshot("naukri-search-no-results");

  if (currentUrl.includes("/login") || currentUrl.includes("/nlogin")) {
    throw new Error("Naukri redirected to login while opening search results");
  }
  if (
    bodyText.includes("captcha") ||
    bodyText.includes("verify you are human") ||
    bodyText.includes("unusual activity")
  ) {
    throw new Error("Naukri blocked the search page or requested CAPTCHA");
  }
  if (bodyText.includes("no jobs found") || bodyText.includes("no results found")) {
    logger.warn({ keywords, location }, "Naukri returned no matching jobs");
    return;
  }

  throw new Error(`Naukri job cards did not appear. URL: ${currentUrl}`);
};
// ── search ──────────────────────────────────────────────
// const search = async (keywords: string, options: SearchOptions = {}): Promise<void> => {
//   const {
//     location,
//     minExp = 1,
//     maxExp = 4,
//     jobAge = 3,
//     useUiExperience = true,   // ← default on
//     useUiFreshness = true,    // ← new flag
//   } = options;

//   const cleanKeywordForSlug = keywords
//     .replace(/[\(\)"']/g, "")
//     .replace(/\b(AND|OR|NOT)\b/gi, " ")
//     .replace(/\s+/g, " ")
//     .trim();

//   const keywordSlug =
//     cleanKeywordForSlug
//       .toLowerCase()
//       .replace(/[^a-z0-9]+/g, "-")
//       .replace(/^-+|-+$/g, "") || "jobs";

//   const locationSlug = location
//     ? location
//         .toLowerCase()
//         .trim()
//         .replace(/[^a-z0-9]+/g, "-")
//         .replace(/^-+|-+$/g, "")
//     : "";

//   const pathname = locationSlug
//     ? `${keywordSlug}-jobs-in-${locationSlug}`
//     : `${keywordSlug}-jobs`;

//   const searchUrl = new URL(`https://www.naukri.com/${pathname}`);
//   searchUrl.searchParams.set("k", keywords);
//   if (location) searchUrl.searchParams.set("l", location);
//   searchUrl.searchParams.set("jobAge", String(jobAge));
//   searchUrl.searchParams.set("sortBy", "d");
//   searchUrl.searchParams.set("experience", String(minExp));
//   searchUrl.searchParams.set("expMin", String(minExp));
//   searchUrl.searchParams.set("expMax", String(maxExp));

//   logger.info({ url: searchUrl.toString(), keywords, location }, "Opening Naukri search");
//   lastSearchUrl = searchUrl.toString();
//   await goto(searchUrl.toString());

//   // ── UI FILTER FALLBACK ─────────────────────────────────────
//   // URL params are best-effort on Naukri. Click the real SRP controls so
//   // the server-side filter is definitely applied before we scrape.
//   if (useUiFreshness) {
//     await selectFreshnessOnNaukri(page, jobAge as 1 | 3 | 7 | 15 | 30);
//     await human.randomDelay(1500, 2500);
//   }

//   if (useUiExperience) {
//     await selectExperienceSliderOnNaukri(page, minExp);
//     await human.randomDelay(1500, 2500);
//   }

//   // Belt-and-suspenders: also try the top-bar dropdown helper you already had
//   if (useUiExperience) {
//     await selectExperienceOnNaukri(page, minExp).catch(() => {});
//     await human.randomDelay(800, 1500);
//   }

//   // Wait for the job card list to settle
//   await page
//     .locator(S.jobCard)
//     .first()
//     .waitFor({ state: "visible", timeout: 20_000 })
//     .catch(() => {});
//   await human.randomDelay(2000, 3500);

//   const cards = page.locator(S.jobCard);
//   const cardsVisible = await cards
//     .first()
//     .isVisible({ timeout: 20_000 })
//     .catch(() => false);

//   if (cardsVisible) {
//     logger.info(
//       { count: await cards.count(), keywords, location },
//       "Naukri results loaded",
//     );
//     return;
//   }

//   const currentUrl = page.url();
//   const bodyText = (
//     (await page.locator("body").textContent().catch(() => "")) || ""
//   ).toLowerCase();
//   await screenshot("naukri-search-no-results");

//   if (currentUrl.includes("/login") || currentUrl.includes("/nlogin")) {
//     throw new Error("Naukri redirected to login while opening search results");
//   }
//   if (
//     bodyText.includes("captcha") ||
//     bodyText.includes("verify you are human") ||
//     bodyText.includes("unusual activity")
//   ) {
//     throw new Error("Naukri blocked the search page or requested CAPTCHA");
//   }
//   if (bodyText.includes("no jobs found") || bodyText.includes("no results found")) {
//     logger.warn({ keywords, location }, "Naukri returned no matching jobs");
//     return;
//   }

//   throw new Error(`Naukri job cards did not appear. URL: ${currentUrl}`);
// };

  const extractJobId = (url: string): string => {
    const queryId = new URL(url, "https://www.naukri.com").searchParams.get("jobId");
    if (queryId) return queryId;

    const numeric = url.match(/(?:jobId=|job-listings-[^/]*-)(\d{8,})/i);
    if (numeric?.[1]) return numeric[1];

    const ending = url.match(/(\d{8,})(?:[/?#]|$)/);
    return ending?.[1] || url;
  };

//   const extractJobCards = async (limit = 20): Promise<ExtractedNaukriJob[]> => {
//     const cards = page.locator(S.jobCard);
//     const count = Math.min(await cards.count(), limit);
//     const jobs: ExtractedNaukriJob[] = [];

//     for (let i = 0; i < count; i++) {
//       const card = cards.nth(i);
//       try {
//         const title = ((await card.locator(S.jobTitle).first().textContent()) || "").trim();
//         const company = ((await card.locator(S.jobCompany).first().textContent().catch(() => "")) || "").trim();
//         const location = ((await card.locator(S.jobLocation).first().textContent().catch(() => "")) || "").trim();
//         const href = await card.locator(S.jobLink).first().getAttribute("href");
//         if (!title || !href) continue;

//         const fullUrl = href.startsWith("http") ? href : `https://www.naukri.com${href}`;
//         const dataJobId = await card.getAttribute("data-job-id");

//         jobs.push({
//           jobId: (dataJobId?.trim() || extractJobId(fullUrl)) as string,
//           title,
//           company,
//           location,
//           url: fullUrl,
//         });
//       } catch (err) {
//         logger.debug({ i, err }, "Skipping invalid job card");
//       }
//     }
//     return jobs;
//   };

  // ── apply flow ──────────────────────────────────────────
  
const extractJobCards = async (limit = 30): Promise<ExtractedNaukriJob[]> => {
  const cards = page.locator(S.jobCard);
  const total = await cards.count().catch(() => 0);
  if (total === 0) return [];
  const take = Math.min(total, limit);

  // One round-trip for all cards — ~10x faster than per-card awaits.
  const raw = await cards.evaluateAll((els, take) => {
    const slice = els.slice(0, take as number);
    const text = (parent: Element, sel: string): string => {
      const el = parent.querySelector(sel);
      return el ? (el.textContent || "").trim() : "";
    };

    return slice.map((el) => {
      const link = el.querySelector(
        'a.title, .title, .row1 a',
      ) as HTMLAnchorElement | null;
      return {
        title: (link?.textContent || "").trim(),
        href: link?.getAttribute("href") || "",
        company: text(el, ".comp-name"),
        location: text(el, ".locWdth"),
        experience: text(el, ".expwdth"),
        postedAt: text(el, ".job-post-day"),
        dataJobId: el.getAttribute("data-job-id") || "",
      };
    });
  }, take);

  const jobs: ExtractedNaukriJob[] = [];
  for (const card of raw) {
    if (!card.title || !card.href) continue;
    const fullUrl = card.href.startsWith("http")
      ? card.href
      : `https://www.naukri.com${card.href}`;
    jobs.push({
      jobId: card.dataJobId.trim() || extractJobId(fullUrl),
      title: card.title,
      company: card.company,
      location: card.location,
      url: fullUrl,
      experience: card.experience,
      postedAt: card.postedAt,
    });
  }
  return jobs;
};


  const clickApplyButton = async (): Promise<boolean> => {
    const btn = page.locator(S.applyButton).first();
    if (await btn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await btn.hover();
      await human.randomDelay(200, 600);
      await btn.click();
      await human.randomDelay(1500, 3000);
      return true;
    }

    const chatBtn = page.locator(S.chatApplyButton).first();
    if (await chatBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await chatBtn.hover();
      await human.randomDelay(200, 600);
      await chatBtn.click();
      await human.randomDelay(1500, 3000);
      return true;
    }
    return false;
  };

  const isAlreadyApplied = async (): Promise<boolean> => {
    const text = page.getByText(/already applied|application sent|you applied on/i).first();
    if (await text.isVisible({ timeout: 3000 }).catch(() => false)) return true;

    const appliedBtn = page.getByRole("button", { name: /^applied$/i }).first();
    return appliedBtn.isVisible({ timeout: 1500 }).catch(() => false);
  };

  const isSuccessVisible = async (timeout = 3000): Promise<boolean> => {
    const success = page
      .getByText(
        /application submitted|applied successfully|successfully applied|thank you for applying|application sent|applied to/i,
      )
      .first();
    return success.isVisible({ timeout }).catch(() => false);
  };

  const isApplyConfirmationPage = (): boolean => {
    const url = page.url().toLowerCase();
    return url.includes("/myapply/saveapply") || url.includes("/myapply/showacp");
  };

  const isRecruiterFlowVisible = async (timeout = 3000): Promise<boolean> => {
    const selectors = [
      ".chatbot-modal",
      ".recruiter-chat",
      ".question-modal",
      ".chatbot_Overlay",
      'div[role="dialog"]',
      'div[class*="chatbot"]',
      'textarea[placeholder*="message" i]',
    ].join(", ");

    const elements = page.locator(selectors);
    const count = await elements.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      if (await elements.nth(i).isVisible({ timeout }).catch(() => false)) return true;
    }
    return false;
  };

  const isExternalApplyPage = async (): Promise<boolean> => {
    const url = page.url().toLowerCase();
    if (url.includes("/myapply/showacp") || !url.includes("naukri.com")) return true;

    const externalBtn = page
      .locator(
        'button:has-text("Apply on company site"), button:has-text("Apply on company website")',
      )
      .first();
    if (await externalBtn.isVisible({ timeout: 1000 }).catch(() => false)) return true;

    const bodyText = ((await page.locator("body").textContent().catch(() => "")) || "").toLowerCase();
    return (
      bodyText.includes("apply on company site") ||
      bodyText.includes("apply on company website") ||
      bodyText.includes("company website for completing your job application")
    );
  };

  const clickBackToSearchFromConfirmation = async (): Promise<boolean> => {
    const back = page
      .locator(
        'a:has-text("Back to search"), button:has-text("Back to search"), a:has-text("See more jobs")',
      )
      .first();
    if (await back.isVisible({ timeout: 1500 }).catch(() => false)) {
      await back.click();
      await page.waitForLoadState("networkidle").catch(() => {});
      await human.randomDelay(1500, 3000);
      return true;
    }
    return false;
  };

  const navigateAfterApply = async (): Promise<void> => {
    if (!lastSearchUrl) return;
    const url = page.url().toLowerCase();
    if (!url.includes("/myapply/saveapply") && !url.includes("/myapply/showacp")) return;

    if (await clickBackToSearchFromConfirmation()) return;
    await goto(lastSearchUrl);
    await human.randomDelay(1500, 3000);
  };

  const waitForRecruiterQuestionIfVisible = async (): Promise<RecruiterFlowResult> => {
    const detected = await isRecruiterFlowVisible(12_000);
    if (!detected) {
      return { detected: false, completed: false, answered: 0, unansweredQuestions: [] };
    }

    logger.info("Recruiter Q&A detected");
    const profile = loadProfile();
    const solver = createFormSolver(page, profile);

    await solver.uploadResumeIfNeeded();
    const result = await solver.solveCommonQuestions(20);
    const completed = result.completed || (await isSuccessVisible(3000));

    logger.info({ answered: result.answered, completed }, "Recruiter Q&A finished");
    return {
      detected: true,
      completed,
      answered: result.answered,
      unansweredQuestions: result.unansweredQuestions,
    };
  };

  const processRecruiterFlow = async (
    startedAt: string,
    steps: ApplyStep[],
  ): Promise<SimpleApplyResult | null> => {
    const recruiterResult = await waitForRecruiterQuestionIfVisible();
    if (!recruiterResult.detected) return null;

    if (recruiterResult.completed || (await isSuccessVisible(3000))) {
      await navigateAfterApply();
      return {
        success: true,
        message: "Applied successfully after recruiter Q&A",
        metadata: {
          startedAt,
          answeredQuestions: recruiterResult.answered,
          steps: [...steps, { step: "recruiter-questions-completed", at: new Date().toISOString() }],
        },
      };
    }

    if (isApplyConfirmationPage()) {
      await navigateAfterApply();
      return {
        success: false,
        message: "Confirmation page reached but success text missing after Q&A",
        metadata: {
          startedAt,
          answeredQuestions: recruiterResult.answered,
          steps: [...steps, { step: "confirmation-no-success", at: new Date().toISOString() }],
        },
      };
    }

    const stillVisible = await isRecruiterFlowVisible(2000);
    if (recruiterResult.unansweredQuestions.length > 0 || stillVisible) {
      return {
        success: false,
        message: "Recruiter questions require manual review",
        metadata: {
          startedAt,
          manualReview: true,
          answeredQuestions: recruiterResult.answered,
          unansweredQuestions: recruiterResult.unansweredQuestions,
          steps: [...steps, { step: "recruiter-manual-review", at: new Date().toISOString() }],
        },
      };
    }
    return null;
  };

  const handleSimpleApply = async (job: JobCard): Promise<SimpleApplyResult> => {
    const startedAt = new Date().toISOString();
    const steps: ApplyStep[] = [];

    if (await isAlreadyApplied()) {
      return {
        success: false,
        message: "Already applied",
        metadata: { startedAt, steps: [{ step: "already-applied", at: new Date().toISOString() }] },
      };
    }

    if (await isExternalApplyPage()) {
      logger.info({ jobId: job.jobId }, "External apply page — sending to Slack");
      await sendExternalJobToSlack(job);
      return {
        success: false,
        message: "External company application required; sent to Slack",
        metadata: { startedAt, stage: "external-apply-sent-to-slack" },
      };
    }

    const clicked = await clickApplyButton();
    if (!clicked) {
      return {
        success: false,
        message: "Apply button not found",
        metadata: { startedAt, steps: [{ step: "apply-button-missing", at: new Date().toISOString() }] },
      };
    }
    steps.push({ step: "apply-clicked", at: new Date().toISOString() });
    steps[steps.length - 1].delayMs = await human.randomDelay(2500, 5000);

    if (await isSuccessVisible(5000)) {
      await navigateAfterApply();
      return {
        success: true,
        message: "Applied successfully using one-click apply",
        metadata: { startedAt, steps: [...steps, { step: "success-message", at: new Date().toISOString() }] },
      };
    }

    if (isApplyConfirmationPage()) {
      await navigateAfterApply();
      return {
        success: true,
        message: "Application reached confirmation page",
        metadata: { startedAt, steps: [...steps, { step: "confirmation-page", at: new Date().toISOString() }] },
      };
    }

    const recruiterResult = await processRecruiterFlow(startedAt, steps);
    if (recruiterResult) return recruiterResult;

    if (await isExternalApplyPage()) {
      logger.info({ jobId: job.jobId }, "External redirect detected — sending to Slack");
      await sendExternalJobToSlack(job);
      return {
        success: false,
        message: "External company page detected; sent to Slack",
        metadata: { startedAt, stage: "external-apply-sent-to-slack" },
      };
    }

    for (let i = 0; i < 6; i++) {
      if (await isSuccessVisible(1500)) {
        return {
          success: true,
          message: "Application submitted",
          metadata: { startedAt, steps: [...steps, { step: "success-message", at: new Date().toISOString() }] },
        };
      }

      const rec = await processRecruiterFlow(startedAt, steps);
      if (rec) return rec;

      const submit = page.locator(S.submitButton).first();
      if (await submit.isVisible({ timeout: 1500 }).catch(() => false)) {
        steps.push({ step: "submit-clicked", at: new Date().toISOString() });
        await submit.hover();
        await human.randomDelay(200, 500);
        await submit.click();
        steps[steps.length - 1].delayMs = await human.randomDelay(2500, 5000);
        if (await isSuccessVisible(6000)) {
          return {
            success: true,
            message: "Application submitted",
            metadata: { startedAt, steps: [...steps, { step: "final-success", at: new Date().toISOString() }] },
          };
        }
        continue;
      }

      const cont = page.locator(S.continueButton).first();
      if (await cont.isVisible({ timeout: 1500 }).catch(() => false)) {
        steps.push({ step: "continue-clicked", at: new Date().toISOString() });
        await cont.hover();
        await human.randomDelay(200, 500);
        await cont.click();
        steps[steps.length - 1].delayMs = await human.randomDelay(1800, 3500);
        continue;
      }
      break;
    }

    if ((await isSuccessVisible(4000)) || isApplyConfirmationPage()) {
      await navigateAfterApply();
      return {
        success: true,
        message: "Application submitted",
        metadata: { startedAt, steps: [...steps, { step: "final-success-check", at: new Date().toISOString() }] },
      };
    }

    const stillVisible = await isRecruiterFlowVisible(2000);
    if (!stillVisible) {
      return {
        success: true,
        message: "Application completed without further modal",
        metadata: { startedAt, steps: [...steps, { step: "flow-closed", at: new Date().toISOString() }] },
      };
    }

    return {
      success: false,
      message: "Application requires manual review",
      metadata: { startedAt, manualReview: true, steps: [...steps, { step: "manual-review", at: new Date().toISOString() }] },
    };
  };

  return {
    page,
    human,
    goto,
    isVisible,
    screenshot,
    goToHome,
    goToLogin,
    goToJobs,
    isLoggedIn,
    fillLogin,
    search,
    extractJobCards,
    clickApplyButton,
    isAlreadyApplied,
    isExternalApplyPage,
    handleSimpleApply,
  };
};