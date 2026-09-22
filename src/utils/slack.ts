// src/utils/slack.ts
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import type { JobCard } from "../platforms/base/types.js";

export async function sendJobToSlack(
  job: JobCard,
  type: "external" | "applied" = "external",
): Promise<void> {
  const webhookUrl = env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.debug("SLACK_WEBHOOK_URL is not set; skipping Slack alert.");
    return;
  }

  const isExternal = type === "external";
  const headerText = isExternal
    ? "🚨 *Manual / External Career Site Apply Needed*"
    : "✅ *Job Applied Successfully via Automation*";
  const buttonText = isExternal
    ? "Apply on Career Site 🔗"
    : "View Job Listing 🔗";

  // Button style is optional. Slack only allows "primary" / "danger".
  // For the default grey look, OMIT the `style` field entirely.
  const button: Record<string, unknown> = {
    type: "button",
    text: { type: "plain_text", text: buttonText, emoji: true },
    url: job.url,
  };
  if (isExternal) button.style = "primary";

  const payload = {
    text: headerText,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${headerText}\n\n*Job Title:* ${job.title}\n*Company:* ${job.company}\n*Location:* ${job.location || "N/A"}\n*Job ID:* \`${job.jobId}\`\n*Link:* ${job.url}`,
        },
      },
      { type: "actions", elements: [button] },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      logger.info(
        { jobId: job.jobId, title: job.title, type },
        "Sent job notification to Slack",
      );
    } else {
      const body = await response.text().catch(() => "");
      logger.error(
        { status: response.status, body },
        "Failed to send Slack webhook notification",
      );
    }
  } catch (error) {
    logger.error({ error }, "Error sending notification to Slack");
  }
}

export const sendExternalJobToSlack = (job: JobCard) =>
  sendJobToSlack(job, "external");
 