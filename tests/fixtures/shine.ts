// tests/fixtures/shine.ts

import { test as base } from "@playwright/test";
import fs from "fs";
import path from "path";
import { env } from "../../src/config/env.js";
import { createDatabase } from "../../src/core/database.js";
import { createShinePlatform } from "../../src/platforms/shine/platform.js";
import { logger } from "../../src/utils/logger.js";

export interface ShineFixtures {
  shine: ReturnType<typeof createShinePlatform>;
}

export const test = base.extend<ShineFixtures>({
  shine: async ({}, use) => {
    const db = createDatabase();
    db.initSchema();

    const storagePath = path.resolve(process.cwd(), env.SHINE_AUTH_STATE);
    if (!fs.existsSync(storagePath)) {
      throw new Error(
        `Shine auth state missing at ${storagePath}. Run global-setup first.`,
      );
    }

    const platform = createShinePlatform(db);
    await platform.init({
      storageStatePath: storagePath,
      headless: env.HEADLESS,
    });

    logger.debug("Fixture: shine ready");
    await use(platform);
    await platform.close();
    db.close();
    logger.debug("Fixture: shine closed");
  },
});

export { expect } from "@playwright/test";


// import { createShinePlatform } from "../../src/platforms/shine/platform.js";
// import { logger } from "../../src/utils/logger.js";
// import { env } from "../../src/config/env.js";
// import { test as base } from "./auth.js";

// export interface ShineFixtures {
//   shine: ReturnType<typeof createShinePlatform>;
// }

// export const test = base.extend<ShineFixtures>({
//   shine: async ({ db, shineAuthStatePath }, use) => {
//     const platform = createShinePlatform(db);
//     await platform.init({
//       storageStatePath: shineAuthStatePath,
//       headless: env.HEADLESS,
//     });
//     logger.debug("Fixture: shine ready");
//     await use(platform);
//     await platform.close();
//     logger.debug("Fixture: shine closed");
//   },
// });

// export { expect } from "./auth.js";
 
 