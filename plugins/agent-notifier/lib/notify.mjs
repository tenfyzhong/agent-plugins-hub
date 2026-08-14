import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function detectAgentHost(env = process.env) {
  if (env.AGENT_NOTIFIER_HOST) return env.AGENT_NOTIFIER_HOST;
  if (env.PLUGIN_ROOT || env.CODEX_THREAD_ID) return "Codex";
  return env.CLAUDE_PLUGIN_ROOT ? "Claude Code" : "Codex";
}

function readTranscriptStart(transcriptPath) {
  const buffer = Buffer.alloc(64 * 1024);
  const descriptor = openSync(transcriptPath, "r");
  try {
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead).split(/\r?\n/, 1)[0];
  } finally {
    closeSync(descriptor);
  }
}

function isNonInteractiveClaudeEntrypoint(entrypoint) {
  if (typeof entrypoint !== "string") return false;
  return (
    /(^|[-_])sdk($|[-_])/i.test(entrypoint) ||
    entrypoint === "agent_sdk" ||
    entrypoint.includes("github-action")
  );
}

function readParentCommands(startPid = process.ppid, execFile = execFileSync) {
  const commands = [];
  let pid = startPid;

  for (let depth = 0; depth < 6 && Number.isInteger(pid) && pid > 1; depth += 1) {
    const output = execFile("ps", ["-o", "ppid=", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = /^\s*(\d+)\s+(.+)$/.exec(output.trim());
    if (!match) break;
    commands.push(match[2]);
    pid = Number(match[1]);
  }

  return commands;
}

function isCodexExecCommand(command) {
  if (typeof command !== "string") return false;
  const match = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))\s+(\S+)/.exec(command);
  if (!match || match[4] !== "exec") return false;
  const executable = path.basename(match[1] || match[2] || match[3]);
  return executable === "codex" || executable.startsWith("codex-");
}

export function isNonInteractiveHookSession(
  payload,
  {
    env = process.env,
    readTranscriptStart: readStart = readTranscriptStart,
    readParentCommands: readParents = readParentCommands,
  } = {},
) {
  if (isNonInteractiveClaudeEntrypoint(env.CLAUDE_CODE_ENTRYPOINT)) return true;

  if (typeof payload?.transcript_path === "string") {
    try {
      const record = JSON.parse(readStart(payload.transcript_path));
      const metadata = record?.payload && typeof record.payload === "object" ? record.payload : record;
      if (
        metadata?.originator === "codex_exec" ||
        metadata?.source === "exec" ||
        isNonInteractiveClaudeEntrypoint(metadata?.entrypoint)
      ) {
        return true;
      }
      if (metadata?.originator || metadata?.source || metadata?.entrypoint) return false;
    } catch {
      // Fall back to the process tree for ephemeral or unavailable transcripts.
    }
  }

  try {
    return readParents().some(isCodexExecCommand);
  } catch {
    return false;
  }
}

export function shouldNotifyExtensionContext(context) {
  if (typeof context?.hasUI === "boolean") return context.hasUI;
  if (typeof context?.mode === "string") {
    return context.mode === "tui" || context.mode === "interactive";
  }
  return true;
}

function normalizeRateLimitWindow(window) {
  if (!window || typeof window !== "object") return undefined;
  const usedPercent = Number(window.usedPercent ?? window.used_percent ?? window.used_percentage);
  if (!Number.isFinite(usedPercent)) return undefined;
  const resetsAt = Number(window.resetsAt ?? window.resets_at);
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    ...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
  };
}

