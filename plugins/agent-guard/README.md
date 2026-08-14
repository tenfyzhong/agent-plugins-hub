# Agent Guard

Agent Guard supports Codex, Claude Code, pi, and oh-my-pi. It denies known
destructive shell commands before an agent runs them. Completion notifications
live in the separate [`agent-notifier`](../agent-notifier/README.md) plugin,
which posts to a webhook or Telegram.

## Host integration

- Codex and Claude Code discover `hooks/hooks.json` from the installed plugin.
- pi loads `extensions/agent-guard.ts` through the root package or this
  plugin's `package.json`.
- oh-my-pi marketplace, npm, and linked installs load
  `extensions/agent-guard-omp.ts` through `omp.extensions`.

Restart the host after installing or upgrading the plugin so lifecycle hooks
are reloaded.

## Blocked commands

The guard rejects statically identifiable instances of:

- forced recursive deletion (`rm` with both recursive and force flags);
- password-store access through `pass`;
- `git reset --hard` and non-dry-run forced `git clean`;
- `dd` writes to `/dev/*` and filesystem-formatting commands;
- host shutdown, reboot, halt, and poweroff commands.

It also recognizes common `sudo`, `env`, `command`, and nested shell wrappers.
This is a defense-in-depth policy, not a complete shell sandbox; keep each
host's sandbox and permission controls enabled.

## Test

```bash
node --test plugins/agent-guard/tests/*.test.mjs
```
