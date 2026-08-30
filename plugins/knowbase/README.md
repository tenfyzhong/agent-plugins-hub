# Knowledge Base Plugin (`knowbase`)

Cross-agent plugin, skill, and MCP server for semantic search over personal notes (Obsidian), documents, code repositories, and articles indexed in Cloudflare Vectorize.

## Supported Agents

- **Claude Code**: Install as a Plugin (`claude plugin install`), automatically activating the MCP server and skill (`/knowbase:knowbase`).
- **OpenAI Codex**: Install as a Plugin (`codex plugin add`) with OAuth connection authorization, MCP server, and skills.
- **Oh My Pi (OMP)**: Install as a Plugin (`omp plugin install`), automatically loading the native extension and MCP server.
- **Pi**: Install as an Extension (`pi install`), registering the `search_knowledge_base` native tool into Pi.
- **Claude Desktop & Cursor**: Direct stdio MCP server (`plugins/knowbase/mcp.mjs`).
- **ChatGPT (Web & Mobile)**: Custom GPT / Action with OAuth 2.0 authorization and OpenAPI schema.

---

## 1. Install as Plugin in Claude Code

Add the marketplace and install the plugin:
```bash
claude plugin marketplace add tenfyzhong/agent-plugins-hub
claude plugin install knowbase@tenfyzhong-agent-plugins-hub
```

Claude Code automatically mounts the bundled MCP server (`mcp.mjs`) and skill. Invoke explicitly with `/knowbase:knowbase` or let Claude automatically query your personal knowledge base during tasks.

---

## 2. Install as Plugin in OpenAI Codex

Add the marketplace and install the plugin:
```bash
codex plugin marketplace add tenfyzhong/agent-plugins-hub
codex plugin add knowbase@tenfyzhong-agent-plugins-hub
```

### Authorization & Connection in Codex / ChatGPT

When prompted to connect your knowledge base:
1. Open the authorization page: `https://knowbase-api.tenfy.cn/oauth/authorize`.
2. Enter your `API_TOKEN` and click **Authorize & Connect**.
3. Codex / ChatGPT receives the access token securely and enables the `searchKnowledgeBase` action.

---

## 3. Install as Plugin in Oh My Pi (OMP)

```bash
omp plugin marketplace add tenfyzhong/agent-plugins-hub
omp plugin install knowbase@tenfyzhong-agent-plugins-hub
```

OMP loads the native extension (`extensions/knowbase-omp.ts`) and MCP server.

---

## 4. Install as Extension in Pi

Pi loads extensions declared in package metadata:

```bash
pi install git:github.com/tenfyzhong/agent-plugins-hub
```

For local development from repository root:
```bash
pi install .
```

Pi automatically activates the `extensions/knowbase.ts` extension, providing the `search_knowledge_base` tool to all Pi sessions.

---

## 5. Standalone MCP Server Setup (Claude Desktop & Cursor)

You can connect the MCP server directly using `mcp.mjs`.

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "personal-knowledge-base": {
      "command": "node",
      "args": ["/Users/zhongtenghui/go/src/github.com/tenfyzhong/agent-plugins-hub/plugins/knowbase/mcp.mjs"]
    }
  }
}
```

---

## 6. Web ChatGPT / Mobile ChatGPT Custom GPT Setup

To use in ChatGPT Web or the iOS/Android ChatGPT app:
1. Go to **ChatGPT > Explore GPTs > Create**.
2. Go to **Configure > Actions > Create new action**.
3. In **Schema**, import from URL or paste:
   `https://knowbase-api.tenfy.cn/openapi.json`
4. Under **Authentication**, select **OAuth**:
   - **Client ID**: `chatgpt`
   - **Client Secret**: any string (e.g. `secret`)
   - **Authorization URL**: `https://knowbase-api.tenfy.cn/oauth/authorize`
   - **Token URL**: `https://knowbase-api.tenfy.cn/oauth/token`
   - **Scope**: `read`
   - **Token Exchange Method**: `Default (POST request)`
5. Save and click **Connect**. A mobile-responsive web page will open where you enter your `API_TOKEN` to authorize.
