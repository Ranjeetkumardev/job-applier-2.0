import { test, expect } from "@playwright/test";
import { createWellfoundPlatform } from "../../platforms/wellfound/platform.js";
import { createDatabase } from "../../core/database.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

// Setup DB connection (adjust path as needed)
const db = createDatabase("storage/app.db");

test.describe("Wellfound Automation", () => {
  let platform: ReturnType<typeof createWellfoundPlatform>;

  test.beforeAll(async () => {
    platform = createWellfoundPlatform(db);
    await platform.init({
      storageStatePath: env.WELLFOUND_AUTH_STATE || "storage/wellfound-auth.json",
      headless: env.HEADLESS,
    });
  });

  test.afterAll(async () => {
    await platform.close();
  });

  test("Search and apply to recommended jobs", async () => {
    // 1. Define search parameters
    const keywords = "Backend Engineer"; // Adjust based on your profile
    const locations = ["India", "Remote"]; // Adjust based on your preference
    const limit = 5; // Limit the number of applications for testing

    logger.info({ keywords, locations, limit }, "Starting Wellfound job search");

    // 2. Run the search and apply flow
    const results = await platform.run(keywords, locations, limit);

    // 3. Log results
    logger.info({ totalResults: results.length }, "Wellfound run completed");

    // 4. Assertions (Optional, but recommended for CI)
    // At least one job should have been processed
    expect(results.length).toBeGreaterThan(0);

    // Check if any applications were successful
    const successfulApplications = results.filter((r) => r.success);
    logger.info({ successfulApplications: successfulApplications.length }, "Successful applications");

    // If you want the test to fail if NO applications succeed, uncomment the line below:
    // expect(successfulApplications.length).toBeGreaterThan(0);

    // Log failures for debugging
    const failures = results.filter((r) => !r.success && !r.alreadyApplied);
    if (failures.length > 0) {
      logger.warn({ failures: failures.map(f => ({ jobId: f.job?.jobId, error: f.error })) }, "Some applications failed");
    }
  });
});