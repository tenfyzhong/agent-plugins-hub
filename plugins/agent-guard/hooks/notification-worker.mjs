import fs from "node:fs";

import {
  buildTelegramMessage,
  resolveTelegramCredentials,
  sendTelegramNotification,
} from "../lib/guard.mjs";

async function main() {
  const payload = fs.readFileSync(process.stdin.fd, "utf8");
  if (!payload) return;
  const notification = JSON.parse(payload);
  const credentials = resolveTelegramCredentials();
  if (!credentials) return;

  const text = buildTelegramMessage(notification);
  await sendTelegramNotification({ ...credentials, text });
}

main().catch(() => {});
