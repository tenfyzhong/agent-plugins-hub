import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { searchKnowledgeBase, formatResults } from "../lib/search.mjs";

const execFileAsync = promisify(execFile);

type ExtensionAPI = {
  on(name: string, handler: (event: unknown, context: unknown) => Promise<unknown>): void;
};

export async function executeKnowbaseSearch(
  query: string,
  options: { topK?: number; source?: string } = {}
): Promise<string> {
  try {
    const response = await searchKnowledgeBase({
      query,
      topK: options.topK || 5,
      source: options.source
    });
    return formatResults(response);
  } catch (apiErr) {
    // Fallback to knowbase CLI if present
    const args = ["search", query, "--json"];
    if (options.topK) {
      args.push("--top-k", String(options.topK));
    }
    if (options.source) {
      args.push("--source", options.source);
    }

    try {
      const { stdout } = await execFileAsync("knowbase", args, { timeout: 15000 });
      return stdout;
    } catch {
      return JSON.stringify({
        error: "Failed to query knowledge base",
        message: apiErr instanceof Error ? apiErr.message : String(apiErr)
      });
    }
  }
}

export function registerKnowbase(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event: unknown) => {
    const ev = event as { toolName?: string; input?: { query?: string; topK?: number; source?: string } };
    if (ev?.toolName !== "search_knowledge_base") return undefined;

    const query = ev.input?.query;
    if (!query) {
      return { error: "Missing required parameter: query" };
    }

    const output = await executeKnowbaseSearch(query, {
      topK: ev.input?.topK,
      source: ev.input?.source
    });

    return { content: output };
  });
}

export default registerKnowbase;
