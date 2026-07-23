import { registerAgentGuard } from "../../extensions/agent-guard.ts";

export default function agentGuard(pi: Parameters<typeof registerAgentGuard>[0]) {
  registerAgentGuard(pi, "oh-my-pi");
}
