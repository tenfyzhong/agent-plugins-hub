import { registerCloudflareKb } from "./cloudflare-kb.ts";

export default function cloudflareKb(pi: Parameters<typeof registerCloudflareKb>[0]) {
  registerCloudflareKb(pi);
}
