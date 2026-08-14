import { fileURLToPath } from "node:url";
import { launchUsageExporter } from "./launch-exporter.mjs";

export function isExpectedHost(agent, env = process.env) {
  if (agent === "codex") return Boolean(env.PLUGIN_ROOT) && !env.CLAUDE_PLUGIN_ROOT;
  if (agent === "claude-code") return Boolean(env.CLAUDE_PLUGIN_ROOT);
  return false;
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

async function main() {
  const agent = process.argv[2];
  if (!isExpectedHost(agent)) return;
  launchUsageExporter(agent, await readStdin());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => {});
