import type { Page } from "@playwright/test";

export type HumanBehavior = ReturnType<typeof createHumanBehavior>;

export const createHumanBehavior = (page: Page) => {
  const randomDelay = async (min = 1200, max = 5000): Promise<number> => {
    const safeMin = Math.max(800, min);
    const safeMax = Math.max(safeMin + 500, max);
    const delay = Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
    await page.waitForTimeout(delay);
    return delay;
  };

  const randomTypingDelay = () => Math.floor(Math.random() * 90) + 40;

  const humanType = async (selector: string, text: string): Promise<void> => {
    const el = page.locator(selector);
    await el.click();
    await randomDelay(300, 700);
    for (const char of text) {
      await el.pressSequentially(char, { delay: randomTypingDelay() });
    }
  };

  const humanClick = async (selector: string): Promise<void> => {
    const el = page.locator(selector);
    await el.hover();
    await randomDelay(200, 600);
    await el.click();
  };

  const scrollRandomly = async (): Promise<void> => {
    await page.mouse.wheel(0, Math.floor(Math.random() * 500) + 200);
    await randomDelay(600, 1400);
  };

  const moveMouseRandomly = async (): Promise<void> => {
    const x = Math.floor(Math.random() * 900) + 100;
    const y = Math.floor(Math.random() * 500) + 80;
    await page.mouse.move(x, y, { steps: 12 });
  };

  return { randomDelay, humanType, humanClick, scrollRandomly, moveMouseRandomly };
};