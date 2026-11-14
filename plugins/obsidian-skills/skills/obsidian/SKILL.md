---
name: obsidian
description: "Obsidian vault workflows for notes, structured files, web clipping, templates, desktop automation, and Headless Sync or Publish."
---

# Obsidian Router

Expose one lightweight entry point while keeping the bundled Obsidian skills
out of the agent's initial skill metadata list. Use this entry point for
Obsidian requests or when the current directory is an Obsidian vault or
repository.

## Route the request

1. Run `python3 scripts/discover_internal_skills.py` relative to this router's
   directory, regardless of the current working directory. The script reads only the
   frontmatter of the unregistered skills and returns their names,
   descriptions, and absolute `SKILL.md` paths as JSON.
2. Match the user's complete intent against that catalog. Choose the smallest
   set of internal skills that covers the request. The discovered catalog is
   authoritative for available workflows; the routing hints below are not an
   exhaustive list. Newly synchronized skills are eligible when their
   descriptions match the request, even if they have no routing hint below.
   If a requested skill is absent from the catalog, report that the installed
   snapshot does not contain it; do not invent its path or silently substitute
   a different workflow.
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
- Use `obsidian-headless` for Obsidian Sync and Obsidian Publish through
  Obsidian Headless (`ob`), including server, CI, and terminal-only workflows,
  and Sync or Publish settings. It does not require the desktop app.
- Use `obsidian-cli` for controlling a running Obsidian desktop app through
  its CLI, including vault operations and plugin or theme development.
  A terminal request alone does not distinguish it from `obsidian-headless`;
  select by the requested operation and whether the desktop app is involved.
- For direct note edits without the desktop app, use `obsidian-markdown` (or
  `obsidian-bases` / `json-canvas` for those file formats). Add
  `obsidian-headless` only when the request also includes Sync or Publish;
  Headless itself does not read or edit notes.
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
