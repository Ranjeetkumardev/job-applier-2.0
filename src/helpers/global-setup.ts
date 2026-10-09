import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

// ─────────────────────────────────────────────────────────────
// NAUKRI
// ─────────────────────────────────────────────────────────────
const NAUKRI_AUTH_FILE = path.resolve(process.cwd(), env.NAUKRI_AUTH_STATE);
const NAUKRI_LOGIN_URL = "https://www.naukri.com/nlogin/login";
const NAUKRI_LOGGED_IN_PATTERN = /naukri\.com\/(mnjuser|.*homepage|.*jobs)/;

const setupNaukri = async (): Promise<void> => {
  if (fs.existsSync(NAUKRI_AUTH_FILE)) {
    logger.info(
      { authFile: NAUKRI_AUTH_FILE },
      "Reusing saved Naukri auth state",
    );
    return;
  }

  fs.mkdirSync(path.dirname(NAUKRI_AUTH_FILE), { recursive: true });

  const headless = env.HEADLESS || Boolean(process.env.CI);

  const browser = await chromium.launch({
    headless,
    channel:
      env.BROWSER_CHANNEL === "chromium" ? undefined : env.BROWSER_CHANNEL,
    slowMo: env.SLOW_MO,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1366,768",
      "--start-maximized",
    ],
  });

  const context = await browser.newContext({
    viewport: null,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();
  logger.info({ url: NAUKRI_LOGIN_URL }, "Opening Naukri login");

  await page.goto(NAUKRI_LOGIN_URL, { waitUntil: "domcontentloaded" });

  const canAutoLogin = Boolean(env.NAUKRI_USERNAME && env.NAUKRI_PASSWORD);
  let loggedIn = false;

  if (canAutoLogin) {
    try {
      logger.info({ user: env.NAUKRI_USERNAME }, "Attempting auto-login");
      await page.locator("#usernameField").fill(env.NAUKRI_USERNAME!);
      await page.locator("#passwordField").fill(env.NAUKRI_PASSWORD!);
      await page
        .locator('button[type="submit"], button:has-text("Login")')
        .first()
        .click();

      await page.waitForURL(
        (url) =>
          NAUKRI_LOGGED_IN_PATTERN.test(url.href) &&
          !url.href.includes("/nlogin"),
        { timeout: 45_000 },
      );
      loggedIn = true;
      logger.info({ url: page.url() }, "Auto-login succeeded");
    } catch (err) {
      logger.warn({ err }, "Auto-login failed — falling back to manual");
      await page.screenshot({
        path: path.join(
          path.dirname(NAUKRI_AUTH_FILE),
          "debug-auto-login-fail.png",
        ),
        fullPage: true,
      });
    }
  }

  if (!loggedIn) {
    if (process.env.CI) {
      await browser.close();
      throw new Error(
        "Naukri auto-login failed in CI. Provide .auth/naukri.json or run locally once.",
      );
    }
    logger.info("=== MANUAL NAUKRI LOGIN REQUIRED ===");
    logger.info("1. Browser is open");
    logger.info("2. Solve CAPTCHA / OTP if required");
    logger.info("3. Log in with your credentials");
    logger.info("4. Wait until you reach the Naukri homepage");

    await page.waitForURL(
      (url) =>
        NAUKRI_LOGGED_IN_PATTERN.test(url.href) &&
        !url.href.includes("/nlogin"),
      { timeout: 0 },
    );
  }

  logger.info({ url: page.url() }, "Login confirmed — saving state");
  await page.waitForTimeout(3000);
  await context.storageState({ path: NAUKRI_AUTH_FILE });
  logger.info({ authFile: NAUKRI_AUTH_FILE }, "Auth state saved");

  await browser.close();
};

// ─────────────────────────────────────────────────────────────
// SHINE
// ─────────────────────────────────────────────────────────────
const SHINE_AUTH_FILE = path.resolve(process.cwd(), env.SHINE_AUTH_STATE);
const SHINE_LOGIN_URL = "https://www.shine.com/pages/myshine/login";
const SHINE_LOGGED_IN_PATTERN = /shine\.com\/(?!pages\/myshine\/login)/;

const setupShine = async (): Promise<void> => {
  if (fs.existsSync(SHINE_AUTH_FILE)) {
    logger.info(
      { authFile: SHINE_AUTH_FILE },
      "Reusing saved Shine auth state",
    );
    return;
  }

  fs.mkdirSync(path.dirname(SHINE_AUTH_FILE), { recursive: true });

  const headless = env.HEADLESS || Boolean(process.env.CI);

  const browser = await chromium.launch({
    headless,
    channel:
      env.BROWSER_CHANNEL === "chromium" ? undefined : env.BROWSER_CHANNEL,
    slowMo: env.SLOW_MO,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1366,768",
      "--start-maximized",
    ],
  });

  const context = await browser.newContext({
    viewport: null,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  // Step 1: open the login page directly
  logger.info({ url: SHINE_LOGIN_URL }, "Opening Shine login page");
  await page.goto(SHINE_LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Step 2: click the "Login Via Password" tab using multiple strategies
  logger.info("Switching to 'Login Via Password' tab");

  let tabClicked = false;

  // Strategy 1: getByRole button
  if (!tabClicked) {
    try {
      await page
        .getByRole("button", { name: "Login Via Password", exact: true })
        .click({ timeout: 5000 });
      tabClicked = true;
      logger.info("Tab clicked via getByRole(button)");
    } catch {
      /* try next */
    }
  }

  // Strategy 2: getByRole tab
  if (!tabClicked) {
    try {
      await page
        .getByRole("tab", { name: "Login Via Password", exact: true })
        .click({ timeout: 5000 });
      tabClicked = true;
      logger.info("Tab clicked via getByRole(tab)");
    } catch {
      /* try next */
    }
  }

  // Strategy 3: exact text
  if (!tabClicked) {
    try {
      await page
        .locator('text="Login Via Password"')
        .first()
        .click({ timeout: 5000 });
      tabClicked = true;
      logger.info("Tab clicked via text locator");
    } catch {
      /* try next */
    }
  }

  // Strategy 4: DOM-level click via evaluate
  if (!tabClicked) {
    logger.warn("Playwright selectors failed — trying DOM-level click");
    await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll("button, div, span, a, li"),
      );
      const target = nodes.find(
        (n) =>
          (n.textContent || "").trim().toLowerCase() === "login via password",
      );
      if (target instanceof HTMLElement) {
        target.click();
        target.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
        );
        target.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true }),
        );
        target.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      }
    });
    tabClicked = true;
    logger.info("Tab clicked via DOM evaluate");
  }

  logger.info({ tabClicked }, "Tab click attempted");

  // Step 3: wait for the password input to confirm the tab switched
  const passwordField = page.locator('input[type="password"]').first();
  const passwordVisible = await passwordField
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (!passwordVisible) {
    logger.error("Password field did not appear — tab switch failed");
    await page.screenshot({
      path: path.join(
        path.dirname(SHINE_AUTH_FILE),
        "debug-shine-tab-fail.png",
      ),
      fullPage: true,
    });

    if (process.env.CI) {
      await browser.close();
      throw new Error("Shine password tab did not activate");
    }

    logger.info("=== MANUAL SHINE LOGIN REQUIRED ===");
    logger.info("Click 'Login Via Password', enter credentials, click Log In");

    await page.waitForURL(
      (url) =>
        SHINE_LOGGED_IN_PATTERN.test(url.href) &&
        !url.href.includes("/pages/myshine/login"),
      { timeout: 0 },
    );
    await page.waitForTimeout(3000);
    await context.storageState({ path: SHINE_AUTH_FILE });
    logger.info({ authFile: SHINE_AUTH_FILE }, "Shine auth state saved");
    await browser.close();
    return;
  }

  logger.info("Password tab active — filling credentials");

  // Step 4: fill email + password and submit
  const canAutoLogin = Boolean(env.SHINE_USERNAME && env.SHINE_PASSWORD);
  let loggedIn = false;

  if (canAutoLogin) {
    try {
      const emailField = page
        .locator(
          'input[type="email"], input[name="email"], input[placeholder*="Email" i], input[placeholder*="email" i]',
        )
        .first();

      const submitBtn = page
        .getByRole("button", { name: "Log In", exact: true })
        .first();

      await emailField.waitFor({ state: "visible", timeout: 5000 });
      await emailField.click();
      await emailField.fill("");
      await emailField.type(env.SHINE_USERNAME!, { delay: 40 });
      await page.waitForTimeout(300);

      await passwordField.click();
      await passwordField.fill("");
      await passwordField.type(env.SHINE_PASSWORD!, { delay: 40 });
      await page.waitForTimeout(300);

      logger.info({ user: env.SHINE_USERNAME }, "Clicking Log In button");
      await submitBtn.click();

      await page.waitForURL(
        (url) =>
          SHINE_LOGGED_IN_PATTERN.test(url.href) &&
          !url.href.includes("/pages/myshine/login"),
        { timeout: 45_000 },
      );
      loggedIn = true;
      logger.info({ url: page.url() }, "Shine auto-login succeeded");
    } catch (err) {
      logger.warn({ err }, "Shine auto-login failed — falling back to manual");
      await page.screenshot({
        path: path.join(
          path.dirname(SHINE_AUTH_FILE),
          "debug-shine-auto-login-fail.png",
        ),
        fullPage: true,
      });
    }
  }

  // Step 5: manual fallback
  if (!loggedIn) {
    if (process.env.CI) {
      await browser.close();
      throw new Error(
        "Shine auto-login failed in CI. Provide .auth/shine.json or run locally once.",
      );
    }
    logger.info("=== MANUAL SHINE LOGIN REQUIRED ===");
    logger.info("1. Browser is on Shine login page");
    logger.info("2. Click 'Login Via Password' tab");
    logger.info("3. Enter credentials and click Log In");

    await page.waitForURL(
      (url) =>
        SHINE_LOGGED_IN_PATTERN.test(url.href) &&
        !url.href.includes("/pages/myshine/login"),
      { timeout: 0 },
    );
  }

  logger.info({ url: page.url() }, "Shine login confirmed — saving state");
  await page.waitForTimeout(3000);
  await context.storageState({ path: SHINE_AUTH_FILE });
  logger.info({ authFile: SHINE_AUTH_FILE }, "Shine auth state saved");

  await browser.close();
};

