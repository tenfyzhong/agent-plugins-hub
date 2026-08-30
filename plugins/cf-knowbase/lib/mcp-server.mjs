import { searchKnowledgeBase, formatResults } from "./search.mjs";

export const TOOLS = [
  {
    name: "search_knowledge_base",
    description:
      "Search personal knowledge base (documents, Obsidian notes, blog posts, and repositories) using semantic similarity search.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query or question to look up in the knowledge base."
        },
        topK: {
          type: "integer",
          description: "Maximum number of results to return (default: 5)."
        },
        source: {
          type: "string",
          description: "Optional source filter to restrict search (e.g. 'obsidian-notes', 'blog', 'tidb-docs')."
        }
      },
      required: ["query"]
    }
  }
];

export async function handleJsonRpcMessage(message) {
  if (!message || typeof message !== "object") {
    return {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    };
  }

  const { id, method, params } = message;

  // Handle notifications (no id)
  if (id === undefined || id === null) {
    return null;
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "cf-knowbase",
          version: "0.1.0"
        }
      }
    };
  }

  if (method === "ping") {
    return {
      jsonrpc: "2.0",
      id,
      result: {}
    };
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: TOOLS
      }
    };
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName !== "search_knowledge_base") {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Tool not found: ${toolName}` }
      };
    }

    if (!args.query || typeof args.query !== "string") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: "Error: Missing required parameter 'query'." }],
          isError: true
        }
      };
    }

    try {
      const response = await searchKnowledgeBase({
        query: args.query,
        topK: args.topK || 5,
        source: args.source
      });

      const formatted = formatResults(response);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: formatted
            }
          ]
        }
      };
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: `Search error: ${messageText}`
            }
          ],
          isError: true
        }
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  };
}
