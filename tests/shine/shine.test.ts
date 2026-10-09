
// tests/shine/shine.test.ts

import { loadProfile } from "../../src/config/profile.js";
import { generateSearchMatrix } from "../../src/search/search-query-builder.js";
import type { ApplyResult } from "../../src/platforms/base/types.js";
import { test, expect } from "../fixtures/shine.js";

test.describe("Shine - multi-role x multi-location apply matrix", () => {
  test("searches and applies across roles and locations", async ({ shine }) => {
    const profile = loadProfile();

    const targetLocations = [
      "Delhi",
      "Noida",
      "Bangalore",
      "Gurugram",
      "Gurgaon",
      "Remote",
    ];

    const searchTasks = generateSearchMatrix(profile, targetLocations);
    const MAX_TOTAL = 50;
    const JOBS_PER_TASK = 10;

    const allResults: ApplyResult[] = [];

    for (const task of searchTasks) {
      if (allResults.length >= MAX_TOTAL) break;

      console.log(`\n--- Shine [${task.roleName}] @ [${task.location}] ---`);
      const remaining = MAX_TOTAL - allResults.length;

      const batch = await shine.run(
        task.query,
        task.location,
        Math.min(JOBS_PER_TASK, remaining),
      );
      allResults.push(...batch);
    }

    const applied = allResults.filter((r) => r.success);
    const skipped = allResults.filter((r) => r.alreadyApplied);
    const failed = allResults.filter((r) => !r.success && !r.alreadyApplied);

    console.log(`\n==== Shine SUMMARY ====`);
    console.log(`Applied         : ${applied.length}`);
    console.log(`Already applied : ${skipped.length}`);
    console.log(`Failed          : ${failed.length}`);
    console.log(`=======================\n`);

    expect(allResults.length).toBeGreaterThan(0);
  });
});

// import { loadProfile } from "../../src/config/profile.js";
// import { generateSearchMatrix } from "../../src/search/search-query-builder.js";
// import type { ApplyResult } from "../../src/platforms/base/types.js";
// import { test, expect } from "../fixtures/index.js";

// test.describe("Shine - multi-role x multi-location apply matrix", () => {
//   test("searches and applies across roles and locations", async ({ shine }) => {
//     const profile = loadProfile();

//     const targetLocations = [
//       "Delhi",
//       "Noida",
//       "Bangalore",
//       "Gurugram",
//       "Gurgaon",
//       "Remote",
//     ];

//     const searchTasks = generateSearchMatrix(profile, targetLocations);
//     const MAX_TOTAL = 50;
//     const JOBS_PER_TASK = 10;

//     const allResults: ApplyResult[] = [];

//     for (const task of searchTasks) {
//       if (allResults.length >= MAX_TOTAL) break;

//       console.log(`\n--- Shine [${task.roleName}] @ [${task.location}] ---`);
//       const remaining = MAX_TOTAL - allResults.length;

//       const batch = await shine.run(
//         task.query,
//         task.location,
//         Math.min(JOBS_PER_TASK, remaining),
//       );
//       allResults.push(...batch);
//     }

//     const applied = allResults.filter((r) => r.success);
//     const skipped = allResults.filter((r) => r.alreadyApplied);
//     const failed = allResults.filter((r) => !r.success && !r.alreadyApplied);

//     console.log(`\n==== Shine SUMMARY ====`);
//     console.log(`Applied         : ${applied.length}`);
//     console.log(`Already applied : ${skipped.length}`);
//     console.log(`Failed          : ${failed.length}`);
//     console.log(`=======================\n`);

//     expect(allResults.length).toBeGreaterThan(0);
//   });
// });