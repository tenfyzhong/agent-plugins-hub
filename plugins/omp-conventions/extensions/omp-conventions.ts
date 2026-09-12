import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return undefined;
}

export default function ompConventions(omp: ExtensionAPI) {
    omp.on("before_provider_request", (event) => {
        const request = asRecord(asRecord(event.payload)?.request);
        const parts = asRecord(request?.systemInstruction)?.parts;
        if (!Array.isArray(parts)) return undefined;

        let changed = false;
        for (const value of parts) {
            const part = asRecord(value);
            if (typeof part?.text !== "string") continue;
            const text = part.text.replace(/<(\/?)system[-_]conventions>/g, "<$1conventions>");
            if (text !== part.text) {
                part.text = text;
                changed = true;
            }
        }
        return changed ? event.payload : undefined;
    });
}
