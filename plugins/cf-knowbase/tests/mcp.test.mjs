import test from "node:test";
import assert from "node:assert/strict";
import { formatResults } from "../lib/search.mjs";
import { handleJsonRpcMessage } from "../lib/mcp-server.mjs";

test("searchKnowledgeBase formats results properly", () => {
  const sampleResponse = {
    query: "architecture",
    count: 1,
    results: [
      {
        id: "obsidian:notes/arch.md:0",
        score: 0.92,
        text: "System architecture notes.",
        source: "obsidian",
        path: "notes/arch.md",
        title: "Architecture",
        chunkIndex: 0
      }
    ]
  };

  const output = formatResults(sampleResponse);
  assert.match(output, /Architecture/);
  assert.match(output, /Score: 0.920/);
  assert.match(output, /System architecture notes\./);
});

test("MCP JSON-RPC handles initialize and tools/list", async () => {
  const initRes = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  });

  assert.equal(initRes.id, 1);
  assert.equal(initRes.result.serverInfo.name, "cf-knowbase");
  assert.ok(initRes.result.capabilities.tools);

  const toolsRes = await handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });

  assert.equal(toolsRes.id, 2);
  assert.equal(toolsRes.result.tools.length, 1);
  assert.equal(toolsRes.result.tools[0].name, "search_knowledge_base");
});
