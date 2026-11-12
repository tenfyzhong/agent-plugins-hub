#!/usr/bin/env node

import { dangerousCommandReason } from "../lib/guard.mjs";

try {
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  const payload = JSON.parse(body);
  const reason = payload?.toolCall?.name === "run_command"
    ? dangerousCommandReason(payload.toolCall.args?.CommandLine)
    : undefined;
  process.stdout.write(JSON.stringify(reason
    ? { decision: "deny", reason: `Dangerous command blocked: ${reason}.` }
    : { decision: "allow" }));
} catch (error) {
  if (process.env.AGENT_GUARD_DEBUG) process.stderr.write(`${error.message}\n`);
  process.stdout.write(JSON.stringify({ decision: "allow" }));
}