function normalizeCodexRateLimits(rateLimits) {
  if (!rateLimits || typeof rateLimits !== "object") return undefined;
  const windows = [rateLimits.primary, rateLimits.secondary]
    .map((window) => ({ raw: window, normalized: normalizeRateLimitWindow(window) }))
    .filter(({ normalized }) => normalized);
  const fiveHour = windows.find(({ raw }) => Number(raw.window_minutes) === 300)?.normalized;
  const weekly = windows.find(({ raw }) => Number(raw.window_minutes) === 10080)?.normalized;
  const normalized = {
    ...(fiveHour ? { fiveHour } : {}),
    ...(weekly ? { weekly } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeClaudeRateLimits(input) {
  const rateLimits = input?.rate_limits;
  if (!rateLimits || typeof rateLimits !== "object") return undefined;
  const fiveHour = normalizeRateLimitWindow(rateLimits.five_hour);
  const weekly = normalizeRateLimitWindow(rateLimits.seven_day);
  const normalized = {
    ...(fiveHour ? { fiveHour } : {}),
    ...(weekly ? { weekly } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function codexRateLimitsFromRecord(record) {
  if (record?.payload?.type !== "token_count") return undefined;
  return normalizeCodexRateLimits(record.payload.rate_limits);
}

export function extractCodexRateLimits(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return undefined;

  let descriptor;
  try {
    descriptor = openSync(transcriptPath, "r");
    let position = statSync(transcriptPath).size;
    let trailing = Buffer.alloc(0);
    const chunkSize = 64 * 1024;

    const parseLine = (line) => {
      if (line.length === 0) return undefined;
      try {
        return codexRateLimitsFromRecord(JSON.parse(line.toString("utf8")));
      } catch {
        return undefined;
      }
    };

    while (position > 0) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      const bytesRead = readSync(descriptor, chunk, 0, length, position);
      const combined = Buffer.concat([chunk.subarray(0, bytesRead), trailing]);
      let lineEnd = combined.length;

      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) continue;
        const limits = parseLine(combined.subarray(index + 1, lineEnd));
        if (limits) return limits;
        lineEnd = index;
      }
      trailing = combined.subarray(0, lineEnd);
    }

    return parseLine(trailing);
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function rateLimitCacheRoot(env = process.env) {
  const base = env.XDG_CACHE_HOME || path.join(env.HOME || os.homedir(), ".cache");
  return path.join(base, "agent-notifier", "claude-rate-limits");
}

function rateLimitCachePath(sessionId, cacheRoot) {
  if (typeof sessionId !== "string" || !sessionId) return undefined;
  return path.join(cacheRoot, `${Buffer.from(sessionId).toString("base64url")}.json`);
}

export function cacheClaudeRateLimits(input, { cacheRoot = rateLimitCacheRoot() } = {}) {
  const limits = normalizeClaudeRateLimits(input);
  const cachePath = rateLimitCachePath(input?.session_id, cacheRoot);
  if (!limits || !cachePath) return undefined;

  try {
    mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
    const temporaryPath = `${cachePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(limits), { mode: 0o600 });
    renameSync(temporaryPath, cachePath);
    return limits;
  } catch {
    return undefined;
  }
}

export function readClaudeRateLimits(sessionId, { cacheRoot = rateLimitCacheRoot() } = {}) {
  const cachePath = rateLimitCachePath(sessionId, cacheRoot);
  if (!cachePath) return undefined;
  try {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    const fiveHour = normalizeRateLimitWindow(cached.fiveHour);
    const weekly = normalizeRateLimitWindow(cached.weekly);
    const normalized = {
      ...(fiveHour ? { fiveHour } : {}),
      ...(weekly ? { weekly } : {}),
    };
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export function resolveNotificationRateLimits(
  notification,
  { cacheRoot = rateLimitCacheRoot() } = {},
) {
  if (notification?.rateLimits) {
    const fiveHour = normalizeRateLimitWindow(notification.rateLimits.fiveHour);
    const weekly = normalizeRateLimitWindow(notification.rateLimits.weekly);
    const normalized = {
      ...(fiveHour ? { fiveHour } : {}),
      ...(weekly ? { weekly } : {}),
    };
    if (Object.keys(normalized).length > 0) return normalized;
  }
  if (notification?.host === "Codex") {
    return extractCodexRateLimits(notification.transcriptPath);
  }
  if (notification?.host === "Claude Code") {
    return readClaudeRateLimits(notification.sessionId, { cacheRoot });
  }
  return undefined;
}

export async function resolveNotificationRateLimitsAfterRefresh(
  notification,
  {
    waitImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    ...options
  } = {},
) {
  if (notification?.host === "Claude Code") await waitImpl(500);
  return resolveNotificationRateLimits(notification, options);
}

function formatPercent(value) {
  return `${Math.round(value * 10) / 10}%`;
}

function remainingPercent(window) {
  return Math.min(100, Math.max(0, 100 - window.usedPercent));
}

export function buildRateLimitStatusLine(rateLimits) {
  const parts = [];
  if (rateLimits?.fiveHour) {
    parts.push(`5h remaining: ${formatPercent(remainingPercent(rateLimits.fiveHour))}`);
  }
  if (rateLimits?.weekly) {
    parts.push(`weekly remaining: ${formatPercent(remainingPercent(rateLimits.weekly))}`);
  }
  return parts.join(" | ");
}

export function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function rateLimitMessageLine(label, window) {
  const reset = Number.isFinite(window.resetsAt)
    ? ` (resets <code>${htmlEscape(new Date(window.resetsAt * 1000).toISOString())}</code>)`
    : "";
  return `<b>${label} remaining:</b> <code>${formatPercent(remainingPercent(window))}</code>${reset}`;
}

export function buildTelegramMessage({
  host,
  event,
  model,
  sessionId,
  cwd,
  lastMessage,
  rateLimits,
  timestamp = new Date().toISOString(),
}) {
  const lines = [
    `👋 <b>${htmlEscape(host || "Agent")} job finished</b>`,
    `<b>time:</b> <code>${htmlEscape(timestamp)}</code>`,
    `<b>type:</b> <code>${htmlEscape(event || "finished")}</code>`,
  ];
  if (model) lines.push(`<b>model:</b> <code>${htmlEscape(model)}</code>`);
  if (sessionId) lines.push(`<b>session id:</b> <code>${htmlEscape(sessionId)}</code>`);
  if (cwd) lines.push(`<b>pwd:</b> <code>${htmlEscape(cwd)}</code>`);
  if (rateLimits?.fiveHour) lines.push(rateLimitMessageLine("5h", rateLimits.fiveHour));
  if (rateLimits?.weekly) lines.push(rateLimitMessageLine("weekly", rateLimits.weekly));
  if (lastMessage) lines.push(`<b>last assistant message:</b>\n<pre>${htmlEscape(lastMessage)}</pre>`);
  return lines.join("\n");
}

export function buildWebhookPayload({
  host,
  event,
  model,
  sessionId,
  cwd,
  lastMessage,
  transcriptPath,
  rateLimits,
  timestamp = new Date().toISOString(),
}) {
  const payload = {
    host: host || "Agent",
    event: event || "finished",
    timestamp,
  };
  if (model) payload.model = model;
  if (sessionId) payload.sessionId = sessionId;
  if (cwd) payload.cwd = cwd;
  if (transcriptPath) payload.transcriptPath = transcriptPath;
  if (lastMessage) payload.lastMessage = lastMessage;
  if (rateLimits) payload.rateLimits = rateLimits;
  return payload;
}

export async function sendTelegramNotification({ token, chatId, text, fetchImpl = globalThis.fetch }) {
  if (!token || !chatId) throw new Error("Telegram credentials are not configured");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_notification: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Telegram API returned ${response.status}`);
  }
}

export async function sendWebhookNotification({ url, payload, fetchImpl = globalThis.fetch }) {
  if (!url) throw new Error("Webhook URL is not configured");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }
}

export function launchNotification(
  notification,
  {
    spawnImpl = spawn,
    workerPath = fileURLToPath(new URL("../hooks/notification-worker.mjs", import.meta.url)),
    runtimeExecPath = process.execPath,
    runtimeVersions = process.versions,
    runtimeEnv = process.env,
  } = {},
) {
  const workerExecutable =
    runtimeEnv.AGENT_NOTIFIER_NODE || (runtimeVersions.bun ? "node" : runtimeExecPath);
  const worker = spawnImpl(workerExecutable, [workerPath], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
    env: { ...runtimeEnv, NODE_USE_ENV_PROXY: "1" },
  });
  worker.stdin.on("error", () => {});
  worker.stdin.end(JSON.stringify(notification));
  worker.stdin.unref();
  worker.unref();
}

function readPassEntry(entry, execFile = execFileSync) {
  if (!entry) return undefined;
  try {
    return execFile("pass", [entry], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n", 1)[0]
      .trim();
  } catch {
    return undefined;
  }
}

export function resolveWebhookUrl(env = process.env, execFile = execFileSync) {
  return (
    env.AGENT_NOTIFIER_WEBHOOK_URL ||
    readPassEntry(env.AGENT_NOTIFIER_WEBHOOK_PASS_ENTRY || "agent-notifier/webhook-url", execFile)
  );
}

export function resolveTelegramCredentials(env = process.env, execFile = execFileSync) {
  const token =
    env.TELEGRAM_BOT_TOKEN ||
    readPassEntry(env.TELEGRAM_BOT_TOKEN_PASS_ENTRY || "agent-notifier/telegram-bot-token", execFile);
  const chatId =
    env.TELEGRAM_CHAT_ID ||
    readPassEntry(env.TELEGRAM_CHAT_ID_PASS_ENTRY || "agent-notifier/telegram-chat-id", execFile);
  return token && chatId ? { token, chatId } : undefined;
}
