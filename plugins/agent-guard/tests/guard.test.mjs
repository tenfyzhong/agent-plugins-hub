import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTelegramMessage,
  detectAgentHost,
  dangerousCommandReason,
  launchTelegramNotification,
  resolveTelegramCredentials,
  sendTelegramNotification,
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
