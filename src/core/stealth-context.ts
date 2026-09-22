import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export interface LaunchOptions {
  storageStatePath?: string;
  headless?: boolean;
}

export type StealthContext = ReturnType<typeof createStealthContext>;

export const createStealthContext = () => {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  const launch = async (options: LaunchOptions = {}): Promise<BrowserContext> => {
    const headless = options.headless ?? env.HEADLESS;

    browser = await chromium.launch({
      headless,
      channel: env.BROWSER_CHANNEL === "chromium" ? undefined : env.BROWSER_CHANNEL,
      slowMo: env.SLOW_MO,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-infobars",
        "--ignore-certificate-errors",
      ],
    });

    const videoDir = path.resolve(process.cwd(), "storage/videos");
    fs.mkdirSync(videoDir, { recursive: true });

    const contextOptions: Record<string, unknown> = {
      viewport: { width: 1366, height: 768 },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      permissions: ["geolocation"],
      geolocation: { latitude: 28.6139, longitude: 77.209 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      recordVideo:
        env.VIDEO_RECORDING
          ? { dir: videoDir, size: { width: 1366, height: 768 } }
          : undefined,
    };

    if (options.storageStatePath && fs.existsSync(options.storageStatePath)) {
      try {
        const raw = fs.readFileSync(options.storageStatePath, "utf-8");
        contextOptions.storageState = JSON.parse(raw);
        logger.info({ path: options.storageStatePath }, "Loaded storage state");
      } catch (err) {
        logger.warn(
          { path: options.storageStatePath, err },
          "Failed to read storage state — starting fresh",
        );
      }
    }

    context = await browser.newContext(contextOptions);

    await context
      .grantPermissions(["geolocation"], { origin: "https://www.naukri.com" })
      .catch(() => {});

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // @ts-ignore
      window.chrome = { runtime: {} };
    });

    logger.info("Stealth browser context created");
    return context;
  };

  const newPage = async (): Promise<Page> => {
    if (!context) throw new Error("Browser context not launched");
    return context.newPage();
  };

  const saveStorageState = async (filePath: string): Promise<void> => {
    if (!context) return;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await context.storageState({ path: filePath });
    logger.info({ path: filePath }, "Storage state saved");
  };

  const close = async (): Promise<void> => {
    if (context) await context.close();
    if (browser) await browser.close();
    context = null;
    browser = null;
    logger.info("Browser closed");
  };

  return {
    launch,
    newPage,
    saveStorageState,
    close,
    getContext: () => context,
    getBrowser: () => browser,
  };
};