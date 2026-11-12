#!/usr/bin/env node

import { antigravityNotification } from "../lib/antigravity.mjs";
import { launchNotification } from "../lib/notify.mjs";

try {
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  const notification = antigravityNotification(JSON.parse(body));
  if (notification) launchNotification(notification);
} catch (error) {
  if (process.env.AGENT_NOTIFIER_DEBUG) process.stderr.write(`${error.message}\n`);
}
process.stdout.write(JSON.stringify({ decision: "allow" }));
