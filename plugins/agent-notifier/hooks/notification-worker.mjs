import fs from "node:fs";

import {
  buildTelegramMessage,
  buildWebhookPayload,
  resolveNotificationRateLimitsAfterRefresh,
  resolveTelegramCredentials,
  resolveWebhookUrl,
  sendTelegramNotification,
  sendWebhookNotification,
} from "../lib/notify.mjs";

async function main() {
  const payload = fs.readFileSync(process.stdin.fd, "utf8");
  if (!payload) return;
  const notification = JSON.parse(payload);
  const rateLimits = await resolveNotificationRateLimitsAfterRefresh(notification);

  const webhookUrl = resolveWebhookUrl();
  if (webhookUrl) {
    await sendWebhookNotification({
      url: webhookUrl,
      payload: buildWebhookPayload({ ...notification, rateLimits }),
    });
    return;
  }

  const credentials = resolveTelegramCredentials();
  if (!credentials) return;
  const text = buildTelegramMessage({ ...notification, rateLimits });
  await sendTelegramNotification({ ...credentials, text });
}

main().catch(() => {});
