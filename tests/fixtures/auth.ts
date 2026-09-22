import fs from "fs";
import path from "path";
import { env } from "../../src/config/env.js";
import { logger } from "../../src/utils/logger.js";
import { test as base } from "./db.js";

export interface AuthFixtures {
  naukriAuthStatePath: string;
  hasNaukriAuth: boolean;
}

export const test = base.extend<AuthFixtures>({
  naukriAuthStatePath: async ({}, use) => {
    const resolved = path.resolve(process.cwd(), env.NAUKRI_AUTH_STATE);
    if (!fs.existsSync(resolved)) {
      throw new Error(
        `Naukri auth state missing at ${resolved}. ` +
          `Run once with HEADLESS=false so global-setup can log in.`,
      );
    }
    logger.debug({ path: resolved }, "Fixture: auth state ready");
    await use(resolved);
  },

  hasNaukriAuth: async ({}, use) => {
    const resolved = path.resolve(process.cwd(), env.NAUKRI_AUTH_STATE);
    await use(fs.existsSync(resolved));
  },
});

export { expect } from "./db.js";