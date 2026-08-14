import { registerAgentNotifier } from "./agent-notifier.ts";

export default function agentNotifier(pi: Parameters<typeof registerAgentNotifier>[0]) {
  registerAgentNotifier(pi, "oh-my-pi");
}