// ─────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────
const globalSetup = async (): Promise<void> => {
  await setupNaukri();
  await setupShine();
};

export default globalSetup;

// import { chromium } from "@playwright/test";
// import fs from "fs";
// import path from "path";
// import { env } from "../config/env.js";
// import { logger } from "../utils/logger.js";

// const AUTH_FILE = path.resolve(process.cwd(), env.NAUKRI_AUTH_STATE);
// const LOGIN_URL = "https://www.naukri.com/nlogin/login";
// const LOGGED_IN_PATTERN = /naukri\.com\/(mnjuser|.*homepage|.*jobs)/;

// const globalSetup = async (): Promise<void> => {
//   if (fs.existsSync(AUTH_FILE)) {
//     logger.info({ authFile: AUTH_FILE }, "Reusing saved Naukri auth state");
//     return;
//   }

//   fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

//   const headless = env.HEADLESS || Boolean(process.env.CI);

//   const browser = await chromium.launch({
//     headless,
//     channel: env.BROWSER_CHANNEL === "chromium" ? undefined : env.BROWSER_CHANNEL,
//     slowMo: env.SLOW_MO,
//     args: [
//       "--disable-blink-features=AutomationControlled",
//       "--no-sandbox",
//       "--disable-setuid-sandbox",
//       "--window-size=1366,768",
//       "--start-maximized",
//     ],
//   });

