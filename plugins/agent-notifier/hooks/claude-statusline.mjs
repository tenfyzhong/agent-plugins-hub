#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import {
  buildRateLimitStatusLine,
  cacheClaudeRateLimits,
} from "../lib/notify.mjs";

function readStdin() {
  return new Promise((resolve) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("end", () => resolve(body));
  });
}

async function main() {
  const body = await readStdin();
  if (!body) return;
  const limits = cacheClaudeRateLimits(JSON.parse(body));
  if (process.env.AGENT_NOTIFIER_STATUSLINE_COMMAND) {
    const result = spawnSync(process.env.AGENT_NOTIFIER_STATUSLINE_COMMAND, {
      encoding: "utf8",
      env: process.env,
      input: body,
      shell: true,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    return;
  }
  if (!limits || process.argv.includes("--cache-only")) return;
  process.stdout.write(`${buildRateLimitStatusLine(limits)}\n`);
}

main().catch(() => {});
