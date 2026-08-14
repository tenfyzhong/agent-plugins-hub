import { dangerousCommandReason } from "../lib/guard.mjs";

type ExtensionAPI = {
  on(name: string, handler: (event: any, context: any) => Promise<unknown>): void;
};

export function registerAgentGuard(pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;
    const reason = dangerousCommandReason(event.input.command);
    if (!reason) return undefined;
    return { block: true, reason: `Dangerous command blocked: ${reason}.` };
  });
}

export default registerAgentGuard;
