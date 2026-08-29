import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type ExtensionAPI = {
  on(name: string, handler: (event: unknown, context: unknown) => Promise<unknown>): void;
};

export async function executeKbSearch(
  query: string,
  options: { topK?: number; source?: string } = {}
): Promise<string> {
  const args = ["search", query, "--json"];
  if (options.topK) {
    args.push("--top-k", String(options.topK));
  }
  if (options.source) {
    args.push("--source", options.source);
  }

  try {
    const { stdout } = await execFileAsync("kb-cli", args, { timeout: 15000 });
    return stdout;
  } catch (err) {
    return JSON.stringify({
      error: "Failed to execute kb-cli",
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

export function registerCloudflareKb(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event: unknown) => {
    const ev = event as { toolName?: string; input?: { query?: string; topK?: number; source?: string } };
    if (ev?.toolName !== "search_knowledge_base") return undefined;

    const query = ev.input?.query;
    if (!query) {
      return { error: "Missing required parameter: query" };
    }

    const output = await executeKbSearch(query, {
      topK: ev.input?.topK,
      source: ev.input?.source
    });

    return { content: output };
  });
}

export default registerCloudflareKb;
