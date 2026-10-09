import { mergeTests } from "@playwright/test";
import { test as naukriTest } from "./naukri.js";
import { test as shineTest } from "./shine.js";

export const test = mergeTests(naukriTest, shineTest);

export { expect } from "./naukri.js";

// Re-export types (unchanged)
export type { DbFixtures } from "./db.js";
export type { AuthFixtures } from "./auth.js";
export type { NaukriFixtures } from "./naukri.js";
export type { ShineFixtures } from "./shine.js";


// export { test, expect } from "./naukri.js";
// export type { DbFixtures } from "./db.js";
// export type { AuthFixtures } from "./auth.js";
// export type { NaukriFixtures } from "./naukri.js";
// export type { ShineFixtures } from "./shine.js";