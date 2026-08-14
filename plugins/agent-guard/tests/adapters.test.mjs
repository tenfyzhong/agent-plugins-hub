import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = path.join(pluginRoot, "hooks", "agent-guard.mjs");
const ompExtensionPath = path.join(pluginRoot, "extensions", "agent-guard-omp.ts");
const extensionPath = path.join(pluginRoot, "extensions", "agent-guard.ts");

test("PreToolUse hook command enables Node environment proxy support", () => {
  const hooksConfig = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"),
  );

  const command = hooksConfig.hooks.PreToolUse[0].hooks[0].command;
  assert.match(command, /NODE_USE_ENV_PROXY=1 node /);
  assert.equal(hooksConfig.hooks.Stop, undefined);
});

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

test("oh-my-pi extension registers the same command guard", async () => {
  const handlers = new Map();
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  const extension = (await import(`${pathToFileURL(ompExtensionPath).href}?omp-guard-test`)).default;
  extension(pi);

  const toolCall = handlers.get("tool_call");
  assert.deepEqual(
    await toolCall({ toolName: "bash", input: { command: "rm -rf /tmp/project" } }, {}),
    { block: true, reason: "Dangerous command blocked: forced recursive deletion." },
  );
  assert.equal(handlers.has("agent_settled"), false);
  assert.equal(handlers.has("session_stop"), false);
});
