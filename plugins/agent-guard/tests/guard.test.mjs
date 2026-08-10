import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRateLimitStatusLine,
  buildTelegramMessage,
  cacheClaudeRateLimits,
  detectAgentHost,
  dangerousCommandReason,
  extractCodexRateLimits,
  isNonInteractiveHookSession,
  launchTelegramNotification,
  normalizeClaudeRateLimits,
  readClaudeRateLimits,
  resolveNotificationRateLimits,
  resolveNotificationRateLimitsAfterRefresh,
  resolveTelegramCredentials,
  sendTelegramNotification,
  shouldNotifyExtensionContext,
} from "../lib/guard.mjs";

const blockedCommands = [
  ["rm -rf /tmp/project", "forced recursive deletion"],
  ["sudo rm -fr -- /var/tmp/cache", "forced recursive deletion"],
  ["env FOO=bar command rm --recursive --force ./build", "forced recursive deletion"],
  ["bash -lc 'rm -rf /tmp/project'", "forced recursive deletion"],
  ["echo \"$(rm -rf /tmp/project)\"", "forced recursive deletion"],
  ["eval 'git reset --hard HEAD'", "destructive git reset"],
  ["pass show production/database", "credential-store access"],
  ["git reset --hard HEAD~1", "destructive git reset"],
  ["git clean -fdx", "destructive git clean"],
  ["dd if=/dev/zero of=/dev/disk4", "raw device overwrite"],
  ["mkfs.ext4 /dev/sdb1", "filesystem formatting"],
  ["shutdown -h now", "host shutdown"],
];

for (const [command, expectedReason] of blockedCommands) {
  test(`blocks ${command}`, () => {
    assert.match(dangerousCommandReason(command) ?? "", new RegExp(expectedReason));
  });
}

const allowedCommands = [
  "rm ./build/output.txt",
  "rm -r ./build",
  "git reset --soft HEAD~1",
  "git clean -nfdx",
  "echo 'rm -rf /tmp/project'",
  "printf '%s\\n' pass",
  "go test ./...",
];

for (const command of allowedCommands) {
  test(`allows ${command}`, () => {
    assert.equal(dangerousCommandReason(command), undefined);
  });
}

test("builds an escaped, host-specific Telegram message", () => {
  const message = buildTelegramMessage({
    host: "Claude <Code>",
    event: "Stop",
    model: "claude&sonnet",
    sessionId: "session-1",
    cwd: "/tmp/a<b",
    lastMessage: "done & <safe>",
    timestamp: "2026-07-23 12:34:56",
  });

  assert.match(message, /<b>Claude &lt;Code&gt; job finished<\/b>/);
  assert.match(message, /claude&amp;sonnet/);
  assert.match(message, /\/tmp\/a&lt;b/);
  assert.match(message, /done &amp; &lt;safe&gt;/);
});

test("includes five-hour and weekly remaining quota in Telegram messages", () => {
  const message = buildTelegramMessage({
    host: "Codex",
    event: "Stop",
    rateLimits: {
      fiveHour: { usedPercent: 12.5, resetsAt: 1786356000 },
      weekly: { usedPercent: 91, resetsAt: 1786788000 },
    },
    timestamp: "2026-08-10T00:00:00.000Z",
  });

  assert.match(message, /<b>5h remaining:<\/b> <code>87\.5%<\/code>/);
  assert.match(message, /<b>weekly remaining:<\/b> <code>9%<\/code>/);
  assert.match(message, /resets <code>2026-08-10T10:00:00\.000Z<\/code>/);
  assert.match(message, /resets <code>2026-08-15T10:00:00\.000Z<\/code>/);
});

