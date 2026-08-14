import { registerAgentUsageExporter } from "./agent-usage-exporter.ts";

export default function agentUsageExporterOmp(pi: Parameters<typeof registerAgentUsageExporter>[0]) {
  registerAgentUsageExporter(pi, "oh-my-pi", "session_stop");
}
