#!/usr/bin/env node

import {
  buildTelegramMessage,
  detectAgentHost,
  dangerousCommandReason,
  resolveTelegramCredentials,
  sendTelegramNotification,
} from "../lib/guard.mjs";

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

function handlePreToolUse(payload) {
  if (payload.tool_name !== "Bash" && payload.tool_name !== "bash") return;
  const reason = dangerousCommandReason(payload.tool_input?.command);
  if (!reason) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: payload.hook_event_name || "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Dangerous command blocked: ${reason}.`,
      },
    }),
  );
}

async function handleStop(payload) {
  if (shouldSkipStop(payload)) return;
  const credentials = resolveTelegramCredentials();
  if (!credentials) return;

  const text = buildTelegramMessage({
    host: detectAgentHost(),
    event: payload.hook_event_name || "Stop",
    model: payload.model,
    sessionId: payload.session_id,
    cwd: payload.cwd || process.cwd(),
    lastMessage: payload.last_assistant_message?.slice(0, 3000),
  });
  await sendTelegramNotification({ ...credentials, text });
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return;
  }

  if (payload.hook_event_name === "PreToolUse") {
    handlePreToolUse(payload);
  } else if (payload.hook_event_name === "Stop") {
    await handleStop(payload);
  }
}

main().catch((error) => {
  if (process.env.AGENT_GUARD_DEBUG) process.stderr.write(`${error.message}\n`);
});
