import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { createHumanBehavior } from "../../core/human-behavior.js";
import { createFormSolver } from "../../engine/form-solver.js";
import { loadProfile } from "../../config/profile.js";
import { WellfoundSelectors as S } from "./selectors.js";
import { logger } from "../../utils/logger.js";
import { sendExternalJobToSlack } from "../../utils/slack.js";
import type { JobCard } from "../base/types.js";

export interface ExtractedWellfoundJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
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

export interface SearchOptions {
  location?: string;
}

export const createWellfoundPage = (page: Page) => {
  const human = createHumanBehavior(page);
  let lastSearchUrl: string | undefined;

  // ── low-level helpers ─────────────────────────────
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
  const goToHome = () => goto("https://wellfound.com");
  const goToLogin = () => goto("https://wellfound.com/login");
  const goToJobs = () => goto("https://wellfound.com/jobs");

  const isLoggedIn = async (): Promise<boolean> => {
    const selectors = [
      S.profileIcon,
      S.userName,
      'a[href*="/profile"]',
    ];
    for (const selector of selectors) {
      if (await isVisible(selector, 4000)) return true;
    }
    return false;
  };

  const fillLogin = async (email: string, password: string): Promise<void> => {
    await human.humanType('input[type="email"]', email);
    await human.humanType('input[type="password"]', password);
    await human.humanClick('button[type="submit"]');
  };

  // ── search ──────────────────────────────────────────────
  const search = async (keywords: string, options: SearchOptions = {}): Promise<void> => {
    const { location } = options;

    // Wellfound uses URL params for search
    const searchUrl = new URL("https://wellfound.com/jobs");
    if (keywords) searchUrl.searchParams.set("q", keywords);
    if (location) searchUrl.searchParams.set("l", location);

    logger.info({ url: searchUrl.toString(), keywords, location }, "Opening Wellfound search");
    lastSearchUrl = searchUrl.toString();
    await goto(searchUrl.toString());

    // Wait for job cards to appear
    await page.locator(S.jobCard).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
    await human.randomDelay(2000, 3500);

    const cards = page.locator(S.jobCard);
    const cardsVisible = await cards.first().isVisible({ timeout: 10_000 }).catch(() => false);

    if (cardsVisible) {
      logger.info({ count: await cards.count(), keywords, location }, "Wellfound results loaded");
      return;
    }

    // Error handling
    const bodyText = ((await page.locator("body").textContent().catch(() => "")) || "").toLowerCase();
    await screenshot("wellfound-search-no-results");

    if (bodyText.includes("captcha") || bodyText.includes("verify you are human")) {
      throw new Error("Wellfound blocked the search page or requested CAPTCHA");
    }
    if (bodyText.includes("no jobs found") || bodyText.includes("no results")) {
      logger.warn({ keywords, location }, "Wellfound returned no matching jobs");
      return;
    }

    throw new Error(`Wellfound job cards did not appear. URL: ${page.url()}`);
  };

  // ── extract ─────────────────────────────────────────────
  const extractJobCards = async (limit = 30): Promise<ExtractedWellfoundJob[]> => {
    const cards = page.locator(S.jobCard);
    const total = await cards.count().catch(() => 0);
    if (total === 0) return [];
    const take = Math.min(total, limit);

    const raw = await cards.evaluateAll((els, take) => {
      const slice = els.slice(0, take as number);
      const text = (parent: Element, sel: string): string => {
        const el = parent.querySelector(sel);
        return el ? (el.textContent || "").trim() : "";
      };

      return slice.map((el) => {
        const link = el.querySelector('a[data-test="JobTitle"]') as HTMLAnchorElement | null;
        return {
          title: (link?.textContent || "").trim(),
          href: link?.getAttribute("href") || "",
          company: text(el, 'a[data-test="CompanyName"]'),
          location: text(el, 'span[data-test="Location"]'),
        };
      });
    }, take);

    const jobs: ExtractedWellfoundJob[] = [];
    for (const card of raw) {
      if (!card.title || !card.href) continue;
      const fullUrl = card.href.startsWith("http")
        ? card.href
        : `https://wellfound.com${card.href}`;
      
      // Wellfound URL structure: /jobs/12345-job-title
      const jobIdMatch = fullUrl.match(/\/jobs\/(\d+)/);
      const jobId = jobIdMatch ? jobIdMatch[1] : fullUrl;

      jobs.push({
        jobId,
        title: card.title,
        company: card.company,
        location: card.location,
        url: fullUrl,
      });
    }
    return jobs;
  };

  // ── apply flow ──────────────────────────────────────────
  const isAlreadyApplied = async (): Promise<boolean> => {
    const text = page.getByText(/already applied|you applied/i).first();
    if (await text.isVisible({ timeout: 3000 }).catch(() => false)) return true;
    const appliedBtn = page.locator(S.alreadyApplied).first();
    return appliedBtn.isVisible({ timeout: 1500 }).catch(() => false);
  };

  const isExternalApplyPage = async (): Promise<boolean> => {
    const externalBtn = page.locator(S.externalApplyButton).first();
    if (await externalBtn.isVisible({ timeout: 3000 }).catch(() => false)) return true;
    
    const bodyText = ((await page.locator("body").textContent().catch(() => "")) || "").toLowerCase();
    return bodyText.includes("apply on company site") || bodyText.includes("apply on company website");
  };

  const handleModalQuestions = async (job: JobCard): Promise<SimpleApplyResult> => {
    const modal = page.locator(S.modalOverlay).first();
    if (!await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
      return { success: false, message: "No modal detected" };
    }

    logger.info({ jobId: job.jobId }, "Wellfound application modal detected");
    const profile = loadProfile();
    const solver = createFormSolver(page, profile);

    // Solve the questions inside the modal
    const result = await solver.solveCommonQuestions(10);
    
    // Try to submit
    const submitBtn = page.locator(S.modalSubmit).first();
    if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.click();
      await human.randomDelay(2000, 4000);
      
      const success = await page.getByText(/application submitted|successfully applied/i).isVisible({ timeout: 5000 }).catch(() => false);
      if (success) {
        return { success: true, message: "Applied successfully via modal" };
      }
    }

    return { 
      success: false, 
      message: "Modal questions need manual review",
      metadata: { unanswered: result.unansweredQuestions }
    };
  };

  const handleSimpleApply = async (job: JobCard): Promise<SimpleApplyResult> => {
    const startedAt = new Date().toISOString();
    const steps: ApplyStep[] = [];

    // 1. Check if already applied
    if (await isAlreadyApplied()) {
      return {
        success: false,
        message: "Already applied",
        metadata: { startedAt, steps: [{ step: "already-applied", at: new Date().toISOString() }] },
      };
    }

    // 2. Check for external apply
    if (await isExternalApplyPage()) {
      logger.info({ jobId: job.jobId }, "External apply page — sending to Slack");
      await sendExternalJobToSlack(job);
      return {
        success: false,
        message: "External company application required; sent to Slack",
        metadata: { startedAt, stage: "external-apply-sent-to-slack" },
      };
    }

    // 3. Click Apply
    const applyBtn = page.locator(S.applyButton).first();
    if (await applyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await applyBtn.click();
      steps.push({ step: "apply-clicked", at: new Date().toISOString() });
      await human.randomDelay(2000, 4000);
    } else {
      return {
        success: false,
        message: "Apply button not found",
        metadata: { startedAt, steps: [{ step: "apply-button-missing", at: new Date().toISOString() }] },
      };
    }

    // 4. Check for immediate success
    if (await page.getByText(/application submitted|successfully applied/i).isVisible({ timeout: 5000 }).catch(() => false)) {
      return {
        success: true,
        message: "Applied successfully using one-click apply",
        metadata: { startedAt, steps: [...steps, { step: "success-message", at: new Date().toISOString() }] },
      };
    }

    // 5. Handle Modal Questions
    const modalResult = await handleModalQuestions(job);
    if (modalResult.success) {
      return {
        success: true,
        message: modalResult.message,
        metadata: { startedAt, steps: [...steps, { step: "modal-submitted", at: new Date().toISOString() }] },
      };
    }

    // 6. Check for external redirect after click
    if (await isExternalApplyPage()) {
      logger.info({ jobId: job.jobId }, "External redirect detected — sending to Slack");
      await sendExternalJobToSlack(job);
      return {
        success: false,
        message: "External company page detected; sent to Slack",
        metadata: { startedAt, stage: "external-apply-sent-to-slack" },
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
    isAlreadyApplied,
    isExternalApplyPage,
    handleSimpleApply,
  };
};