test("extracts the latest Codex five-hour and weekly rate-limit snapshot", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-guard-codex-limits-"));
  const transcriptPath = path.join(tempDir, "rollout.jsonl");
  try {
    const oldSnapshot = {
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: { used_percent: 80, window_minutes: 300, resets_at: 1000 },
          secondary: { used_percent: 90, window_minutes: 10080, resets_at: 2000 },
        },
      },
    };
    const newSnapshot = {
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          limit_id: "codex",
          primary: { used_percent: 25, window_minutes: 300, resets_at: 3000 },
          secondary: { used_percent: 40, window_minutes: 10080, resets_at: 4000 },
        },
      },
    };
    const unrelatedSnapshot = {
      type: "event_msg",
      payload: { type: "token_count", rate_limits: { limit_id: "premium" } },
    };
    fs.writeFileSync(
      transcriptPath,
      [oldSnapshot, { type: "response_item" }, newSnapshot, unrelatedSnapshot]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    assert.deepEqual(extractCodexRateLimits(transcriptPath), {
      fiveHour: { usedPercent: 25, resetsAt: 3000 },
      weekly: { usedPercent: 40, resetsAt: 4000 },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("normalizes Claude Code status-line rate limits", () => {
  const limits = normalizeClaudeRateLimits({
    rate_limits: {
      five_hour: { used_percentage: 23.5, resets_at: 5000 },
      seven_day: { used_percentage: 41.2, resets_at: 6000 },
    },
  });

  assert.deepEqual(limits, {
    fiveHour: { usedPercent: 23.5, resetsAt: 5000 },
    weekly: { usedPercent: 41.2, resetsAt: 6000 },
  });
  assert.equal(buildRateLimitStatusLine(limits), "5h remaining: 76.5% | weekly remaining: 58.8%");
});

test("caches Claude Code rate limits separately for each session", () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-guard-claude-limits-"));
  try {
    cacheClaudeRateLimits(
      {
        session_id: "session-a",
        rate_limits: {
          five_hour: { used_percentage: 10, resets_at: 7000 },
          seven_day: { used_percentage: 20, resets_at: 8000 },
        },
      },
      { cacheRoot },
    );
    cacheClaudeRateLimits(
      {
        session_id: "session-b",
        rate_limits: {
          five_hour: { used_percentage: 30, resets_at: 9000 },
          seven_day: { used_percentage: 40, resets_at: 10000 },
        },
      },
      { cacheRoot },
    );

    assert.deepEqual(readClaudeRateLimits("session-a", { cacheRoot }), {
      fiveHour: { usedPercent: 10, resetsAt: 7000 },
      weekly: { usedPercent: 20, resetsAt: 8000 },
    });
    assert.deepEqual(readClaudeRateLimits("session-b", { cacheRoot }), {
      fiveHour: { usedPercent: 30, resetsAt: 9000 },
      weekly: { usedPercent: 40, resetsAt: 10000 },
    });
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("resolves Claude Code notification quota from its session cache", () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-guard-notification-limits-"));
  try {
    cacheClaudeRateLimits(
      {
        session_id: "notification-session",
        rate_limits: {
          five_hour: { used_percentage: 35, resets_at: 11000 },
          seven_day: { used_percentage: 45, resets_at: 12000 },
        },
      },
      { cacheRoot },
    );

    assert.deepEqual(
      resolveNotificationRateLimits(
        { host: "Claude Code", sessionId: "notification-session" },
        { cacheRoot },
      ),
      {
        fiveHour: { usedPercent: 35, resetsAt: 11000 },
        weekly: { usedPercent: 45, resetsAt: 12000 },
      },
    );
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("waits for Claude Code's debounced status-line refresh before reading quota", async () => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-guard-refreshed-limits-"));
  let waited;
  try {
    const limits = await resolveNotificationRateLimitsAfterRefresh(
      { host: "Claude Code", sessionId: "refreshed-session" },
      {
        cacheRoot,
        waitImpl: async (milliseconds) => {
          waited = milliseconds;
          cacheClaudeRateLimits(
            {
              session_id: "refreshed-session",
              rate_limits: {
                five_hour: { used_percentage: 50, resets_at: 13000 },
                seven_day: { used_percentage: 60, resets_at: 14000 },
              },
            },
            { cacheRoot },
          );
        },
      },
    );

    assert.equal(waited, 500);
    assert.deepEqual(limits, {
      fiveHour: { usedPercent: 50, resetsAt: 13000 },
      weekly: { usedPercent: 60, resetsAt: 14000 },
    });
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("detects Codex when Claude compatibility variables are also present", () => {
  assert.equal(
    detectAgentHost({
      PLUGIN_ROOT: "/tmp/plugin",
      CLAUDE_PLUGIN_ROOT: "/tmp/plugin",
    }),
    "Codex",
  );
});

test("detects Claude Code from its plugin root", () => {
  assert.equal(detectAgentHost({ CLAUDE_PLUGIN_ROOT: "/tmp/plugin" }), "Claude Code");
});

test("allows the detected host to be overridden", () => {
  assert.equal(
    detectAgentHost({ AGENT_GUARD_HOST: "Custom Agent", CODEX_THREAD_ID: "thread-1" }),
    "Custom Agent",
  );
});

test("detects non-interactive Codex exec sessions from transcript metadata", () => {
  const nonInteractive = isNonInteractiveHookSession(
    { transcript_path: "/tmp/codex-exec.jsonl" },
    {
      env: {},
      readTranscriptStart: () => JSON.stringify({
        type: "session_meta",
        payload: { originator: "codex_exec", source: "exec" },
      }),
    },
  );

  assert.equal(nonInteractive, true);
});

test("keeps interactive Codex sessions eligible for notifications", () => {
  const nonInteractive = isNonInteractiveHookSession(
    { transcript_path: "/tmp/codex-tui.jsonl" },
    {
      env: {},
      readTranscriptStart: () => JSON.stringify({
        type: "session_meta",
        payload: { originator: "codex-tui", source: "cli" },
      }),
    },
  );

  assert.equal(nonInteractive, false);
});

test("detects ephemeral Codex exec sessions from the parent command", () => {
  const nonInteractive = isNonInteractiveHookSession(
    {},
    {
      env: {},
      readParentCommands: () => [
        "/bin/sh -c node /tmp/agent-guard.mjs",
        "/opt/homebrew/bin/codex exec --ephemeral do-work",
      ],
    },
  );

  assert.equal(nonInteractive, true);
});

test("detects non-interactive Claude Code sessions from their entrypoint", () => {
  assert.equal(
    isNonInteractiveHookSession({}, { env: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" } }),
    true,
  );
  assert.equal(
    isNonInteractiveHookSession(
      {},
      { env: { CLAUDE_CODE_ENTRYPOINT: "cli" }, readParentCommands: () => [] },
    ),
    false,
  );
});

test("only extension contexts with an interactive UI send completion notifications", () => {
  assert.equal(shouldNotifyExtensionContext({ hasUI: true, mode: "tui" }), true);
  assert.equal(shouldNotifyExtensionContext({ hasUI: false, mode: "print" }), false);
  assert.equal(shouldNotifyExtensionContext({ mode: "json" }), false);
  assert.equal(shouldNotifyExtensionContext({ mode: "rpc" }), false);
});

test("posts JSON to Telegram without exposing credentials in the body", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => "" };
  };

  await sendTelegramNotification({
    token: "test-token",
    chatId: "12345",
    text: "finished",
    fetchImpl,
  });

  assert.equal(request.url, "https://api.telegram.org/bottest-token/sendMessage");
  assert.deepEqual(JSON.parse(request.options.body), {
    chat_id: "12345",
    text: "finished",
    parse_mode: "HTML",
    disable_notification: false,
  });
  assert.equal(request.options.headers["content-type"], "application/json");
});

test("reports Telegram API failures", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "Unauthorized" });

  await assert.rejects(
    sendTelegramNotification({
      token: "bad-token",
      chatId: "12345",
      text: "finished",
      fetchImpl,
    }),
    /Telegram API returned 401/,
  );
});

test("launches Telegram notifications in a detached background worker", () => {
  let spawned;
  let unreferenced = false;
  let input;
  let inputUnreferenced = false;
  const spawnImpl = (command, args, options) => {
    spawned = { command, args, options };
    return {
      stdin: {
        end(value) { input = value; },
        on() {},
        unref() { inputUnreferenced = true; },
      },
      unref() { unreferenced = true; },
    };
  };

  launchTelegramNotification(
    { host: "Codex", event: "Stop", cwd: "/tmp/project", lastMessage: "done" },
    { spawnImpl, workerPath: "/tmp/notification-worker.mjs" },
  );

  assert.equal(spawned.command, process.execPath);
  assert.equal(spawned.args[0], "/tmp/notification-worker.mjs");
  assert.equal(spawned.args.length, 1);
  assert.deepEqual(JSON.parse(input), {
    host: "Codex",
    event: "Stop",
    cwd: "/tmp/project",
    lastMessage: "done",
  });
  assert.equal(spawned.options.detached, true);
  assert.deepEqual(spawned.options.stdio, ["pipe", "ignore", "ignore"]);
  assert.equal(spawned.options.env.NODE_USE_ENV_PROXY, "1");
  assert.equal(inputUnreferenced, true);
  assert.equal(unreferenced, true);
});

test("launches the notification worker with Node from a Bun host", () => {
  let spawnedCommand;
  const spawnImpl = (command) => {
    spawnedCommand = command;
    return {
      stdin: {
        end() {},
        on() {},
        unref() {},
      },
      unref() {},
    };
  };

  launchTelegramNotification(
    { host: "oh-my-pi", event: "session_stop" },
    {
      spawnImpl,
      workerPath: "/tmp/notification-worker.mjs",
      runtimeExecPath: "/opt/homebrew/bin/omp",
      runtimeVersions: { bun: "1.3.0" },
    },
  );

  assert.equal(spawnedCommand, "node");
});

test("resolves credentials from environment variables first", () => {
  const credentials = resolveTelegramCredentials(
    { TELEGRAM_BOT_TOKEN: "env-token", TELEGRAM_CHAT_ID: "env-chat" },
    () => assert.fail("password store must not be read"),
  );

  assert.deepEqual(credentials, { token: "env-token", chatId: "env-chat" });
});

test("falls back to the conventional password-store entries", () => {
  const requestedEntries = [];
  const credentials = resolveTelegramCredentials({}, (_command, [entry]) => {
    requestedEntries.push(entry);
    return entry.endsWith("bot-token") ? "pass-token\n" : "pass-chat\n";
  });

  assert.deepEqual(credentials, { token: "pass-token", chatId: "pass-chat" });
  assert.deepEqual(requestedEntries, [
    "agent-guard/telegram-bot-token",
    "agent-guard/telegram-chat-id",
  ]);
});
