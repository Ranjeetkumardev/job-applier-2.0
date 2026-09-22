import type { Page } from "@playwright/test";
import { logger } from "../../utils/logger.js";


export const selectExperienceOnNaukri = async (
  page: Page,
  years: number,
): Promise<boolean> => {
  try {
    const topSelector =
      'button:has-text("Select experience"), div:has-text("Select experience")';

    const topVisible = await page
      .locator(topSelector)
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (topVisible) {
      await page.locator(topSelector).first().click().catch(() => {});
      await page.waitForTimeout(400);

      const regex = new RegExp(`\\b${years}\\s*(?:years?|yrs?)\\b`, "i");
      const option = page.getByText(regex).first();

      if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
        await option.click().catch(() => {});
        await page
          .getByRole("button", { name: /search/i })
          .first()
          .click()
          .catch(() => {});
        logger.info({ years }, "Selected experience via dropdown");
        return true;
      }
    }

    const leftOption = page
      .getByText(new RegExp(`\\b${years}\\s*(?:years?|yrs?)\\b`, "i"))
      .first();

    if (await leftOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await leftOption.click().catch(() => {});
      logger.info({ years }, "Selected experience via inline filter");
      return true;
    }

    logger.warn({ years }, "Experience selector not found");
    return false;
  } catch (err) {
    logger.warn({ err }, "Error selecting experience");
    return false;
  }
};

// ─────────────────────────────────────────────────────────────
// SRP LEFT-SIDEBAR FILTERS
// Freshness button: #filter-freshness  → dropdown a[data-id="filter-freshness-3"]
// Experience: .experiencecontainer .rc-slider (single handle 0..Any)
// ─────────────────────────────────────────────────────────────

export const selectFreshnessOnNaukri = async (
  page: Page,
  days: 1 | 3 | 7 | 15 | 30,
): Promise<boolean> => {
  try {
    const btn = page.locator("#filter-freshness").first();
    const visible = await btn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!visible) {
      logger.warn({ days }, "Freshness button not found on SRP");
      return false;
    }

    const current = ((await btn.textContent().catch(() => "")) || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const target = (days === 1 ? "Last 1 day" : `Last ${days} days`).toLowerCase();
    if (current === target) {
      logger.info({ days }, "Freshness already applied");
      return true;
    }

    await btn.click();
    await page.waitForTimeout(300);

    const option = page.locator(`a[data-id="filter-freshness-${days}"]`).first();
    const optionVisible = await option.isVisible({ timeout: 2500 }).catch(() => false);
    if (!optionVisible) {
      logger.warn({ days }, "Freshness option not visible after opening dropdown");
      return false;
    }

    // Selecting freshness triggers a server navigation with new URL params
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => {}),
      option.click(),
    ]);

    logger.info({ days }, "Applied freshness filter");
    return true;
  } catch (err) {
    logger.warn(
      { days, err: err instanceof Error ? err.message : String(err) },
      "Failed to apply freshness filter",
    );
    return false;
  }
};

