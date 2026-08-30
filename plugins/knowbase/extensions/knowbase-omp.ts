import { registerKnowbase } from "./knowbase.ts";

export default function knowbase(pi: Parameters<typeof registerKnowbase>[0]) {
  registerKnowbase(pi);
}
