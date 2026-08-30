# Knowledge Base Plugin (`knowbase`)

Cross-agent plugin and MCP server for semantic search over personal notes (Obsidian), documents, code repositories, and articles indexed in Cloudflare Vectorize.

## Supported Agents

- **Claude Code**: Install as a Plugin (`claude plugin install`), automatically activating the configurable local MCP adapter.
- **OpenAI Codex**: Install as a Plugin (`codex plugin add`) with the configurable local MCP adapter, or connect directly to a deployment's remote OAuth MCP endpoint.
- **Oh My Pi (OMP)**: Install as a Plugin (`omp plugin install`), automatically loading the native extension and MCP server.
- **Pi**: Install as an Extension (`pi install`), registering the `search_knowledge_base` native tool into Pi.
- **Claude Desktop & Cursor**: Direct stdio MCP server (`plugins/knowbase/mcp.mjs`).
- **ChatGPT (Web)**: Remote MCP connection with OAuth 2.1; package wiring uses the registered ChatGPT connection ID.
- **ChatGPT Custom GPT (legacy)**: OAuth Action with the OpenAPI schema remains supported.

---

## 1. Install as Plugin in Claude Code

Add the marketplace and install the plugin:
```bash
claude plugin marketplace add tenfyzhong/agent-plugins-hub
claude plugin install knowbase@tenfyzhong-agent-plugins-hub
```

Configure the deployment URL and an OAuth-issued access token before starting Claude Code:

```fish
set -gx KNOWBASE_API_URL "https://your-knowbase.example.com"
set -gx KNOWBASE_ACCESS_TOKEN "your-oauth-access-token"
```

The plugin starts its bundled MCP adapter and exposes the `search_knowledge_base` tool. It does not contain a default deployment URL and does not accept the deployment `API_TOKEN` as a search credential. Ask Claude to search the knowledge base when needed; a separate skill is not required.

---

## 2. Install as Plugin in OpenAI Codex

Add the marketplace and install the plugin:
```bash
codex plugin marketplace add tenfyzhong/agent-plugins-hub
codex plugin add knowbase@tenfyzhong-agent-plugins-hub
```

For OAuth login with automatic access-token refresh, connect Codex directly to the deployment:

```fish
set -gx KNOWBASE_API_URL "https://your-knowbase.example.com"
codex mcp add knowbase-remote --url "$KNOWBASE_API_URL/mcp"
codex mcp login knowbase-remote
```

Codex opens the deployment authorization page, completes the OAuth authorization-code flow, and stores only the issued OAuth access and refresh tokens. The deployment `API_TOKEN` is never accepted directly by the search or MCP endpoints.

To use the bundled stdio adapter with an access token issued by an OAuth client, set:

```fish
set -gx KNOWBASE_API_URL "https://your-knowbase.example.com"
set -gx KNOWBASE_ACCESS_TOKEN "your-oauth-access-token"
```

Alternatively, create `~/.config/knowbase/config.json` with the OAuth access token:

```json
{
  "apiUrl": "https://your-knowbase.example.com",
  "accessToken": "your-oauth-access-token"
}
```

The plugin contains no default deployment URL. Restart Codex after changing the environment or configuration file. Because access tokens are short-lived, direct remote OAuth is preferred when the client supports it.

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

## 6. ChatGPT Web Plugin Setup

The backend must be deployed before registering the connection.

1. In ChatGPT Web, open **Settings > Security and login** and enable **Developer mode**.
2. Open **ChatGPT Plugins**, select the plus button, and add your deployment's MCP URL:
   ```text
   https://your-knowbase.example.com/mcp
   ```
3. Confirm that ChatGPT discovers the `search_knowledge_base` tool.
4. Copy the registered connection ID from the browser URL. It starts with `plugin_asdk_app`.
5. Add an `.app.json` mapping for that ID and point the Codex manifest `apps` field at `./.app.json` before packaging or submitting the Web plugin.
6. Install the packaged plugin, select **Connect**, and enter the deployment `API_TOKEN` on the Knowbase authorization page.

The connection URL is publisher-controlled. The deployment `API_TOKEN` is accepted only by the authorization page to approve the OAuth grant; it is never accepted by the search or MCP endpoints, stored in the plugin, or returned as the OAuth access token.

## 7. Legacy Custom GPT / Mobile Setup

To use in ChatGPT Web or the iOS/Android ChatGPT app:
1. Go to **ChatGPT > Explore GPTs > Create**.
2. Go to **Configure > Actions > Create new action**.
3. In **Schema**, import from your deployment URL or paste its schema:
   `https://your-knowbase.example.com/openapi.json`
4. Under **Authentication**, select **OAuth**:
   - **Client ID**: `chatgpt`
   - **Client Secret**: any string (e.g. `secret`)
   - **Authorization URL**: `https://your-knowbase.example.com/oauth/authorize`
   - **Token URL**: `https://your-knowbase.example.com/oauth/token`
   - **Scope**: `read`
   - **Token Exchange Method**: `Default (POST request)`
5. Save and click **Connect**. A mobile-responsive web page will open where you enter your `API_TOKEN` to authorize.
