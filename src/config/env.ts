import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

const envPath = path.resolve(process.cwd(), ".env");
const dotenvResult = dotenv.config({ path: envPath });

if (dotenvResult.error) {
  console.warn(`⚠️ Could not load .env from: ${envPath}`);
}

const booleanFromString = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === null || value === "") return defaultValue;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value === 1;
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
      throw new Error(`Invalid boolean value: "${value}"`);
    });

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}, z.string().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    HEADLESS: booleanFromString(false),
    BROWSER_CHANNEL: z.enum(["chrome", "msedge", "chromium"]).default("chrome"),
    SLOW_MO: z.coerce.number().int().nonnegative().default(100),
    VIDEO_RECORDING: booleanFromString(true),

    // Naukri auth
    NAUKRI_USERNAME: optionalNonEmptyString,
    NAUKRI_PASSWORD: optionalNonEmptyString,
    NAUKRI_AUTH_STATE: z.string().min(1).default("./.auth/naukri.json"),

    // Search
    JOB_SEARCH_KEYWORDS: z.string().min(1).default("MERN Stack Developer"),
    JOB_SEARCH_LOCATION: z.string().min(1).default("Noida OR Delhi"),
    JOB_SEARCH_MIN_EXP: z.coerce.number().int().nonnegative().default(1),
    JOB_SEARCH_MAX_EXP: z.coerce.number().int().nonnegative().default(4),
    JOB_SEARCH_JOB_AGE: z.coerce.number().int().positive().default(3),

    // Pacing
    JOB_APPLY_DELAY_MIN: z.coerce.number().int().nonnegative().default(2000),
    JOB_APPLY_DELAY_MAX: z.coerce.number().int().nonnegative().default(6000),

    // Storage
    DB_PATH: z.string().min(1).default("./storage/applications.db"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // Optional
    SLACK_WEBHOOK_URL: optionalNonEmptyString,
  })
  .superRefine((values, context) => {
    if (values.JOB_APPLY_DELAY_MAX < values.JOB_APPLY_DELAY_MIN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JOB_APPLY_DELAY_MAX"],
        message: "JOB_APPLY_DELAY_MAX must be >= JOB_APPLY_DELAY_MIN",
      });
    }
    if (values.JOB_SEARCH_MAX_EXP < values.JOB_SEARCH_MIN_EXP) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JOB_SEARCH_MAX_EXP"],
        message: "JOB_SEARCH_MAX_EXP must be >= JOB_SEARCH_MIN_EXP",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  throw new Error("Environment validation failed");
}

export const env = parsed.data;
export type Environment = z.infer<typeof envSchema>;