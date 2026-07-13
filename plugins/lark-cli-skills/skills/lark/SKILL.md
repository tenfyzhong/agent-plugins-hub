---
name: lark
description: "Route Lark and Feishu (飞书) operations to bundled lark-cli workflows on demand. Use for Lark or 飞书 messages, documents, Drive, calendar, meetings, tasks, mail, Base, Sheets, approvals, attendance, OKRs, whiteboards, authentication, events, apps, or OpenAPI work."
---

# Lark and Feishu Router

Expose one lightweight entry point while keeping the bundled service skills out
of the agent's initial skill metadata list.

## Route the request

1. Run `scripts/discover_internal_skills.py`. The script reads only the
   frontmatter of the unregistered skills and returns their names,
   descriptions, and absolute `SKILL.md` paths as JSON.
2. Match the user's complete intent against that catalog. Choose the smallest
   set of internal skills that covers the request.
3. Read every selected `SKILL.md` completely before acting. Resolve its linked
   files relative to that internal skill's directory and follow its routing,
   authentication, permission, and safety instructions.
4. Execute the selected workflow. For cross-service work, finish discovery and
   identity resolution before performing writes.

## Routing rules

- Do not read every internal `SKILL.md`; load only selected skills after the
  metadata catalog is available.
- Prefer a specialized internal skill over `lark-openapi-explorer`.
- Use `lark-openapi-explorer` only when no specialized skill covers the
  requested Lark API operation.
- Use `lark-shared` for setup, authentication, identity, domain permission, or
  missing-scope issues, and whenever another internal skill requires it.
- If the request is ambiguous between materially different or destructive
  actions, ask for the missing choice before executing the action.
