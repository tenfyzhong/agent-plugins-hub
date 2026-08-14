import { launchUsageExporter } from "../hooks/launch-exporter.mjs";

type ExtensionApi = {
  on(name: string, handler: (event: Record<string, unknown>, context: SessionContext) => unknown): void;
};

type SessionContext = {
  sessionManager?: { getSessionFile?: () => string | undefined };
};

export function registerAgentUsageExporter(pi: ExtensionApi, agent = "pi", eventName = "session_shutdown") {
  pi.on(eventName, (event, ctx) => {
    const sessionPath = event?.session_path || event?.sessionPath || ctx?.sessionManager?.getSessionFile?.();
    launchUsageExporter(agent, sessionPath ? { ...event, session_path: sessionPath } : event || {});
  });
}

export default function agentUsageExporter(pi: ExtensionApi) {
  registerAgentUsageExporter(pi);
}
