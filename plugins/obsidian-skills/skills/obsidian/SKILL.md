---
name: obsidian
description: "Route Obsidian vault operations to bundled workflows on demand. Use for Obsidian notes, vaults, Obsidian Flavored Markdown, Bases, JSON Canvas files, Obsidian CLI, Knap template rendering and batch note generation, or when the current directory is an Obsidian vault or repository."
---

# Obsidian Router

Expose one lightweight entry point while keeping the bundled Obsidian skills
out of the agent's initial skill metadata list.

## Route the request

1. Run `scripts/discover_internal_skills.py`. The script reads only the
   frontmatter of the unregistered skills and returns their names,
   descriptions, and absolute `SKILL.md` paths as JSON.
2. Match the user's complete intent against that catalog. Choose the smallest
   set of internal skills that covers the request. The discovered catalog is
   authoritative for available workflows; the routing hints below are not an
   exhaustive list. Newly synchronized skills are eligible when their
   descriptions match the request.
3. Read every selected `SKILL.md` completely before acting. Resolve its linked
   files relative to that internal skill's directory and follow its routing,
   tool, and safety instructions.
4. Execute the selected workflow. If the vault or target file is ambiguous,
   ask for the missing choice before performing writes.

## Routing rules

- Do not read every internal `SKILL.md`; load only selected skills after the
  metadata catalog is available.
- Use `obsidian-markdown` for notes, properties, wikilinks, embeds, callouts,
  tags, and other Obsidian Flavored Markdown.
- Use `obsidian-bases` for `.base` files, views, filters, formulas, and
  summaries.
- Use `json-canvas` for `.canvas` files, nodes, edges, groups, and connections.
- Use `obsidian-cli` for vault operations through the Obsidian CLI and for
  plugin or theme development.
- Use `defuddle` only when clean Markdown extraction from a web page is part of
  the request.
- Use `knap` for rendering Markdown from templates and structured data,
  including JSON or CSV batch note generation. Select both `defuddle` and
  `knap` when the request includes extracting a web page and formatting it
  with a template; use `knap` alone when the extracted data is already available.
- When creating a new document, find the top-level directory whose name
  contains `inbox` (case-insensitive, such as `0-inbox` or `00-Inbox`) and
  place it in that directory's `agent/` subdirectory, unless the user
  explicitly specifies a different location.
