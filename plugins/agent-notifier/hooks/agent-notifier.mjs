#!/usr/bin/env node

import {
  detectAgentHost,
  isNonInteractiveHookSession,
  launchNotification,
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

function shouldSkipStop(payload) {
  if (payload.stop_hook_active === true) return true;
  if (payload.cwd === `${process.env.HOME}/.codex/memories`) return true;
  return typeof payload.cwd === "string" && payload.cwd.includes("/.slock/");
}

function handleStop(payload) {
  if (shouldSkipStop(payload) || isNonInteractiveHookSession(payload)) return;
  launchNotification({
    host: detectAgentHost(),
    event: payload.hook_event_name || "Stop",
    model: payload.model,
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    cwd: payload.cwd || process.cwd(),
    lastMessage: payload.last_assistant_message?.slice(0, 3000),
  });
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return;
  }

  if (payload.hook_event_name === "Stop") {
    handleStop(payload);
  }
}

main().catch((error) => {
  if (process.env.AGENT_NOTIFIER_DEBUG) process.stderr.write(`${error.message}\n`);
});
