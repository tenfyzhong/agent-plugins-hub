# Agent Guard

Agent Guard supports Codex, Claude Code, pi, and oh-my-pi. It provides two protections:

- denies known destructive shell commands before an agent runs them;
- sends a Telegram message after an agent run finishes and no queued continuation remains.

## Telegram credentials

No credentials are stored in the plugin. The recommended setup uses
[password-store](https://www.passwordstore.org/):

```bash
pass insert agent-guard/telegram-bot-token
pass insert agent-guard/telegram-chat-id
```

You may choose different entries by setting `TELEGRAM_BOT_TOKEN_PASS_ENTRY` and
`TELEGRAM_CHAT_ID_PASS_ENTRY`. Alternatively, set `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` in the environment inherited by the agent process.

If credentials are unavailable, command blocking remains active and notification delivery is
silently skipped. Set `AGENT_GUARD_DEBUG=1` to surface worker launch errors where the host exposes
hook stderr or UI notifications. Background delivery failures are not reported to the foreground.

Completion notifications run in a detached background worker, so credential lookup and Telegram
delivery do not delay the agent's foreground process. Delivery is best-effort: a worker interrupted
by immediate host shutdown may not finish sending its notification.

Notification workers enable Node.js environment-proxy support on every host, so Telegram delivery
honors inherited `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and lowercase equivalents.

## Host integration

- Codex and Claude Code discover `hooks/hooks.json` from the installed plugin.
- pi loads `extensions/agent-guard.ts` through the root package or this plugin's `package.json`.
- oh-my-pi loads the same extension from its plugin marketplace or package integration.

pi sends completion notifications from `agent_settled`. oh-my-pi uses its main-session
`session_stop` event, which fires only after automatic continuations have finished.

Restart the host after installing or upgrading the plugin so lifecycle hooks are reloaded.

## Blocked commands

The guard rejects statically identifiable instances of:

- forced recursive deletion (`rm` with both recursive and force flags);
- password-store access through `pass`;
- `git reset --hard` and non-dry-run forced `git clean`;
- `dd` writes to `/dev/*` and filesystem-formatting commands;
- host shutdown, reboot, halt, and poweroff commands.

It also recognizes common `sudo`, `env`, `command`, and nested shell wrappers. This is a
defense-in-depth policy, not a complete shell sandbox; keep each host's sandbox and permission
controls enabled.

## Test

```bash
node --test plugins/agent-guard/tests/*.test.mjs
```
