// src/platforms/shine/page.ts

import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { ShineSelectors as S, type ShineFilters } from "./selectors.js";
import { logger } from "../../utils/logger.js";
import { sendExternalJobToSlack } from "../../utils/slack.js";
import type { JobCard } from "../base/types.js";

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
export interface ExtractedShineJob {
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  experience?: string;
  postedAt?: string;
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

export interface ShineSearchOptions {
  location?: string;
  minExp?: number;
  maxExp?: number;
  jobAge?: number;
  filters?: ShineFilters;
}

export type ShinePage = ReturnType<typeof createShinePage>;

// ─────────────────────────────────────────────────────────────
// SHINE PAGE
// ─────────────────────────────────────────────────────────────
export const createShinePage = (page: Page) => {
  let lastSearchUrl: string | undefined;

  // ── Delay helper ────────────────────────────────────────
  const randomDelay = async (min: number, max: number): Promise<number> => {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await page.waitForTimeout(ms);
    return ms;
  };

  // ── Navigation ──────────────────────────────────────────
  const goto = async (url: string): Promise<void> => {
    logger.debug({ url }, "Navigating (Shine)");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await randomDelay(1500, 3000);
  };

  const isVisible = async (
    selector: string,
    timeout = 5000,
  ): Promise<boolean> => {
    try {
      await page.locator(selector).first().waitFor({ state: "visible", timeout });
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

  // ── Sort by "Most recent" via UI ────────────────────────
  const applyMostRecentSort = async (): Promise<boolean> => {
    try {
      logger.info("Applying 'Most recent' sort");

      const trigger = page.locator(S.sortTrigger).first();
      if (!(await trigger.isVisible({ timeout: 6000 }).catch(() => false))) {
        logger.warn("Sort trigger not found");
        return false;
      }

      const currentValue = (
        (await page
          .locator(S.sortTriggerValue)
          .first()
          .textContent()
          .catch(() => "")) || ""
      )
        .trim()
        .toLowerCase();

      if (currentValue.includes("most recent")) {
        logger.info("Sort is already 'Most recent'");
        return true;
      }

      await trigger.scrollIntoViewIfNeeded().catch(() => {});
      await trigger.click();
      await randomDelay(400, 700);

      const panel = page.locator(S.sortPanel).first();
      await panel
        .waitFor({ state: "visible", timeout: 4000 })
        .catch(() => {});

      const mostRecent = page.locator(S.sortOptionMostRecent).first();
      if (!(await mostRecent.isVisible({ timeout: 3000 }).catch(() => false))) {
        logger.warn("'Most recent' option not visible");
        await page.keyboard.press("Escape").catch(() => {});
        return false;
      }

      await mostRecent.click();
      logger.info("Clicked 'Most recent' option");
      await randomDelay(2500, 4000);

      const newValue = (
        (await page
          .locator(S.sortTriggerValue)
          .first()
          .textContent()
          .catch(() => "")) || ""
      )
        .trim()
        .toLowerCase();

      if (newValue.includes("most recent")) {
        logger.info("Sort confirmed: Most recent");
        return true;
      }

      logger.warn({ newValue }, "Sort value did not change to 'Most recent'");
      return false;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to apply 'Most recent' sort",
      );
      return false;
    }
  };

  // ── Apply sidebar filters (with sub-modal handling) ─────
//   const applyFilters = async (filters: ShineFilters): Promise<boolean> => {
//     const wanted: Array<[string, string[] | undefined]> = [
//       ["Location", filters.locations],
//       ["Experience", filters.experiences],
//       ["Salary", filters.salaries],
//       ["Department", filters.departments],
//       ["Industry", filters.industries],
//       ["Employment", filters.employments],
//     ];

//     const anyFilterRequested = wanted.some(
//       ([, values]) => values && values.length > 0,
//     );
//     if (!anyFilterRequested) {
//       logger.info("No Shine filters requested");
//       return false;
//     }

//     logger.info({ filters }, "Opening Shine filter panel");

//     // ── 1. Open sidebar filter panel ───────────────────────
//     const trigger = page.locator(S.filterTrigger).first();
//     if (!(await trigger.isVisible({ timeout: 8000 }).catch(() => false))) {
//       logger.warn("Filter trigger not found");
//       return false;
//     }
//     await trigger.scrollIntoViewIfNeeded().catch(() => {});
//     await trigger.click();
//     await randomDelay(600, 1000);

//     const panel = page.locator(S.filterPanel).first();
//     if (!(await panel.isVisible({ timeout: 6000 }).catch(() => false))) {
//       logger.warn("Filter panel did not open");
//       return false;
//     }

//     // ── 2. Process each requested section ──────────────────
//     for (const [sectionName, values] of wanted) {
//       if (!values || values.length === 0) continue;

//       // Find the section whose heading matches the section name
//       const section = panel
//         .locator(S.filterSection)
//         .filter({
//           has: page.locator(
//             `${S.filterSectionHeader}:text-is("${sectionName}")`,
//           ),
//         })
//         .first();

//       const sectionFound = await section
//         .isVisible({ timeout: 3000 })
//         .catch(() => false);
//       if (!sectionFound) {
//         logger.warn({ section: sectionName }, "Filter section not found");
//         continue;
//       }

//       logger.info({ section: sectionName }, "Opening section sub-modal");

//       // Click the section heading to open the sub-modal
//       const header = section.locator(S.filterSectionHeader).first();
//       await header.scrollIntoViewIfNeeded().catch(() => {});
//       await header.click({ timeout: 3000 }).catch(async () => {
//         // Fallback: click "See all N" if the header isn't clickable
//         const seeAll = section.locator(S.filterSeeAll).first();
//         if (await seeAll.isVisible({ timeout: 1000 }).catch(() => false)) {
//           await seeAll.click();
//         }
//       });

//       await randomDelay(700, 1100);

//       // ── 3. Locate the sub-modal ────────────────────────
//       // Strategy: any visible dialog-like element that contains a "Done"
//       // button and the section name.
//       const doneButtons = page.locator(S.subModalDoneButton);
//       const doneCount = await doneButtons.count().catch(() => 0);

//       let modal: ReturnType<typeof page.locator> | null = null;

//       for (let i = 0; i < doneCount; i++) {
//         const btn = doneButtons.nth(i);
//         if (!(await btn.isVisible({ timeout: 500 }).catch(() => false))) continue;

//         // Walk up from the Done button to find a suitable container
//         const container = btn.locator(
//           'xpath=ancestor::*[self::div or self::section or self::aside][position() <= 6]',
//         );
//         const containerCount = await container.count().catch(() => 0);

//         for (let j = 0; j < containerCount; j++) {
//           const c = container.nth(j);
//           const box = await c.boundingBox().catch(() => null);
//           if (!box) continue;
//           if (box.width < 250 || box.height < 250) continue;
//           // The container should mention the section name
//           const text = (await c.textContent().catch(() => "")) || "";
//           if (text.toLowerCase().includes(sectionName.toLowerCase())) {
//             modal = c;
//             break;
//           }
//         }
//         if (modal) break;
//       }

//       if (!modal) {
//         logger.warn(
//           { section: sectionName },
//           "Sub-modal not found — dumping DOM for debugging",
//         );

//         const debugInfo = await page.evaluate(() => {
//           const out: Array<{ tag: string; cls: string; text: string }> = [];
//           document
//             .querySelectorAll('div, section, aside, [role="dialog"]')
//             .forEach((el) => {
//               const style = window.getComputedStyle(el);
//               if (style.display === "none" || style.visibility === "hidden")
//                 return;
//               const rect = el.getBoundingClientRect();
//               if (rect.width < 250 || rect.height < 250) return;
//               const txt = (el.textContent || "").trim();
//               if (!txt.includes("Done")) return;
//               out.push({
//                 tag: el.tagName,
//                 cls: typeof el.className === "string" ? el.className : "",
//                 text: txt.slice(0, 80),
//               });
//             });
//           return out.slice(0, 10);
//         });
//         logger.info({ debugInfo }, "SUBMODAL DEBUG");

//         // Try Escape to close whatever opened
//         await page.keyboard.press("Escape").catch(() => {});
//         await randomDelay(400, 700);
//         continue;
//       }

//       logger.info({ section: sectionName }, "Sub-modal located");

//       // ── 4. Tick requested values ────────────────────────
//       for (const value of values) {
//         // Try several strategies, in order of specificity
//         const candidates = [
//           // Label containing the exact value text
//           modal.locator(`label:has-text("${value}")`).first(),
//           // Div whose immediate text is the value
//           modal
//             .locator(
//               `div:has(> span:text-is("${value}")), div:has(> div:text-is("${value}"))`,
//             )
//             .first(),
//           // Any element whose exact text is the value
//           modal.locator(`text="${value}"`).first(),
//           // Fallback: any element containing the text
//           modal.locator(`:text-is("${value}")`).first(),
//         ];

//         let clicked = false;
//         for (const cand of candidates) {
//           if (await cand.isVisible({ timeout: 1200 }).catch(() => false)) {
//             await cand.scrollIntoViewIfNeeded().catch(() => {});
//             await cand.click({ timeout: 2500 }).catch(() => {});
//             clicked = true;
//             break;
//           }
//         }

//         if (clicked) {
//           logger.info({ section: sectionName, value }, "Ticked filter option");
//           await randomDelay(300, 550);
//         } else {
//           logger.warn(
//             { section: sectionName, value },
//             "Filter option not found in sub-modal",
//           );
//         }
//       }

//       // ── 5. Click "Done" to close the sub-modal ──────────
//       const doneBtn = modal.locator(S.subModalDoneButton).first();
//       if (await doneBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
//         await doneBtn.click();
//         logger.info({ section: sectionName }, "Clicked 'Done'");
//         await randomDelay(700, 1100);
//       } else {
//         logger.warn({ section: sectionName }, "'Done' button not found");
//         await page.keyboard.press("Escape").catch(() => {});
//         await randomDelay(400, 700);
//       }
//     }

//     // ── 6. Apply filters in the sidebar ────────────────────
//     const panelAfter = page.locator(S.filterPanel).first();
//     const applyBtn = panelAfter.locator(S.filterApplyButton).first();

//     if (await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
//       await applyBtn.click();
//       logger.info("Clicked 'Apply filters'");
//       await randomDelay(2500, 4000);
//       await page
//         .locator(S.jobCard)
//         .first()
//         .waitFor({ state: "visible", timeout: 15_000 })
//         .catch(() => {});
//       return true;
//     }

//     logger.warn("Apply filters button not found — closing panel");
//     await page.keyboard.press("Escape").catch(() => {});
//     return false;
//   };
  // ── Apply sidebar filters (handles both sub-modal and inline pill) ──
  const applyFilters = async (filters: ShineFilters): Promise<boolean> => {
    const wanted: Array<[string, string[] | undefined]> = [
      ["Location", filters.locations],
      ["Experience", filters.experiences],
      ["Salary", filters.salaries],
      ["Department", filters.departments],
      ["Industry", filters.industries],
      ["Employment", filters.employments],
    ];

    const anyFilterRequested = wanted.some(
      ([, values]) => values && values.length > 0,
    );
    if (!anyFilterRequested) {
      logger.info("No Shine filters requested");
      return false;
    }

    logger.info({ filters }, "Opening Shine filter panel");

    // ── 1. Open sidebar filter panel ───────────────────────
    const trigger = page.locator(S.filterTrigger).first();
    if (!(await trigger.isVisible({ timeout: 8000 }).catch(() => false))) {
      logger.warn("Filter trigger not found");
      return false;
    }
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    await trigger.click();
    await randomDelay(600, 1000);

    const panel = page.locator(S.filterPanel).first();
    if (!(await panel.isVisible({ timeout: 6000 }).catch(() => false))) {
      logger.warn("Filter panel did not open");
      return false;
    }

    // ── 2. Process each requested section ──────────────────
    for (const [sectionName, values] of wanted) {
      if (!values || values.length === 0) continue;

      const section = panel
        .locator(S.filterSection)
        .filter({
          has: page.locator(
            `${S.filterSectionHeader}:text-is("${sectionName}")`,
          ),
        })
        .first();

      const sectionFound = await section
        .isVisible({ timeout: 3000 })
        .catch(() => false);
      if (!sectionFound) {
        logger.warn({ section: sectionName }, "Filter section not found");
        continue;
      }

      // Snapshot: how many dialog-like containers are visible right now?
      const modalsBefore = await countVisibleSubModals();

      // Click the section heading to open the sub-modal
      const header = section.locator(S.filterSectionHeader).first();
      await header.scrollIntoViewIfNeeded().catch(() => {});
      await header.click({ timeout: 3000 }).catch(async () => {
        const seeAll = section.locator(S.filterSeeAll).first();
        if (await seeAll.isVisible({ timeout: 1000 }).catch(() => false)) {
          await seeAll.click();
        }
      });

      await randomDelay(700, 1100);

      // Did the sub-modal open?
      const modalsAfter = await countVisibleSubModals();
      const modalOpened = modalsAfter > modalsBefore;

      // Also try to find a sub-modal explicitly (belt and suspenders)
      const subModal = await locateSubModalForSection(sectionName);

      if (subModal) {
        // ── CASE A: sub-modal opened → tick checkboxes ─────
        logger.info(
          { section: sectionName },
          "Sub-modal detected — using checkbox flow",
        );

        for (const value of values) {
          const candidates = [
            subModal.locator(`label:has-text("${value}")`).first(),
            subModal
              .locator(
                `div:has(> span:text-is("${value}")), div:has(> div:text-is("${value}"))`,
              )
              .first(),
            subModal.locator(`text="${value}"`).first(),
            subModal.locator(`:text-is("${value}")`).first(),
          ];

          let clicked = false;
          for (const cand of candidates) {
            if (await cand.isVisible({ timeout: 1200 }).catch(() => false)) {
              await cand.scrollIntoViewIfNeeded().catch(() => {});
              await cand.click({ timeout: 2500 }).catch(() => {});
              clicked = true;
              break;
            }
          }

          if (clicked) {
            logger.info(
              { section: sectionName, value },
              "Ticked filter option",
            );
            await randomDelay(300, 550);
          } else {
            logger.warn(
              { section: sectionName, value },
              "Filter option not found in sub-modal",
            );
          }
        }

        // Click "Done"
        const doneBtn = subModal.locator(S.subModalDoneButton).first();
        if (await doneBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
          await doneBtn.click();
          logger.info({ section: sectionName }, "Clicked 'Done'");
          await randomDelay(700, 1100);
        } else {
          logger.warn({ section: sectionName }, "'Done' button not found");
          await page.keyboard.press("Escape").catch(() => {});
          await randomDelay(400, 700);
        }

        continue;
      }

      // ── CASE B: no sub-modal → click pills inline ────────
      logger.info(
        { section: sectionName },
        "No sub-modal — using inline pill flow",
      );

      // If a section header click toggled something, ensure it's off
      // before treating this as pill-toggling? No — safer to just click
      // the specific pills directly.
      for (const value of values) {
        const pill = section
          .locator(S.filterPill)
          .filter({ has: page.locator(`span:text-is("${value}")`) })
          .first();

        if (!(await pill.isVisible({ timeout: 1500 }).catch(() => false))) {
          // Try "See all" to reveal hidden pills
          const seeAll = section.locator(S.filterSeeAll).first();
          if (await seeAll.isVisible({ timeout: 800 }).catch(() => false)) {
            await seeAll.click().catch(() => {});
            await randomDelay(500, 800);
          }
        }

        // Re-locate after possibly expanding
        const pillRetry = section
          .locator(S.filterPill)
          .filter({ has: page.locator(`span:text-is("${value}")`) })
          .first();

        if (!(await pillRetry.isVisible({ timeout: 1500 }).catch(() => false))) {
          logger.warn(
            { section: sectionName, value },
            "Pill not found in section",
          );
          continue;
        }

        const isOn = await pillRetry
          .getAttribute("aria-pressed")
          .then((v) => v === "true")
          .catch(() => false);

        if (isOn) {
          logger.debug(
            { section: sectionName, value },
            "Pill already active",
          );
          continue;
        }

        await pillRetry.scrollIntoViewIfNeeded().catch(() => {});
        await pillRetry.click();
        logger.info(
          { section: sectionName, value },
          "Clicked pill (inline mode)",
        );
        await randomDelay(400, 700);
      }
    }

    // ── 3. Apply filters in the sidebar ────────────────────
    const panelAfter = page.locator(S.filterPanel).first();
    const applyBtn = panelAfter.locator(S.filterApplyButton).first();

    if (await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await applyBtn.click();
      logger.info("Clicked 'Apply filters'");
      await randomDelay(2500, 4000);
      await page
        .locator(S.jobCard)
        .first()
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => {});
      return true;
    }

    logger.warn("Apply filters button not found — closing panel");
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  };

  // ── Helpers for the filter sub-modal detection ──────────
  const countVisibleSubModals = async (): Promise<number> => {
    return page.evaluate(() => {
      let count = 0;
      const candidates = document.querySelectorAll(
        'div[class*="facet-modal"], div[class*="facet_modal"], div[class*="drawer"], [role="dialog"], div[class*="modal"]',
      );
      candidates.forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 250 || rect.height < 250) return;
        // Skip the sidebar itself
        const cls = typeof el.className === "string" ? el.className : "";
        if (cls.includes("filter-panel_panel")) return;
        count++;
      });
      return count;
    });
  };

  const locateSubModalForSection = async (
    sectionName: string,
  ): Promise<ReturnType<typeof page.locator> | null> => {
    // Find every visible "Done" button and walk up to a plausible container.
    const doneButtons = page.locator(S.subModalDoneButton);
    const doneCount = await doneButtons.count().catch(() => 0);

    for (let i = 0; i < doneCount; i++) {
      const btn = doneButtons.nth(i);
      if (!(await btn.isVisible({ timeout: 500 }).catch(() => false))) continue;

      // Walk up 1..6 ancestors, pick the shallowest one that:
      //   * is >= 250x250 px
      //   * contains the section name text
      //   * is not the sidebar panel
      const container = btn.locator(
        'xpath=ancestor::*[self::div or self::section or self::aside][position() <= 6]',
      );
      const count = await container.count().catch(() => 0);

      for (let j = 0; j < count; j++) {
        const c = container.nth(j);
        const box = await c.boundingBox().catch(() => null);
        if (!box || box.width < 250 || box.height < 250) continue;

        const cls = (await c.getAttribute("class").catch(() => "")) || "";
        if (cls.includes("filter-panel_panel")) continue;

        const text = (await c.textContent().catch(() => "")) || "";
        if (
          text.toLowerCase().includes(sectionName.toLowerCase()) &&
          text.toLowerCase().includes("done")
        ) {
          return c;
        }
      }
    }

    return null;
  };

  // ── Search ──────────────────────────────────────────────
  const search = async (
    keywords: string,
    options: ShineSearchOptions = {},
  ): Promise<void> => {
    const { location, minExp = 2, maxExp = 4, jobAge = 3, filters } = options;

    const cleanKeyword = keywords
      .replace(/[\(\)"']/g, "")
      .replace(/\b(AND|OR|NOT)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const keywordSlug =
      cleanKeyword
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

    // const searchUrl = new URL(`https://www.shine.com/job-search/${pathname}`);
    // searchUrl.searchParams.set("experience", `${minExp}-${maxExp}`);
    // searchUrl.searchParams.set("posted", String(jobAge));
    // searchUrl.searchParams.set("sort", "date");
        const searchUrl = new URL(`https://www.shine.com/job-search/${pathname}`);
    // Do NOT set experience=min-max — it conflicts with the UI facet filters
    // and yields zero results. Experience is controlled via filters instead.
    searchUrl.searchParams.set("posted", String(jobAge));
    searchUrl.searchParams.set("sort", "date");

    lastSearchUrl = searchUrl.toString();
    logger.info(
      { url: lastSearchUrl, keywords, location },
      "Opening Shine search",
    );

    await goto(lastSearchUrl);
    await randomDelay(3000, 4500);

    // 1. Apply filters first (if any)
    if (filters) {
      await applyFilters(filters);
      await randomDelay(1500, 2500);
    }

    // 2. Apply "Most recent" sort
    await applyMostRecentSort();
    await randomDelay(1500, 2500);

    // 3. Scroll to trigger lazy load
    await page.evaluate(() => window.scrollBy(0, 800));
    await randomDelay(1500, 2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await randomDelay(1000, 1800);

    // Check for job cards
    const cards = page.locator(S.jobCard);
    await cards
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .catch(() => {});

    const count = await cards.count().catch(() => 0);
    if (count > 0) {
      logger.info(
        { count, keywords, location },
        "Shine results loaded (sorted by Most recent)",
      );
      return;
    }

    // Diagnose failure
    const currentUrl = page.url();
    const bodyText = (
      (await page.locator("body").textContent().catch(() => "")) || ""
    ).toLowerCase();

    await screenshot("shine-search-no-results");

    if (
      currentUrl.includes("/pages/myshine/login") ||
      bodyText.includes("login to continue")
    ) {
      throw new Error("Shine redirected to login while searching");
    }
    if (bodyText.includes("captcha") || bodyText.includes("verify you are human")) {
      throw new Error("Shine blocked the search page or requested CAPTCHA");
    }
    if (
      bodyText.includes("no jobs found") ||
      bodyText.includes("no results found")
    ) {
      logger.warn({ keywords, location }, "Shine returned no matching jobs");
      return;
    }

    throw new Error(`Shine job cards did not appear. URL: ${currentUrl}`);
  };

  // ── Extract job cards ───────────────────────────────────
  const extractJobId = (url: string): string => {
    const match = url.match(/\/(\d{6,})(?:[/?#]|$)/);
    return match?.[1] || url;
  };

  const extractJobCards = async (
    limit = 30,
  ): Promise<ExtractedShineJob[]> => {
    const cards = page.locator(S.jobCard);
    const total = await cards.count().catch(() => 0);
    if (total === 0) return [];

    const take = Math.min(total, limit);

    const raw = await cards.evaluateAll((els, takeCount) => {
      const slice = els.slice(0, takeCount as number);

      const textOf = (parent: Element, sel: string): string => {
        const el = parent.querySelector(sel);
        return el ? (el.textContent || "").trim() : "";
      };

      return slice.map((el) => {
        const linkEl =
          (el.querySelector(
            'a[class*="result-card_hit"]',
          ) as HTMLAnchorElement | null) ||
          (el.querySelector("a") as HTMLAnchorElement | null);

        const title = textOf(el, 'h3[class*="result-card_role"]');
        const href = linkEl?.getAttribute("href") || "";
        const company = textOf(el, 'span[class*="result-card_company"]');
        const postedAt = textOf(el, 'span[class*="result-card_posted"]');

        const metaTexts = Array.from(
          el.querySelectorAll('span[class*="result-card_meta-text"]'),
        ).map((n) => (n.textContent || "").trim());

        const experience =
          metaTexts.find((t) => /\d+\s*(?:to|\-)\s*\d+|Yrs/i.test(t)) || "";
        const locationText =
          metaTexts.length >= 3
            ? metaTexts[2]
            : metaTexts[metaTexts.length - 1] || "";

        return {
          title,
          href,
          company,
          location: locationText,
          experience,
          postedAt,
        };
      });
    }, take);

    const jobs: ExtractedShineJob[] = [];
    for (const card of raw) {
      if (!card.title || !card.href) continue;

      const fullUrl = card.href.startsWith("http")
        ? card.href
        : `https://www.shine.com${card.href}`;

      jobs.push({
        jobId: extractJobId(fullUrl),
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

  // ── Apply flow ──────────────────────────────────────────
  const isAlreadyApplied = async (): Promise<boolean> => {
    const text = page.locator(S.alreadyAppliedText).first();
    return text.isVisible({ timeout: 3000 }).catch(() => false);
  };

  const isSuccessVisible = async (timeout = 3000): Promise<boolean> => {
    const success = page.locator(S.successMessage).first();
    return success.isVisible({ timeout }).catch(() => false);
  };

  const isExternalApplyPage = async (): Promise<boolean> => {
    const url = page.url().toLowerCase();
    if (!url.includes("shine.com")) return true;

    const externalBtn = page.locator(S.externalApplyButton).first();
    if (await externalBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }

    const bodyText = (
      (await page.locator("body").textContent().catch(() => "")) || ""
    ).toLowerCase();

    return (
      bodyText.includes("apply on company site") ||
      bodyText.includes("apply on company website")
    );
  };

  const clickApplyButton = async (): Promise<boolean> => {
    const btn = page.locator(S.applyButtonOnCard).first();
    if (await btn.isVisible({ timeout: 8000 }).catch(() => false)) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.hover();
      await randomDelay(200, 600);
      await btn.click();
      await randomDelay(1500, 3000);
      return true;
    }

    const generic = page
      .locator('button:has-text("Apply"), a:has-text("Apply")')
      .first();
    if (await generic.isVisible({ timeout: 3000 }).catch(() => false)) {
      await generic.scrollIntoViewIfNeeded().catch(() => {});
      await generic.click();
      await randomDelay(1500, 3000);
      return true;
    }
    return false;
  };

  const navigateAfterApply = async (): Promise<void> => {
    if (!lastSearchUrl) return;
    const url = page.url().toLowerCase();
    if (
      url.includes("/apply") ||
      url.includes("/application") ||
      url.includes("/success")
    ) {
      await goto(lastSearchUrl);
      await randomDelay(1500, 3000);
    }
  };

  const handleSimpleApply = async (
    job: JobCard,
  ): Promise<SimpleApplyResult> => {
    const startedAt = new Date().toISOString();
    const steps: ApplyStep[] = [];

    if (await isAlreadyApplied()) {
      return {
        success: false,
        message: "Already applied",
        metadata: {
          startedAt,
          steps: [{ step: "already-applied", at: new Date().toISOString() }],
        },
      };
    }

    if (await isExternalApplyPage()) {
      logger.info({ jobId: job.jobId }, "Shine external apply — Slack");
      await sendExternalJobToSlack(job);
      return {
        success: false,
        message: "External apply; sent to Slack",
        metadata: { startedAt, stage: "external-apply-sent-to-slack" },
      };
    }

    const clicked = await clickApplyButton();
    if (!clicked) {
      return {
        success: false,
        message: "Apply button not found",
        metadata: {
          startedAt,
          steps: [
            { step: "apply-button-missing", at: new Date().toISOString() },
          ],
        },
      };
    }

    steps.push({ step: "apply-clicked", at: new Date().toISOString() });
    await randomDelay(2500, 5000);

    if (await isSuccessVisible(5000)) {
      await navigateAfterApply();
      return {
        success: true,
        message: "Applied successfully",
        metadata: {
          startedAt,
          steps: [
            ...steps,
            { step: "success-message", at: new Date().toISOString() },
          ],
        },
      };
    }

    for (let i = 0; i < 6; i++) {
      if (await isSuccessVisible(1500)) {
        await navigateAfterApply();
        return {
          success: true,
          message: "Application submitted",
          metadata: { startedAt, steps },
        };
      }

      const submit = page.locator(S.submitButton).first();
      if (await submit.isVisible({ timeout: 1500 }).catch(() => false)) {
        steps.push({ step: "submit-clicked", at: new Date().toISOString() });
        await submit.hover();
        await randomDelay(200, 500);
        await submit.click();
        await randomDelay(2500, 5000);
        continue;
      }

      const cont = page.locator(S.continueButton).first();
      if (await cont.isVisible({ timeout: 1500 }).catch(() => false)) {
        steps.push({ step: "continue-clicked", at: new Date().toISOString() });
        await cont.hover();
        await randomDelay(200, 500);
        await cont.click();
        await randomDelay(1800, 3500);
        continue;
      }
      break;
    }

    if (await isSuccessVisible(4000)) {
      await navigateAfterApply();
      return {
        success: true,
        message: "Application submitted",
        metadata: { startedAt, steps },
      };
    }

    if (await isExternalApplyPage()) {
      await sendExternalJobToSlack(job);
      return {
        success: false,
        message: "External page detected; sent to Slack",
        metadata: { startedAt, stage: "external-apply-sent-to-slack" },
      };
    }

    return {
      success: true,
      message: "Application completed",
      metadata: { startedAt, steps },
    };
  };

  return {
    page,
    goto,
    isVisible,
    screenshot,
    applyMostRecentSort,
    applyFilters,
    search,
    extractJobCards,
    clickApplyButton,
    isAlreadyApplied,
    isExternalApplyPage,
    handleSimpleApply,
  };
};


// // src/platforms/shine/page.ts

// import type { Page } from "@playwright/test";
// import fs from "fs";
// import path from "path";
// import { ShineSelectors as S, type ShineFilters } from "./selectors.js";
// import { logger } from "../../utils/logger.js";
// import { sendExternalJobToSlack } from "../../utils/slack.js";
// import type { JobCard } from "../base/types.js";

// // ─────────────────────────────────────────────────────────────
// // TYPES
// // ─────────────────────────────────────────────────────────────
// export interface ExtractedShineJob {
//   jobId: string;
//   title: string;
//   company: string;
//   location: string;
//   url: string;
//   experience?: string;
//   postedAt?: string;
// }

// export interface ApplyStep {
//   step: string;
//   at: string;
//   delayMs?: number;
// }

// export interface SimpleApplyResult {
//   success: boolean;
//   message?: string;
//   metadata?: Record<string, unknown>;
// }

// export interface ShineSearchOptions {
//   location?: string;
//   minExp?: number;
//   maxExp?: number;
//   jobAge?: number;
//   filters?: ShineFilters;
// }

// export type ShinePage = ReturnType<typeof createShinePage>;

// // ─────────────────────────────────────────────────────────────
// // SHINE PAGE
// // ─────────────────────────────────────────────────────────────
// export const createShinePage = (page: Page) => {
//   let lastSearchUrl: string | undefined;

//   // ── Delay helper ────────────────────────────────────────
//   const randomDelay = async (min: number, max: number): Promise<number> => {
//     const ms = Math.floor(Math.random() * (max - min + 1)) + min;
//     await page.waitForTimeout(ms);
//     return ms;
//   };

//   // ── Navigation ──────────────────────────────────────────
//   const goto = async (url: string): Promise<void> => {
//     logger.debug({ url }, "Navigating (Shine)");
//     await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
//     await randomDelay(1500, 3000);
//   };

//   const isVisible = async (
//     selector: string,
//     timeout = 5000,
//   ): Promise<boolean> => {
//     try {
//       await page.locator(selector).first().waitFor({ state: "visible", timeout });
//       return true;
//     } catch {
//       return false;
//     }
//   };

//   const screenshot = async (name: string): Promise<string> => {
//     const dir = path.resolve(process.cwd(), "storage", "screenshots");
//     fs.mkdirSync(dir, { recursive: true });
//     const filePath = path.join(dir, `${name}-${Date.now()}.png`);
//     await page.screenshot({ path: filePath, fullPage: true });
//     return filePath;
//   };

//   // ── Sort by "Most recent" via UI ────────────────────────
//   const applyMostRecentSort = async (): Promise<boolean> => {
//     try {
//       logger.info("Applying 'Most recent' sort");

//       const trigger = page.locator(S.sortTrigger).first();

//       if (!(await trigger.isVisible({ timeout: 6000 }).catch(() => false))) {
//         logger.warn("Sort trigger not found");
//         return false;
//       }

//       // Already "Most recent"?
//       const currentValue = (
//         (await page
//           .locator(S.sortTriggerValue)
//           .first()
//           .textContent()
//           .catch(() => "")) || ""
//       )
//         .trim()
//         .toLowerCase();

//       if (currentValue.includes("most recent")) {
//         logger.info("Sort is already 'Most recent'");
//         return true;
//       }

//       // Open the dropdown
//       await trigger.scrollIntoViewIfNeeded().catch(() => {});
//       await trigger.click();
//       await randomDelay(400, 700);

//       // Wait for the panel
//       const panel = page.locator(S.sortPanel).first();
//       await panel
//         .waitFor({ state: "visible", timeout: 4000 })
//         .catch(() => {});

//       // Click "Most recent"
//       const mostRecent = page.locator(S.sortOptionMostRecent).first();

//       if (!(await mostRecent.isVisible({ timeout: 3000 }).catch(() => false))) {
//         logger.warn("'Most recent' option not visible");
//         await page.keyboard.press("Escape").catch(() => {});
//         return false;
//       }

//       await mostRecent.click();
//       logger.info("Clicked 'Most recent' option");

//       // Wait for results to re-render
//       await randomDelay(2500, 4000);

//       // Verify
//       const newValue = (
//         (await page
//           .locator(S.sortTriggerValue)
//           .first()
//           .textContent()
//           .catch(() => "")) || ""
//       )
//         .trim()
//         .toLowerCase();

//       if (newValue.includes("most recent")) {
//         logger.info("Sort confirmed: Most recent");
//         return true;
//       }

//       logger.warn({ newValue }, "Sort value did not change to 'Most recent'");
//       return false;
//     } catch (err) {
//       logger.warn(
//         { err: err instanceof Error ? err.message : String(err) },
//         "Failed to apply 'Most recent' sort",
//       );
//       return false;
//     }
//   };

//   // ── Apply sidebar filters ───────────────────────────────
//   const applyFilters = async (filters: ShineFilters): Promise<boolean> => {
//     const wanted: Array<[string, string[] | undefined]> = [
//       ["Location", filters.locations],
//       ["Experience", filters.experiences],
//       ["Salary", filters.salaries],
//       ["Department", filters.departments],
//       ["Industry", filters.industries],
//       ["Employment", filters.employments],
//     ];

//     const anyFilterRequested = wanted.some(
//       ([, values]) => values && values.length > 0,
//     );
//     if (!anyFilterRequested) {
//       logger.info("No Shine filters requested");
//       return false;
//     }

//     logger.info({ filters }, "Opening Shine filter panel");

//     // 1. Open filter panel
//     const trigger = page.locator(S.filterTrigger).first();
//     if (!(await trigger.isVisible({ timeout: 8000 }).catch(() => false))) {
//       logger.warn("Filter trigger not found");
//       return false;
//     }
//     await trigger.scrollIntoViewIfNeeded().catch(() => {});
//     await trigger.click();
//     await randomDelay(500, 900);

//     const panel = page.locator(S.filterPanel).first();
//     if (!(await panel.isVisible({ timeout: 5000 }).catch(() => false))) {
//       logger.warn("Filter panel did not open");
//       return false;
//     }

//     // 2. Click each requested pill
//     let clicked = 0;
//     for (const [sectionName, values] of wanted) {
//       if (!values || values.length === 0) continue;

//       const section = panel
//         .locator(S.filterSection)
//         .filter({ has: page.locator(`h3:has-text("${sectionName}")`) })
//         .first();

//       if (!(await section.isVisible({ timeout: 3000 }).catch(() => false))) {
//         logger.warn({ section: sectionName }, "Filter section not found");
//         continue;
//       }

//       // Click "See all N" if present
//       const seeAll = section
//         .locator('button:has-text("See all")')
//         .first();
//       if (await seeAll.isVisible({ timeout: 800 }).catch(() => false)) {
//         await seeAll.click().catch(() => {});
//         await randomDelay(400, 700);
//       }

//       // Click each requested value's pill
//       for (const value of values) {
//         const pill = section
//           .locator(S.filterPill)
//           .filter({
//             has: page.locator(`span:text-is("${value}")`),
//           })
//           .first();

//         if (!(await pill.isVisible({ timeout: 1500 }).catch(() => false))) {
//           logger.warn(
//             { section: sectionName, value },
//             "Filter pill not found",
//           );
//           continue;
//         }

//         const isOn = await pill
//           .getAttribute("aria-pressed")
//           .then((v) => v === "true")
//           .catch(() => false);

//         if (isOn) {
//           logger.debug(
//             { section: sectionName, value },
//             "Filter pill already active",
//           );
//           continue;
//         }

//         await pill.scrollIntoViewIfNeeded().catch(() => {});
//         await pill.click();
//         clicked++;
//         await randomDelay(350, 650);
//       }
//     }

//     logger.info({ clicked }, "Filter pills clicked");

//     // 3. Apply filters
//     const applyBtn = panel.locator(S.filterApplyButton).first();
//     if (await applyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
//       await applyBtn.click();
//       logger.info("Clicked 'Apply filters'");
//       await randomDelay(2500, 4000);
//       await page
//         .locator(S.jobCard)
//         .first()
//         .waitFor({ state: "visible", timeout: 15_000 })
//         .catch(() => {});
//       return true;
//     }

//     logger.warn("Apply filters button not found");
//     return false;
//   };

//   // ── Search ──────────────────────────────────────────────
//   const search = async (
//     keywords: string,
//     options: ShineSearchOptions = {},
//   ): Promise<void> => {
//     const { location, minExp = 2, maxExp = 4, jobAge = 3, filters } = options;

//     const cleanKeyword = keywords
//       .replace(/[\(\)"']/g, "")
//       .replace(/\b(AND|OR|NOT)\b/gi, " ")
//       .replace(/\s+/g, " ")
//       .trim();

//     const keywordSlug =
//       cleanKeyword
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

//     const searchUrl = new URL(`https://www.shine.com/job-search/${pathname}`);
//     searchUrl.searchParams.set("experience", `${minExp}-${maxExp}`);
//     searchUrl.searchParams.set("posted", String(jobAge));
//     searchUrl.searchParams.set("sort", "date");

//     lastSearchUrl = searchUrl.toString();
//     logger.info({ url: lastSearchUrl, keywords, location }, "Opening Shine search");

//     await goto(lastSearchUrl);
//     await randomDelay(3000, 4500);

//     // 1. Apply filters first (if any)
//     if (filters) {
//       await applyFilters(filters);
//       await randomDelay(1500, 2500);
//     }

//     // 2. Apply "Most recent" sort
//     await applyMostRecentSort();
//     await randomDelay(1500, 2500);

//     // 3. Scroll to trigger lazy load
//     await page.evaluate(() => window.scrollBy(0, 800));
//     await randomDelay(1500, 2500);
//     await page.evaluate(() => window.scrollTo(0, 0));
//     await randomDelay(1000, 1800);

//     // Check for job cards
//     const cards = page.locator(S.jobCard);
//     await cards
//       .first()
//       .waitFor({ state: "visible", timeout: 20_000 })
//       .catch(() => {});

//     const count = await cards.count().catch(() => 0);
//     if (count > 0) {
//       logger.info(
//         { count, keywords, location },
//         "Shine results loaded (sorted by Most recent)",
//       );
//       return;
//     }

//     // Diagnose failure
//     const currentUrl = page.url();
//     const bodyText = (
//       (await page.locator("body").textContent().catch(() => "")) || ""
//     ).toLowerCase();

//     await screenshot("shine-search-no-results");

//     if (
//       currentUrl.includes("/pages/myshine/login") ||
//       bodyText.includes("login to continue")
//     ) {
//       throw new Error("Shine redirected to login while searching");
//     }
//     if (bodyText.includes("captcha") || bodyText.includes("verify you are human")) {
//       throw new Error("Shine blocked the search page or requested CAPTCHA");
//     }
//     if (
//       bodyText.includes("no jobs found") ||
//       bodyText.includes("no results found")
//     ) {
//       logger.warn({ keywords, location }, "Shine returned no matching jobs");
//       return;
//     }

//     throw new Error(`Shine job cards did not appear. URL: ${currentUrl}`);
//   };

//   // ── Extract job cards ───────────────────────────────────
//   const extractJobId = (url: string): string => {
//     const match = url.match(/\/(\d{6,})(?:[/?#]|$)/);
//     return match?.[1] || url;
//   };

//   const extractJobCards = async (
//     limit = 30,
//   ): Promise<ExtractedShineJob[]> => {
//     const cards = page.locator(S.jobCard);
//     const total = await cards.count().catch(() => 0);
//     if (total === 0) return [];

//     const take = Math.min(total, limit);

//     const raw = await cards.evaluateAll((els, takeCount) => {
//       const slice = els.slice(0, takeCount as number);

//       const textOf = (parent: Element, sel: string): string => {
//         const el = parent.querySelector(sel);
//         return el ? (el.textContent || "").trim() : "";
//       };

//       return slice.map((el) => {
//         const linkEl =
//           (el.querySelector(
//             'a[class*="result-card_hit"]',
//           ) as HTMLAnchorElement | null) ||
//           (el.querySelector("a") as HTMLAnchorElement | null);

//         const title = textOf(el, 'h3[class*="result-card_role"]');
//         const href = linkEl?.getAttribute("href") || "";
//         const company = textOf(el, 'span[class*="result-card_company"]');
//         const postedAt = textOf(el, 'span[class*="result-card_posted"]');

//         // The meta row has: [exp icon] "4 to 8 Yrs" • [salary icon] "Not Disclosed" • [loc icon] "Noida"
//         const metaTexts = Array.from(
//           el.querySelectorAll('span[class*="result-card_meta-text"]'),
//         ).map((n) => (n.textContent || "").trim());

//         const experience = metaTexts.find((t) => /\d+\s*(?:to|\-)\s*\d+|Yrs/i.test(t)) || "";
//         const locationText = metaTexts.length >= 3 ? metaTexts[2] : (metaTexts[metaTexts.length - 1] || "");

//         return {
//           title,
//           href,
//           company,
//           location: locationText,
//           experience,
//           postedAt,
//         };
//       });
//     }, take);

//     const jobs: ExtractedShineJob[] = [];
//     for (const card of raw) {
//       if (!card.title || !card.href) continue;

//       const fullUrl = card.href.startsWith("http")
//         ? card.href
//         : `https://www.shine.com${card.href}`;

//       jobs.push({
//         jobId: extractJobId(fullUrl),
//         title: card.title,
//         company: card.company,
//         location: card.location,
//         url: fullUrl,
//         experience: card.experience,
//         postedAt: card.postedAt,
//       });
//     }
//     return jobs;
//   };

//   // ── Apply flow ──────────────────────────────────────────
//   const isAlreadyApplied = async (): Promise<boolean> => {
//     const text = page.locator(S.alreadyAppliedText).first();
//     return text.isVisible({ timeout: 3000 }).catch(() => false);
//   };

//   const isSuccessVisible = async (timeout = 3000): Promise<boolean> => {
//     const success = page.locator(S.successMessage).first();
//     return success.isVisible({ timeout }).catch(() => false);
//   };

//   const isExternalApplyPage = async (): Promise<boolean> => {
//     const url = page.url().toLowerCase();
//     if (!url.includes("shine.com")) return true;

//     const externalBtn = page.locator(S.externalApplyButton).first();
//     if (await externalBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
//       return true;
//     }

//     const bodyText = (
//       (await page.locator("body").textContent().catch(() => "")) || ""
//     ).toLowerCase();

//     return (
//       bodyText.includes("apply on company site") ||
//       bodyText.includes("apply on company website")
//     );
//   };

//   const clickApplyButton = async (): Promise<boolean> => {
//     const btn = page.locator(S.applyButtonOnCard).first();
//     if (await btn.isVisible({ timeout: 8000 }).catch(() => false)) {
//       await btn.scrollIntoViewIfNeeded().catch(() => {});
//       await btn.hover();
//       await randomDelay(200, 600);
//       await btn.click();
//       await randomDelay(1500, 3000);
//       return true;
//     }

//     // Fallback: any button with "Apply"
//     const generic = page
//       .locator('button:has-text("Apply"), a:has-text("Apply")')
//       .first();
//     if (await generic.isVisible({ timeout: 3000 }).catch(() => false)) {
//       await generic.scrollIntoViewIfNeeded().catch(() => {});
//       await generic.click();
//       await randomDelay(1500, 3000);
//       return true;
//     }
//     return false;
//   };

//   const navigateAfterApply = async (): Promise<void> => {
//     if (!lastSearchUrl) return;
//     const url = page.url().toLowerCase();
//     if (
//       url.includes("/apply") ||
//       url.includes("/application") ||
//       url.includes("/success")
//     ) {
//       await goto(lastSearchUrl);
//       await randomDelay(1500, 3000);
//     }
//   };

//   const handleSimpleApply = async (
//     job: JobCard,
//   ): Promise<SimpleApplyResult> => {
//     const startedAt = new Date().toISOString();
//     const steps: ApplyStep[] = [];

//     if (await isAlreadyApplied()) {
//       return {
//         success: false,
//         message: "Already applied",
//         metadata: {
//           startedAt,
//           steps: [{ step: "already-applied", at: new Date().toISOString() }],
//         },
//       };
//     }

//     if (await isExternalApplyPage()) {
//       logger.info({ jobId: job.jobId }, "Shine external apply — Slack");
//       await sendExternalJobToSlack(job);
//       return {
//         success: false,
//         message: "External apply; sent to Slack",
//         metadata: { startedAt, stage: "external-apply-sent-to-slack" },
//       };
//     }

//     const clicked = await clickApplyButton();
//     if (!clicked) {
//       return {
//         success: false,
//         message: "Apply button not found",
//         metadata: {
//           startedAt,
//           steps: [
//             { step: "apply-button-missing", at: new Date().toISOString() },
//           ],
//         },
//       };
//     }

//     steps.push({ step: "apply-clicked", at: new Date().toISOString() });
//     await randomDelay(2500, 5000);

//     if (await isSuccessVisible(5000)) {
//       await navigateAfterApply();
//       return {
//         success: true,
//         message: "Applied successfully",
//         metadata: {
//           startedAt,
//           steps: [
//             ...steps,
//             { step: "success-message", at: new Date().toISOString() },
//           ],
//         },
//       };
//     }

//     for (let i = 0; i < 6; i++) {
//       if (await isSuccessVisible(1500)) {
//         await navigateAfterApply();
//         return {
//           success: true,
//           message: "Application submitted",
//           metadata: { startedAt, steps },
//         };
//       }

//       const submit = page.locator(S.submitButton).first();
//       if (await submit.isVisible({ timeout: 1500 }).catch(() => false)) {
//         steps.push({ step: "submit-clicked", at: new Date().toISOString() });
//         await submit.hover();
//         await randomDelay(200, 500);
//         await submit.click();
//         await randomDelay(2500, 5000);
//         continue;
//       }

//       const cont = page.locator(S.continueButton).first();
//       if (await cont.isVisible({ timeout: 1500 }).catch(() => false)) {
//         steps.push({ step: "continue-clicked", at: new Date().toISOString() });
//         await cont.hover();
//         await randomDelay(200, 500);
//         await cont.click();
//         await randomDelay(1800, 3500);
//         continue;
//       }
//       break;
//     }

//     if (await isSuccessVisible(4000)) {
//       await navigateAfterApply();
//       return {
//         success: true,
//         message: "Application submitted",
//         metadata: { startedAt, steps },
//       };
//     }

//     if (await isExternalApplyPage()) {
//       await sendExternalJobToSlack(job);
//       return {
//         success: false,
//         message: "External page detected; sent to Slack",
//         metadata: { startedAt, stage: "external-apply-sent-to-slack" },
//       };
//     }

//     return {
//       success: true,
//       message: "Application completed",
//       metadata: { startedAt, steps },
//     };
//   };

//   return {
//     page,
//     goto,
//     isVisible,
//     screenshot,
//     applyMostRecentSort,
//     applyFilters,
//     search,
//     extractJobCards,
//     clickApplyButton,
//     isAlreadyApplied,
//     isExternalApplyPage,
//     handleSimpleApply,
//   };
// };

 