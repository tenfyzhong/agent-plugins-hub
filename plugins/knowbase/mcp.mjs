#!/usr/bin/env node
import readline from "node:readline";
import { handleJsonRpcMessage } from "./lib/mcp-server.mjs";

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const message = JSON.parse(trimmed);
    const response = await handleJsonRpcMessage(message);
    if (response) {
      process.stdout.write(JSON.stringify(response) + "\n");
    }
  } catch (err) {
    const errorResponse = {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32700,
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`
      }
    };
    process.stdout.write(JSON.stringify(errorResponse) + "\n");
  }
});