// ─────────────────────────────────────────────────────────────
// TOP-BAR EXPERIENCE DROPDOWN (#experienceDD)
// Options: "Fresher (less than 1 year)", "1 year", "2 years", ... , "5 years"
// Selecting an option triggers a server navigation with new URL params.
// ─────────────────────────────────────────────────────────────
export const selectExperienceFromTopDropdown = async (
  page: Page,
  years: number,
): Promise<boolean> => {
  try {
    const dd = page.locator("#experienceDD").first();
    const visible = await dd.isVisible({ timeout: 3000 }).catch(() => false);
    if (!visible) {
      logger.warn({ years }, "Top experience dropdown not visible");
      return false;
    }

    // Already on the desired value? Skip.
    const current = (
      (await dd.inputValue().catch(() => "")) ||
      (await dd.getAttribute("title").catch(() => "")) ||
      ""
    ).trim().toLowerCase();

    const targetLabel =
      years <= 0
        ? "fresher"
        : years === 1
          ? "1 year"
          : `${years} years`;

    if (current === targetLabel) {
      logger.info({ years, current }, "Experience dropdown already set");
      return true;
    }

    // Open the dropdown
    await dd.scrollIntoViewIfNeeded().catch(() => {});
    await dd.click();
    await page.waitForTimeout(400);

    // The list is rendered inside .dropDownPrimaryContainer .dropdownContainer
    const list = page
      .locator(
        ".dropDownPrimaryContainer .dropdownContainer ul.dropdown, " +
          ".dropDownPrimaryContainer .dropdownContainer .dropdownPrimary ul.dropdown",
      )
      .first();
    await list.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);

    // Match the option by its visible text
    const optionRegex =
      years <= 0
        ? /fresher|less than 1 year/i
        : years === 1
          ? /^\s*1\s*year\s*$/i
          : new RegExp(`^\\s*${years}\\s*years?\\s*$`, "i");

    const option = list
      .locator("li")
      .filter({ hasText: optionRegex })
      .first();

    const optVisible = await option
      .isVisible({ timeout: 2500 })
      .catch(() => false);
    if (!optVisible) {
      logger.warn(
        { years, targetLabel },
        "Experience option not found in dropdown",
      );
      // Close the dropdown to avoid leaving it open
      await page.keyboard.press("Escape").catch(() => {});
      return false;
    }

    // Selecting triggers a nav
    await Promise.all([
      page
        .waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        })
        .catch(() => {}),
      option.click(),
    ]);

    logger.info({ years, targetLabel }, "Selected experience from top dropdown");
    return true;
  } catch (err) {
    logger.warn(
      { years, err: err instanceof Error ? err.message : String(err) },
      "Failed to select experience from top dropdown",
    );
    return false;
  }
};

export const selectExperienceSliderOnNaukri = async (
  page: Page,
  minYears: number,
): Promise<boolean> => {
  try {
    const slider = page.locator(".experiencecontainer .rc-slider").first();
    const visible = await slider.isVisible({ timeout: 3000 }).catch(() => false);
    if (!visible) {
      logger.warn({ minYears }, "Experience slider not found on SRP");
      return false;
    }

    const rail = slider.locator(".rc-slider-rail").first();
    const railBox = await rail.boundingBox();
    if (!railBox || railBox.width === 0) {
      logger.warn("Experience slider rail has no width");
      return false;
    }

    // SRP slider range is 0 → 30 (30 == "Any")
    const clamped = Math.max(0, Math.min(30, minYears));
    const targetX = railBox.x + railBox.width * (clamped / 30);
    const targetY = railBox.y + railBox.height / 2;

    const handle = slider.locator(".handle").first();
    const handleBox = await handle.boundingBox();
    if (!handleBox) {
      logger.warn("Experience slider handle not found");
      return false;
    }

    // Click on rail first — rc-slider snaps the handle to the click position
    await page.mouse.click(targetX, targetY);
    await page.waitForTimeout(400);

    let handleLabel = (
      (await slider
        .locator(".handle .inside span")
        .first()
        .textContent()
        .catch(() => "")) || ""
    )
      .replace(/\s+/g, " ")
      .trim();

    // If the click didn't move it, drag the handle
    if (handleLabel === "Any" || handleLabel === "0") {
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(targetX, targetY, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(500);

      handleLabel = (
        (await slider
          .locator(".handle .inside span")
          .first()
          .textContent()
          .catch(() => "")) || ""
      )
        .replace(/\s+/g, " ")
        .trim();
    }

    logger.info({ minYears: clamped, handleLabel }, "Applied experience slider");
    return true;
  } catch (err) {
    logger.warn(
      { minYears, err: err instanceof Error ? err.message : String(err) },
      "Failed to apply experience slider",
    );
    return false;
  }
};
