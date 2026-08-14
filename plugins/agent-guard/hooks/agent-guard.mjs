#!/usr/bin/env node

import { dangerousCommandReason } from "../lib/guard.mjs";

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

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    return;
  }

  if (payload.hook_event_name === "PreToolUse") {
    handlePreToolUse(payload);
  }
}

main().catch((error) => {
  if (process.env.AGENT_GUARD_DEBUG) process.stderr.write(`${error.message}\n`);
});
