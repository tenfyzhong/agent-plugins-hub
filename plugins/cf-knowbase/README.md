# Cloudflare Knowledge Base Plugin (`cf-knowbase`)

Cross-agent plugin and skill for semantic search over personal notes (Obsidian), documents, code repositories, and articles indexed in Cloudflare Vectorize.

## Supported Agents

- **OpenAI Codex**: Plugin manifest with OAuth connection authorization and skills.
- **Claude Code**: Namespaced skill (`/cf-knowbase:cf-knowbase`).
- **Oh My Pi (OMP)**: Native OMP extension and marketplace plugin.
- **Pi**: Native Pi tool extension (`search_knowledge_base`) and skill.
- **ChatGPT (Web & Mobile)**: Custom GPT / Action with OAuth 2.0 authorization and OpenAPI schema.

---

## 1. Install with Codex

Add marketplace and install:
```bash
codex plugin marketplace add tenfyzhong/agent-plugins-hub
codex plugin add cf-knowbase@tenfyzhong-agent-plugins-hub
```

### Authorization & Connection in Codex / ChatGPT

When prompted to connect your knowledge base, you can authorize via OAuth:
1. Codex / ChatGPT will open the authorization page: `https://<YOUR_WORKER_URL>/oauth/authorize`.
2. Enter your `API_TOKEN` and click **Authorize & Connect**.
3. Codex / ChatGPT receives the access token securely and enables the `searchKnowledgeBase` action.

---

## 2. Install with Claude Code

Add marketplace and install:
```bash
claude plugin marketplace add tenfyzhong/agent-plugins-hub
claude plugin install cf-knowbase@tenfyzhong-agent-plugins-hub
```

Invoke explicitly with `/cf-knowbase:cf-knowbase` or ask Claude to search your personal notes.

---

## 3. Install with Oh My Pi

```bash
omp plugin marketplace add tenfyzhong/agent-plugins-hub
omp plugin install cf-knowbase@tenfyzhong-agent-plugins-hub
```

---

## 4. Install with Pi

```bash
pi install git:github.com/tenfyzhong/agent-plugins-hub
```

---

## 5. Web ChatGPT / Mobile ChatGPT Custom GPT Setup

To use in ChatGPT Web or the iOS/Android ChatGPT app:
1. Go to **ChatGPT > Explore GPTs > Create**.
2. Go to **Configure > Actions > Create new action**.
3. In **Schema**, import from URL or paste:
   `https://<YOUR_WORKER_URL>/openapi.json`
4. Under **Authentication**, select **OAuth**:
   - **Client ID**: `chatgpt`
   - **Client Secret**: any string (e.g. `secret`)
   - **Authorization URL**: `https://<YOUR_WORKER_URL>/oauth/authorize`
   - **Token URL**: `https://<YOUR_WORKER_URL>/oauth/token`
   - **Scope**: `read`
   - **Token Exchange Method**: `Default (POST request)`
5. Save and click **Connect**. A mobile-responsive web page will open where you enter your `API_TOKEN` to authorize.
