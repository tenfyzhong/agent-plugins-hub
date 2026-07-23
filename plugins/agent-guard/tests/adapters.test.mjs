import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = path.join(pluginRoot, "hooks", "agent-guard.mjs");
const extensionPath = path.join(pluginRoot, "extensions", "agent-guard.ts");

function runHook(payload, env = {}) {
  return spawnSync(process.execPath, [hookPath], {
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: { ...process.env, ...env },
  });
}

test("Codex and Claude hook adapter denies a dangerous Bash call", () => {
  const result = runHook({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "rm -rf /tmp/project" },
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.permissionDecision, "deny");
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /forced recursive deletion/);
});

test("hook adapter leaves safe calls untouched", () => {
  const result = runHook({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "go test ./..." },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("stop hook is a no-op when Telegram credentials are absent", () => {
  const result = runHook(
    { hook_event_name: "Stop", cwd: "/tmp/project", last_assistant_message: "done" },
    {
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_CHAT_ID: "",
      TELEGRAM_BOT_TOKEN_PASS_ENTRY: "",
      TELEGRAM_CHAT_ID_PASS_ENTRY: "",
      PATH: "/usr/bin:/bin",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("pi extension blocks dangerous bash and allows safe bash", async () => {
  const handlers = new Map();
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  const extension = (await import(pathToFileURL(extensionPath))).default;
  extension(pi);

  const toolCall = handlers.get("tool_call");
  assert.deepEqual(
    await toolCall({ toolName: "bash", input: { command: "git reset --hard HEAD" } }, {}),
    { block: true, reason: "Dangerous command blocked: destructive git reset." },
  );
  assert.equal(await toolCall({ toolName: "bash", input: { command: "git status" } }, {}), undefined);
});

test("pi extension registers completion notification on agent_settled", async () => {
  const handlers = new Map();
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  const extension = (await import(`${pathToFileURL(extensionPath).href}?notification-test`)).default;
  extension(pi);

  assert.equal(typeof handlers.get("agent_settled"), "function");
});
