---
description: Search personal knowledge base (Obsidian notes, documentation, git repositories, and web articles) using semantic vector search.
---

# Cloudflare Knowledge Base Search

Search and retrieve personal knowledge base content, notes, documentation, and technical articles stored in Cloudflare Vectorize.

## When to use

- User asks about personal notes, Obsidian vault content, private projects, or past ideas.
- Looking up specific technical configurations, design docs, or cheat sheets stored in the knowledge base.
- Semantic search across indexed blog posts, repositories, and documentation.

## How to use

### Option 1: Using `kb-cli` (Recommended)

When `kb-cli` is installed locally, execute:

```bash
kb-cli search "<query>"
```

Options:
- `-k, --top-k <number>`: Limit number of results (e.g. `--top-k 10`, default 5).
- `-s, --source <source>`: Filter by source (e.g. `--source obsidian-notes`, `--source blog`).
- `-j, --json`: Output raw structured JSON.

### Option 2: Using MCP Tool

If the `search_knowledge_base` MCP tool is available in your session:
- Call `search_knowledge_base(query="...", topK=5, source="...")`.

### Option 3: Direct API Request

If calling the Cloudflare Worker API directly:

```bash
curl -X POST "$CF_KB_API_URL/search" \
  -H "Authorization: Bearer $CF_KB_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "<query>", "topK": 5}'
```

## Best practices

- Frame search queries as clear semantic questions or natural concepts rather than just keyword tags.
- When results return multiple snippets, synthesize the most relevant context and cite the document path or title.
