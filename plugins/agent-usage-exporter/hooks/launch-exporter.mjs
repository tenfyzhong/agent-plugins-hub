import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export function resolveWorkerExecutable(env = process.env, versions = process.versions, execPath = process.execPath) {
  if (env?.AGENT_USAGE_NODE) return env.AGENT_USAGE_NODE;
  if (versions?.bun) return "node";
  return execPath;
}

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function launchUsageExporter(agent, payload = {}, root = pluginRoot, options = {}) {
  try {
    const executable = options.executable || resolveWorkerExecutable(options.env, options.versions, options.execPath);
    const spawnImpl = options.spawnImpl || spawn;
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const child = spawnImpl(executable, [join(root, "hooks", "worker.mjs"), "--agent", agent, "--payload", encodedPayload], {
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
