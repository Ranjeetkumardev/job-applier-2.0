// src/platforms/shine/ui.ts

import type { Page } from "@playwright/test";
import { logger } from "../../utils/logger.js";

// ─────────────────────────────────────────────────────────────
// SHINE SEARCH HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Fill the keyword search input on Shine.com
 */
export const fillKeywordOnShine = async (
  page: Page,
  keyword: string,
): Promise<boolean> => {
  try {
    const input = page
      .locator(
        'input[name="q"], input[placeholder*="Search" i], #search-job-title',
      )
      .first();

    if (!(await input.isVisible({ timeout: 3000 }).catch(() => false))) {
      logger.warn("Shine keyword input not visible");
      return false;
    }

    await input.click();
    await input.fill("");
    await input.type(keyword, { delay: 80 });

    logger.info({ keyword }, "Filled Shine keyword input");
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to fill Shine keyword",
    );
    return false;
  }
};

/**
 * Fill the location search input on Shine.com
 */
export const fillLocationOnShine = async (
  page: Page,
  location: string,
): Promise<boolean> => {
  try {
    const input = page
      .locator(
        'input[name="l"], input[placeholder*="Location" i], #search-location',
      )
      .first();

    if (!(await input.isVisible({ timeout: 2000 }).catch(() => false))) {
      logger.warn("Shine location input not visible");
      return false;
    }

    await input.click();
    await input.fill("");
    await input.type(location, { delay: 80 });

    // Wait for suggestions and press Escape to close them
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape").catch(() => {});

    logger.info({ location }, "Filled Shine location input");
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to fill Shine location",
    );
    return false;
  }
};

/**
 * Submit the Shine search
 */
export const submitShineSearch = async (page: Page): Promise<boolean> => {
  try {
    const btn = page
      .locator(
        'button:has-text("Search"), button[type="submit"], .search-btn',
      )
      .first();

    if (!(await btn.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Try pressing Enter as fallback
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2000);
      logger.info("Submitted Shine search via Enter");
      return true;
    }

    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 })
        .catch(() => {}),
      btn.click(),
    ]);

    logger.info("Submitted Shine search");
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to submit Shine search",
    );
    return false;
  }
};

/**
 * Apply experience filter on Shine (if a UI dropdown exists)
 * Shine typically uses URL params for experience filtering
 */
export const selectExperienceOnShine = async (
  page: Page,
  years: number,
): Promise<boolean> => {
  try {
    // Shine sometimes has a dropdown for experience
    const dropdown = page
      .locator(
        '[class*="experience"] select, [class*="experienceFilter"], [class*="experience-dropdown"]',
      )
      .first();

    if (!(await dropdown.isVisible({ timeout: 2500 }).catch(() => false))) {
      logger.debug("Shine experience dropdown not found — URL params will be used");
      return false;
    }

    await dropdown.click();
    await page.waitForTimeout(400);

    // Try to select the matching option
    const optionRegex =
      years <= 0
        ? /fresher|0/i
        : new RegExp(`^\\s*${years}\\s*(?:year|yr|yrs|years)?\\s*$`, "i");

    const option = page.getByText(optionRegex).first();
    if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
      await option.click();
      await page.waitForTimeout(1500);
      logger.info({ years }, "Selected Shine experience filter");
      return true;
    }

    // Close dropdown if no match
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "Failed to select Shine experience",
    );
    return false;
  }
};