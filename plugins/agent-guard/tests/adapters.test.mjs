import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookPath = path.join(pluginRoot, "hooks", "agent-guard.mjs");
const claudeStatusLinePath = path.join(pluginRoot, "hooks", "claude-statusline.mjs");
const ompExtensionPath = path.join(pluginRoot, "extensions", "agent-guard-omp.ts");
const extensionPath = path.join(pluginRoot, "extensions", "agent-guard.ts");

test("hook commands enable Node environment proxy support", () => {
  const hooksConfig = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"),
  );

  for (const event of ["PreToolUse", "Stop"]) {
    const command = hooksConfig.hooks[event][0].hooks[0].command;
    assert.match(command, /NODE_USE_ENV_PROXY=1 node /);
  }
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

test("stop hook skips Telegram notifications for non-interactive sessions", () => {
  const result = runHook(
    { hook_event_name: "Stop", cwd: "/tmp/project", last_assistant_message: "done" },
    {
      AGENT_GUARD_NODE: path.join(pluginRoot, "missing-node"),
      CLAUDE_CODE_ENTRYPOINT: "sdk-cli",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("Claude status-line adapter caches quota and displays remaining percentages", () => {
  const cacheHome = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "agent-guard-cache-"));
  try {
    const result = spawnSync(process.execPath, [claudeStatusLinePath], {
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "claude-session-1",
        rate_limits: {
          five_hour: { used_percentage: 20, resets_at: 1786356000 },
          seven_day: { used_percentage: 70, resets_at: 1786788000 },
        },
      }),
      env: { ...process.env, XDG_CACHE_HOME: cacheHome },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "5h remaining: 80% | weekly remaining: 30%");
    const cachePath = path.join(
      cacheHome,
      "agent-guard",
      "claude-rate-limits",
      `${Buffer.from("claude-session-1").toString("base64url")}.json`,
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(cachePath, "utf8")), {
      fiveHour: { usedPercent: 20, resetsAt: 1786356000 },
      weekly: { usedPercent: 70, resetsAt: 1786788000 },
    });

    const proxied = spawnSync(process.execPath, [claudeStatusLinePath], {
      encoding: "utf8",
      input: JSON.stringify({
        session_id: "claude-session-1",
        rate_limits: {
          five_hour: { used_percentage: 21, resets_at: 1786356000 },
          seven_day: { used_percentage: 71, resets_at: 1786788000 },
        },
      }),
      env: {
        ...process.env,
        XDG_CACHE_HOME: cacheHome,
        AGENT_GUARD_STATUSLINE_COMMAND: "printf 'existing status\\n'",
      },
    });
    assert.equal(proxied.status, 0, proxied.stderr);
    assert.equal(proxied.stdout, "existing status\n");
  } finally {
    fs.rmSync(cacheHome, { recursive: true, force: true });
  }
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
  const source = fs.readFileSync(extensionPath, "utf8");
  assert.match(source, /launchTelegramNotification/);
  assert.match(source, /shouldNotifyExtensionContext\(ctx\)/);
  assert.doesNotMatch(source, /await sendTelegramNotification/);
});

test("oh-my-pi extension registers completion notification on session_stop", async () => {
  const handlers = new Map();
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  const previousHost = process.env.AGENT_GUARD_HOST;
  delete process.env.AGENT_GUARD_HOST;
  try {
    const extension = (await import(`${pathToFileURL(ompExtensionPath).href}?omp-stop-test`)).default;
    extension(pi);
  } finally {
    if (previousHost === undefined) delete process.env.AGENT_GUARD_HOST;
    else process.env.AGENT_GUARD_HOST = previousHost;
  }

  assert.equal(typeof handlers.get("session_stop"), "function");
  assert.equal(handlers.has("agent_settled"), false);
});
