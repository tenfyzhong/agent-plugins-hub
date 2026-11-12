import { execFileSync } from "node:child_process";
import path from "node:path";

function readParentCommands() {
  const commands = [];
  let pid = process.ppid;
  for (let depth = 0; depth < 6 && pid > 1; depth += 1) {
    const output = execFileSync("ps", ["-o", "ppid=", "-o", "command=", "-p", String(pid)], {
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

function isHeadless(command) {
  const match = /^\s*(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+(.*))?$/.exec(command);
  if (!match || path.basename(match[1] || match[2] || match[3]) !== "agy") return false;
  return /(?:^|\s)(?:acp(?:\s|$)|-p(?:\s|$)|--(?:print|prompt|input-format)(?:=|\s|$))/.test(match[4] || "");
}

export function antigravityNotification(payload, { readParentCommands: readParents = readParentCommands } = {}) {
  if (payload?.fullyIdle !== true) return undefined;
  try {
    if (readParents().some(isHeadless)) return undefined;
  } catch {
    // As with other hosts, unavailable process metadata does not block notifications.
  }
  const cwd = payload.workspacePaths?.find((value) => typeof value === "string" && value);
  if (cwd?.includes("/.slock/")) return undefined;
  return {
    host: "Antigravity",
    event: "Stop",
    model: payload.modelName,
    sessionId: payload.conversationId,
    transcriptPath: payload.transcriptPath,
    cwd,
  };
}
