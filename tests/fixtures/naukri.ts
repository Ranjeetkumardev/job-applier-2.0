  import { createNaukriPlatform } from "../../src/platforms/naukri/platform.js";
  import { logger } from "../../src/utils/logger.js";
  import { test as base } from "./auth.js";

  export interface NaukriFixtures {
    naukri: ReturnType<typeof createNaukriPlatform>;
  }

  export const test = base.extend<NaukriFixtures>({
    naukri: async ({ db, naukriAuthStatePath }, use) => {
      const platform = createNaukriPlatform(db);
      await platform.init({ storageStatePath: naukriAuthStatePath });

      logger.debug("Fixture: naukri ready");
      await use(platform);
      await platform.close();
      logger.debug("Fixture: naukri closed");
    },
  });

  export { expect } from "./auth.js";