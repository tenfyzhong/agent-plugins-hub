# Agent Notifier

Agent Notifier supports Codex, Claude Code, pi, and oh-my-pi. It posts a
completion notification after an interactive agent run finishes and no queued
continuation remains. The notification includes the remaining 5-hour and
weekly quota when available.

Two channels are supported:

- a generic webhook, which receives the notification as a JSON POST body;
- Telegram, using the Bot API.

When `AGENT_NOTIFIER_WEBHOOK_URL` is configured, the webhook is used and
Telegram is ignored. Otherwise Telegram is used when its credentials are
configured. If neither is configured, delivery is silently skipped.

## Webhook configuration

Set the webhook endpoint in the environment inherited by the agent process:

```bash
export AGENT_NOTIFIER_WEBHOOK_URL="https://example.com/hooks/agent-finished"
```

Or store it in [password-store](https://www.passwordstore.org/) so no secret
sits in shell history or dotfiles:

```bash
pass insert agent-notifier/webhook-url
```

You may choose a different entry with `AGENT_NOTIFIER_WEBHOOK_PASS_ENTRY`. The
worker POSTs the notification as JSON with `content-type: application/json`:

```json
{
  "host": "Codex",
  "event": "Stop",
  "timestamp": "2026-08-14T00:00:00.000Z",
  "model": "gpt-5.2-codex",
  "sessionId": "session-1",
  "cwd": "/tmp/project",
  "transcriptPath": "/tmp/project/.codex/sessions/session-1.jsonl",
  "lastMessage": "done",
  "rateLimits": {
    "fiveHour": { "usedPercent": 25, "resetsAt": 3000 },
    "weekly": { "usedPercent": 40, "resetsAt": 4000 }
  }
}
```

Optional fields (`model`, `sessionId`, `cwd`, `transcriptPath`, `lastMessage`,
`rateLimits`) are omitted when unavailable. `rateLimits` uses percentages of
the window already used; `resetsAt` is a Unix timestamp.

## Telegram configuration

No credentials are stored in the plugin. The recommended setup uses
[password-store](https://www.passwordstore.org/):

```bash
pass insert agent-notifier/telegram-bot-token
pass insert agent-notifier/telegram-chat-id
```

You may choose different entries by setting `TELEGRAM_BOT_TOKEN_PASS_ENTRY` and
`TELEGRAM_CHAT_ID_PASS_ENTRY`. Alternatively, set `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_CHAT_ID` in the environment inherited by the agent process.

If credentials are unavailable, delivery is silently skipped. Set
`AGENT_NOTIFIER_DEBUG=1` to surface worker launch errors where the host exposes
hook stderr or UI notifications. Background delivery failures are not reported
to the foreground.

Completion notifications run in a detached background worker, so credential
lookup and delivery do not delay the agent's foreground process. Delivery is
best-effort: a worker interrupted by immediate host shutdown may not finish
sending its notification.

Non-interactive runs, including `codex exec`, Claude Code print/SDK sessions,
and pi or oh-my-pi print, JSON, and RPC modes, do not send notifications.

Notification workers enable Node.js environment-proxy support on every host,
so delivery honors inherited `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and
lowercase equivalents.

## Rate-limit quota

Codex notifications include the remaining 5-hour and weekly quota
automatically. The detached notification worker reads the latest rate-limit
snapshot from the current Codex transcript. No additional network request or
credential access is required.

Claude Code exposes subscription rate limits to
[status-line commands](https://code.claude.com/docs/en/statusline) rather than
Stop hooks. To include them in notifications, find the installed plugin path:

```bash
claude plugin list --json | jq -r '.[] | select(.id | startswith("agent-notifier@")) | .installPath'
```

Then configure the absolute path in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/absolute/path/to/agent-notifier/hooks/claude-statusline.mjs\""
  }
}
```

The adapter displays the remaining quota in the status line and caches the
latest snapshot by session for the worker. Claude Code provides these fields
only for Claude.ai Pro and Max subscriptions after the first API response.

To preserve an existing status-line command, have the adapter proxy it after
updating the cache:

```json
{
  "statusLine": {
    "type": "command",
    "command": "AGENT_NOTIFIER_STATUSLINE_COMMAND='~/.claude/statusline.sh' node \"/absolute/path/to/agent-notifier/hooks/claude-statusline.mjs\""
  }
}
```

The cache contains quota percentages and reset timestamps only. It is stored
under `$XDG_CACHE_HOME/agent-notifier/claude-rate-limits/`, or
`~/.cache/agent-notifier/claude-rate-limits/` when `XDG_CACHE_HOME` is unset.

## Host integration

- Codex and Claude Code discover `hooks/hooks.json` from the installed plugin.
- pi loads `extensions/agent-notifier.ts` through the root package or this
  plugin's `package.json`.
- oh-my-pi marketplace, npm, and linked installs load
  `extensions/agent-notifier-omp.ts` through `omp.extensions`.

pi sends completion notifications from `agent_settled`. oh-my-pi uses its
main-session `session_stop` event, which fires only after automatic
continuations have finished.

Restart the host after installing or upgrading the plugin so lifecycle hooks
are reloaded.

## Test

```bash
node --test plugins/agent-notifier/tests/*.test.mjs
```
