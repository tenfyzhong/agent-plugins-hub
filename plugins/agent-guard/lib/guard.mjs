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

const SHELLS = new Set(["bash", "dash", "fish", "sh", "zsh"]);
const HOST_SHUTDOWN_COMMANDS = new Set(["halt", "poweroff", "reboot", "shutdown"]);

function shellCalls(command) {
  const calls = [];
  let call = [];
  let token = "";
  let quote = "";
  let escaped = false;

  const pushToken = () => {
    if (token.length > 0) {
      call.push(token);
      token = "";
    }
  };
  const pushCall = () => {
    pushToken();
    if (call.length > 0) {
      calls.push(call);
      call = [];
    }
  };

  for (const character of command) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = "";
      } else {
        token += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      pushToken();
      if (character === "\n") pushCall();
      continue;
    }
    if (";|&".includes(character)) {
      pushCall();
      continue;
    }
    token += character;
  }

  if (escaped) token += "\\";
  pushCall();
  return calls;
}

function commandSubstitutions(command) {
  const substitutions = [];
  let quote = "";
  let escaped = false;

  for (let index = 0; index < command.length - 1; index += 1) {
    const character = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (character === "'" || character === '"') {
      if (!quote) quote = character;
      else if (quote === character) quote = "";
      continue;
    }
    if (quote === "'" || character !== "$" || command[index + 1] !== "(") continue;

    let depth = 1;
    let innerQuote = "";
    let innerEscaped = false;
    const start = index + 2;
    let end = start;
    for (; end < command.length; end += 1) {
      const innerCharacter = command[end];
      if (innerEscaped) {
        innerEscaped = false;
        continue;
      }
      if (innerCharacter === "\\" && innerQuote !== "'") {
        innerEscaped = true;
        continue;
      }
      if (innerCharacter === "'" || innerCharacter === '"') {
        if (!innerQuote) innerQuote = innerCharacter;
        else if (innerQuote === innerCharacter) innerQuote = "";
        continue;
      }
      if (innerQuote === "'") continue;
      if (innerCharacter === "(") depth += 1;
      if (innerCharacter === ")") depth -= 1;
      if (depth === 0) break;
    }
    if (depth === 0) {
      substitutions.push(command.slice(start, end));
      index = end;
    }
  }

  return substitutions;
}

function unwrapCommand(tokens) {
  let index = 0;

  while (index < tokens.length) {
    const executable = path.basename(tokens[index]);
    if (executable === "sudo" || executable === "command") {
      index += 1;
      while (index < tokens.length && tokens[index].startsWith("-")) {
        if (tokens[index] === "--") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (executable === "env") {
      index += 1;
      while (index < tokens.length) {
        if (tokens[index] === "--") {
          index += 1;
          break;
        }
        if (tokens[index].startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    break;
  }

  return tokens.slice(index);
}

function hasShortFlag(token, flag) {
  return /^-[^-]/.test(token) && token.slice(1).includes(flag);
}

function rmReason(args) {
  const recursive = args.some((arg) => arg === "--recursive" || hasShortFlag(arg, "r") || hasShortFlag(arg, "R"));
  const force = args.some((arg) => arg === "--force" || hasShortFlag(arg, "f"));
  return recursive && force ? "forced recursive deletion" : undefined;
}

function gitReason(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    if (["-C", "-c", "--git-dir", "--work-tree"].includes(args[index])) index += 1;
    index += 1;
  }

  const subcommand = args[index];
  const subcommandArgs = args.slice(index + 1);
  if (subcommand === "reset" && subcommandArgs.includes("--hard")) return "destructive git reset";
  if (subcommand === "clean") {
    const dryRun = subcommandArgs.some((arg) => arg === "--dry-run" || hasShortFlag(arg, "n"));
    const force = subcommandArgs.some((arg) => arg === "--force" || hasShortFlag(arg, "f"));
    if (force && !dryRun) return "destructive git clean";
  }
  return undefined;
}

function nestedShellCommand(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-c" || arg === "--command" || (/^-[^-]*c/.test(arg) && arg !== "-c")) {
      return args[index + 1];
    }
  }
  return undefined;
}

function callDangerReason(rawTokens) {
  const tokens = unwrapCommand(rawTokens);
  if (tokens.length === 0) return undefined;

  const executable = path.basename(tokens[0]).toLowerCase();
  const args = tokens.slice(1);

  if (executable === "pass") return "credential-store access";
  if (executable === "rm") return rmReason(args);
  if (executable === "git") return gitReason(args);
  if (executable === "dd" && args.some((arg) => /^of=\/dev\//.test(arg))) return "raw device overwrite";
  if (executable === "mkfs" || executable.startsWith("mkfs.")) return "filesystem formatting";
  if (HOST_SHUTDOWN_COMMANDS.has(executable)) return "host shutdown";
  if (executable === "eval") return dangerousCommandReason(args.join(" "));
  if (SHELLS.has(executable)) {
    const nested = nestedShellCommand(args);
    if (nested) return dangerousCommandReason(nested);
  }

  return undefined;
}

export function dangerousCommandReason(command) {
  if (typeof command !== "string" || command.trim() === "") return undefined;

  for (const substitution of commandSubstitutions(command)) {
    const reason = dangerousCommandReason(substitution);
    if (reason) return reason;
  }

  for (const call of shellCalls(command)) {
    const reason = callDangerReason(call);
    if (reason) return reason;
  }
  return undefined;
}

export function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function detectAgentHost(env = process.env) {
  if (env.AGENT_GUARD_HOST) return env.AGENT_GUARD_HOST;
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
  return path.join(base, "agent-guard", "claude-rate-limits");
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

export function launchTelegramNotification(
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
    runtimeEnv.AGENT_GUARD_NODE || (runtimeVersions.bun ? "node" : runtimeExecPath);
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

export function resolveTelegramCredentials(env = process.env, execFile = execFileSync) {
  const token =
    env.TELEGRAM_BOT_TOKEN ||
    readPassEntry(env.TELEGRAM_BOT_TOKEN_PASS_ENTRY || "agent-guard/telegram-bot-token", execFile);
  const chatId =
    env.TELEGRAM_CHAT_ID ||
    readPassEntry(env.TELEGRAM_CHAT_ID_PASS_ENTRY || "agent-guard/telegram-chat-id", execFile);
  return token && chatId ? { token, chatId } : undefined;
}
