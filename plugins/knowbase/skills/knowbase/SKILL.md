---
name: knowbase
description: Search personal knowledge base (Obsidian notes, documentation, git repositories, and web articles) using semantic vector search.
---

# Knowledge Base Search

Search and retrieve personal knowledge base content, notes, documentation, and technical articles stored in Cloudflare Vectorize.

## When to use

- User asks about personal notes, Obsidian vault content, private projects, or past ideas.
- Looking up specific technical configurations, design docs, or cheat sheets stored in the knowledge base.
- Semantic search across indexed blog posts, repositories, and documentation.

## How to use

### Option 1: Using `knowbase` CLI (Recommended)

When `knowbase` is installed locally, execute:

```bash
knowbase search "<query>"
```

Options:
- `-k, --top-k <number>`: Limit number of results (e.g. `--top-k 10`, default 5).
- `-s, --source <source>`: Filter by source (e.g. `--source notes`, `--source blog`).
- `-j, --json`: Output raw structured JSON.

### Option 2: Using MCP Tool

If the `search_knowledge_base` MCP tool is available in your session:
- Call `search_knowledge_base(query="...", topK=5, source="...")`.
- If the tool requests authentication, complete the OAuth connection. Enter the deployment `API_TOKEN` only on the Knowbase authorization page; do not place it in chat or plugin configuration.

### Option 3: Direct API Request

If calling the Cloudflare Worker API directly:

```bash
curl -X POST "https://knowbase-api.tenfy.cn/search" \
  -H "Authorization: Bearer $KNOWBASE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "<query>", "topK": 5}'
```

## Best practices

- Frame search queries as clear semantic questions or natural concepts rather than just keyword tags.
- When results return multiple snippets, synthesize the most relevant context and cite the document path or title.
