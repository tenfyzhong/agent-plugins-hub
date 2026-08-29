import { registerCloudflareKb } from "./cf-knowbase.ts";

export default function cloudflareKb(pi: Parameters<typeof registerCloudflareKb>[0]) {
  registerCloudflareKb(pi);
}
