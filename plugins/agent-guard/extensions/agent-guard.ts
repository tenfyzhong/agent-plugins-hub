import {
  dangerousCommandReason,
  launchTelegramNotification,
} from "../lib/guard.mjs";

type AgentMessageLike = {
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
};

type ExtensionAPI = {
  on(name: string, handler: (event: any, context: any) => Promise<unknown>): void;
};

function hostName(): string {
  if (process.env.AGENT_GUARD_HOST) return process.env.AGENT_GUARD_HOST;
  return process.argv.some((arg) => /(^|\/)omp$/.test(arg)) ? "oh-my-pi" : "pi";
}

function assistantText(messages: AgentMessageLike[]): string | undefined {
  const assistant = messages.findLast((message) => message.role === "assistant");
  if (!assistant) return undefined;
  if (typeof assistant.content === "string") return assistant.content.slice(0, 3000);
  if (!Array.isArray(assistant.content)) return undefined;
  const text = assistant.content
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("\n");
  return text ? text.slice(0, 3000) : undefined;
}

export default function agentGuard(pi: ExtensionAPI) {
  let lastMessage: string | undefined;

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return undefined;
    const reason = dangerousCommandReason(event.input.command);
    if (!reason) return undefined;
    return { block: true, reason: `Dangerous command blocked: ${reason}.` };
  });

  pi.on("agent_end", async (event) => {
    lastMessage = assistantText(event.messages);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    try {
      launchTelegramNotification({
        host: hostName(),
        event: "agent_settled",
        model: ctx.model?.id,
        sessionId: ctx.sessionManager.getSessionId(),
        cwd: ctx.cwd,
        lastMessage,
      });
    } catch (error) {
      if (process.env.AGENT_GUARD_DEBUG) {
        ctx.ui.notify(`Agent Guard notification worker failed to start: ${String(error)}`, "warning");
      }
    }
  });
}
