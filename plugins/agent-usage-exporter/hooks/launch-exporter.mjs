import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function launchUsageExporter(agent, payload = {}, root = pluginRoot) {
  try {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const child = spawn(process.execPath, [join(root, "hooks", "worker.mjs"), "--agent", agent, "--payload", encodedPayload], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // Lifecycle hooks must not fail a coding-agent session.
  }
}

async function readStdin() {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const agent = process.argv[2] || "codex";
  readStdin().then((payload) => launchUsageExporter(agent, payload));
}
