import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const AUTH_FILE = path.resolve(process.cwd(), env.NAUKRI_AUTH_STATE);
const LOGIN_URL = "https://www.naukri.com/nlogin/login";
const LOGGED_IN_PATTERN = /naukri\.com\/(mnjuser|.*homepage|.*jobs)/;

const globalSetup = async (): Promise<void> => {
  if (fs.existsSync(AUTH_FILE)) {
    logger.info({ authFile: AUTH_FILE }, "Reusing saved Naukri auth state");
    return;
  }

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  const headless = env.HEADLESS || Boolean(process.env.CI);

  const browser = await chromium.launch({
    headless,
    channel: env.BROWSER_CHANNEL === "chromium" ? undefined : env.BROWSER_CHANNEL,
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
  logger.info({ url: LOGIN_URL }, "Opening Naukri login");

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  const canAutoLogin = Boolean(env.NAUKRI_USERNAME && env.NAUKRI_PASSWORD);
  let loggedIn = false;

  if (canAutoLogin) {
    try {
      logger.info({ user: env.NAUKRI_USERNAME }, "Attempting auto-login");
      await page.locator("#usernameField").fill(env.NAUKRI_USERNAME!);
      await page.locator("#passwordField").fill(env.NAUKRI_PASSWORD!);
      await page.locator('button[type="submit"], button:has-text("Login")').first().click();

      await page.waitForURL(
        (url) => LOGGED_IN_PATTERN.test(url.href) && !url.href.includes("/nlogin"),
        { timeout: 45_000 },
      );
      loggedIn = true;
      logger.info({ url: page.url() }, "Auto-login succeeded");
    } catch (err) {
      logger.warn({ err }, "Auto-login failed — falling back to manual");
      await page.screenshot({
        path: path.join(path.dirname(AUTH_FILE), "debug-auto-login-fail.png"),
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
      (url) => LOGGED_IN_PATTERN.test(url.href) && !url.href.includes("/nlogin"),
      { timeout: 0 },
    );
  }

  logger.info({ url: page.url() }, "Login confirmed — saving state");
  await page.waitForTimeout(3000);
  await context.storageState({ path: AUTH_FILE });
  logger.info({ authFile: AUTH_FILE }, "Auth state saved");

  await browser.close();
};

export default globalSetup;