//   const context = await browser.newContext({
//     viewport: null,
//     locale: "en-IN",
//     timezoneId: "Asia/Kolkata",
//     userAgent:
//       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
//   });

//   await context.addInitScript(() => {
//     Object.defineProperty(navigator, "webdriver", { get: () => undefined });
//     // @ts-ignore
//     window.chrome = { runtime: {} };
//   });

//   const page = await context.newPage();
//   logger.info({ url: LOGIN_URL }, "Opening Naukri login");

//   await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

//   const canAutoLogin = Boolean(env.NAUKRI_USERNAME && env.NAUKRI_PASSWORD);
//   let loggedIn = false;

//   if (canAutoLogin) {
//     try {
//       logger.info({ user: env.NAUKRI_USERNAME }, "Attempting auto-login");
//       await page.locator("#usernameField").fill(env.NAUKRI_USERNAME!);
//       await page.locator("#passwordField").fill(env.NAUKRI_PASSWORD!);
//       await page.locator('button[type="submit"], button:has-text("Login")').first().click();

//       await page.waitForURL(
//         (url) => LOGGED_IN_PATTERN.test(url.href) && !url.href.includes("/nlogin"),
//         { timeout: 45_000 },
//       );
//       loggedIn = true;
//       logger.info({ url: page.url() }, "Auto-login succeeded");
//     } catch (err) {
//       logger.warn({ err }, "Auto-login failed — falling back to manual");
//       await page.screenshot({
//         path: path.join(path.dirname(AUTH_FILE), "debug-auto-login-fail.png"),
//         fullPage: true,
//       });
//     }
//   }

//   if (!loggedIn) {
//     if (process.env.CI) {
//       await browser.close();
//       throw new Error(
//         "Naukri auto-login failed in CI. Provide .auth/naukri.json or run locally once.",
//       );
//     }
//     logger.info("=== MANUAL NAUKRI LOGIN REQUIRED ===");
//     logger.info("1. Browser is open");
//     logger.info("2. Solve CAPTCHA / OTP if required");
//     logger.info("3. Log in with your credentials");
//     logger.info("4. Wait until you reach the Naukri homepage");

//     await page.waitForURL(
//       (url) => LOGGED_IN_PATTERN.test(url.href) && !url.href.includes("/nlogin"),
//       { timeout: 0 },
//     );
//   }

//   logger.info({ url: page.url() }, "Login confirmed — saving state");
//   await page.waitForTimeout(3000);
//   await context.storageState({ path: AUTH_FILE });
//   logger.info({ authFile: AUTH_FILE }, "Auth state saved");

//   await browser.close();
// };

// export default globalSetup;