// tests/naukri/naukri-apply-recommended.spec.ts
import { test, expect } from "../fixtures/index.js";
import type { Page } from "@playwright/test";
import type { ApplyResult, JobCard } from "../../src/platforms/base/types.js";

test.describe("Naukri — Recommended Jobs (Home → Jobs dropdown → Apply)", () => {
  test.setTimeout(25 * 60 * 1000);

  test("apply to recommended jobs one by one", async ({ naukri }) => {
    const page: Page = naukri.page;

    // ── 1. Homepage ──────────────────────────────────────────
    console.log("[NAV] Opening Naukri homepage");
    await page.goto("https://www.naukri.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForSelector(".nI-gNb-header", { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // ── 2. Jobs → Recommended jobs ───────────────────────────
    console.log("[NAV] Hovering Jobs nav");
    const jobsNav = page
      .locator(
        ".nI-gNb-menus li.nI-gNb-custom-Jobs a.nI-gNb-menuItems__anchorDropdown",
      )
      .first();
    await jobsNav.waitFor({ state: "visible", timeout: 20_000 });
    await jobsNav.hover();
    await page.waitForTimeout(600);

    console.log("[NAV] Clicking Recommended jobs");
    const recoLink = page
      .locator('a[href*="/mnjuser/recommendedjobs"]')
      .first();
    await recoLink.waitFor({ state: "visible", timeout: 20_000 });
    await Promise.all([
      page.waitForURL(/\/mnjuser\/recommendedjobs/, { timeout: 60_000 }),
      recoLink.click(),
    ]);

    await page.waitForSelector(
      ".reco-container article.jobTuple, article.jobTuple",
      { timeout: 60_000 },
    );
    await page.waitForTimeout(2000);
    console.log(`\n=== Reco Jobs page loaded: ${page.url()} ===\n`);

    // List of tabs to process, with their tab IDs from the DOM
const TABS_TO_PROCESS = [
  { id: "profile", label: "Profile" },
  { id: "preference", label: "Preferences" },
  // { id: "apply", label: "Applies" },        // uncomment if you want
  // { id: "similar_jobs", label: "You might like" }, // uncomment if you want
];

    // ── 3. Loop ──────────────────────────────────────────────
    const MAX_TOTAL = 50;
    const allResults: ApplyResult[] = [];

for (const tab of TABS_TO_PROCESS) {
  console.log(`\n════════ Switching to tab: ${tab.label} ════════`);

  const tabEl = page.locator(`#${tab.id} .tab-list-item`).first();
  const visible = await tabEl.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) {
    console.log(`[${tab.label}] Tab not visible — skipping`);
    continue;
  }

  await tabEl.click();
  await page.waitForTimeout(2500); // let the new list render


    for (let i = 0; i < MAX_TOTAL; i++) {
      if (page.isClosed()) {
        console.log(`[${i}] Main page closed — stopping`);
        break;
      }

      console.log(`\n──────────── [${i}] iteration start ────────────`);

      const cards = page.locator(
        ".reco-container article.jobTuple, article.jobTuple",
      );

      const total = await cards.count().catch(() => 0);
      console.log(`[${i}] Total cards: ${total}`);
      if (i >= total) {
        console.log(`[${i}] No more cards — stopping`);
        break;
      }

      const card = cards.nth(i);

      // Skip already-applied
      const applied = await card
        .locator('text=/applied/i, [class*="applied"]')
        .first()
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (applied) {
        console.log(`[${i}] Card shows Applied — skip`);
        allResults.push({
          success: false,
          alreadyApplied: true,
          job: {} as JobCard,
        } as ApplyResult);
        continue;
      }

      // ── Scrape ────────────────────────────────────────────
      console.log(`[${i}] Scraping card...`);

      const dataJobId =
        (await card
          .getAttribute("data-job-id", { timeout: 2000 })
          .catch(() => "")) || "";

      const title = (
        (await card
          .locator("p.title, .title")
          .first()
          .textContent({ timeout: 3000 })
          .catch(() => "")) || ""
      ).trim();

      // Try a real anchor (SRP layout) first
      let href =
        (await card
          .locator('a[href*="/job-listings-"]')
          .first()
          .getAttribute("href", { timeout: 2000 })
          .catch(() => "")) || "";

      // Fallback: build URL from data-job-id (recommended-jobs layout)
      if (!href && dataJobId) {
        href = `https://www.naukri.com/job-listings-${dataJobId}`;
      }

      const url = href
        ? href.startsWith("http")
          ? href
          : `https://www.naukri.com${href}`
        : "";

      const isRealJobUrl =
        /naukri\.com\/job-listings-/i.test(url) ||
        /[?&]jobId=\d+/i.test(url);

      console.log(
        `[${i}] title="${title}" id="${dataJobId}" url="${url}" real=${isRealJobUrl}`,
      );

      if (!title || !dataJobId || !isRealJobUrl) {
        console.log(`[${i}] ✗ Missing title or job id — skip`);
        allResults.push({
          success: false,
          alreadyApplied: false,
          job: {} as JobCard,
          error: "Missing title or job id",
        } as ApplyResult);
        continue;
      }

      const company = (
        (await card
          .locator(".comp-name, .companyInfo .subTitle")
          .first()
          .textContent({ timeout: 2000 })
          .catch(() => "")) || ""
      ).trim();
      const location = (
        (await card
          .locator(".locWdth, .loc-info, .location")
          .first()
          .textContent({ timeout: 2000 })
          .catch(() => "")) || ""
      ).trim();

      const job: JobCard = {
        jobId: dataJobId,
        title,
        company,
        location,
        url,
      };

      console.log(`[${i}] → ${title} @ ${company} (${location})\n      ${url}`);

      // ── Delegate to platform ─────────────────────────────
      try {
        console.log(`[${i}] Calling naukri.applyToJob()...`);
        const result = await naukri.applyToJob(job);
        allResults.push(result);
        console.log(
          `[${i}] ${
            result.success
              ? "✅ applied"
              : result.alreadyApplied
                ? "⏭ already applied"
                : "❌ " + (result.error ?? "failed")
          }`,
        );
      } catch (err) {
        console.log(`[${i}] ❌ applyToJob threw: ${(err as Error).message}`);
        allResults.push({
          success: false,
          job,
          error: (err as Error).message,
        } as ApplyResult);
      }

      if (page.isClosed()) break;
      await page.bringToFront().catch(() => {});
      await page.waitForTimeout(1200);
    }
  }
    // ── 4. Summary ───────────────────────────────────────────
    const applied = allResults.filter((r) => r.success);
    const skipped = allResults.filter((r) => r.alreadyApplied);
    const failed = allResults.filter(
      (r) => !r.success && !r.alreadyApplied,
    );

    console.log(`\n==== SUMMARY ====`);
    console.log(`Applied         : ${applied.length}`);
    console.log(`Already applied : ${skipped.length}`);
    console.log(`Failed          : ${failed.length}`);
    console.log(`=================\n`);

    expect(allResults.length).toBeGreaterThan(0);
  });
});

