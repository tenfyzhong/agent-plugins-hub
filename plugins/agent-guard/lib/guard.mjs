import { execFileSync, spawn } from "node:child_process";
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
  if (env.CODEX_THREAD_ID) return "Codex";
  return env.CLAUDE_PLUGIN_ROOT ? "Claude Code" : "Codex";
}

export function buildTelegramMessage({
  host,
  event,
  model,
  sessionId,
  cwd,
  lastMessage,
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
  } = {},
) {
  const worker = spawnImpl(process.execPath, [workerPath], {
    detached: true,
    stdio: ["pipe", "ignore", "ignore"],
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
