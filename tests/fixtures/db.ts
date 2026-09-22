import { createDatabase } from "../../src/core/database.js";
import { logger } from "../../src/utils/logger.js";
import { test as base } from "./base.js";

export interface DbFixtures {
  db: ReturnType<typeof createDatabase>;
}

export const test = base.extend<DbFixtures>({
  db: async ({}, use) => {
    const db = createDatabase();
    db.initSchema();
    logger.debug("Fixture: db opened");
    await use(db);
    db.close();
    logger.debug("Fixture: db closed");
  },
});

export { expect } from "./base.js";