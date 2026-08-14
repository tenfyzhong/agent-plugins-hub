# Agent Usage Exporter Design

## Problem and decisions

Migrate the personal Codex usage exporter into a distributable plugin that writes
usage metrics to a user-operated Grafana Alloy instance. The plugin must be
installable for Codex, Claude Code, Pi, and Oh My Pi.

The accepted design provides one shared exporter command. Codex is the only
native transcript parser: it incrementally reads Codex JSONL transcript records.
Claude Code, Pi, and Oh My Pi adapters pass normalized usage only when their
lifecycle data exposes it; otherwise they succeed without exporting. The plugin
does not claim to parse those agents' private transcript formats.

Hooks run at lifecycle completion: Codex `Stop`, Claude Code `SessionEnd`, and
Pi/Oh My Pi `session_shutdown`. Each foreground hook starts a detached,
unreferenced Node worker and immediately returns success. Telemetry failures
cannot block or fail an agent session.

Metrics are cumulative OTLP sums named `agent_usage_tokens` and
`agent_usage_cost_usd`. Token points have `agent`, `model`, `token_type`, and
`project` attributes; cost points have `agent`, `model`, `token_type`, and
`project`, aggregated per model and token class. Canonical agent values are
`codex`, `claude-code`, `pi`, and `oh-my-pi`. `project` is the basename of the
enclosing git root, or of the agent's working directory outside a repository,
enabling per-project spend queries.

Configuration is environment-driven. The endpoint defaults to
`http://127.0.0.1:4318/v1/metrics`; state defaults below
`XDG_STATE_HOME/agent-usage-exporter` or `~/.local/state/agent-usage-exporter`.
Pricing comes from JSON, with `AGENT_USAGE_PRICING_FILE` overriding the bundled
default. Unknown models still emit tokens and omit cost.

## Architecture

```text
host lifecycle hook / extension
        | (stdin JSON, agent identity)
        v
nonblocking launcher -- detached worker
        |                         |
        |                         +-- Codex JSONL parser or normalized usage
        |                                  |
        |                                  v
        |                           private incremental state
        |                                  |
        +------------------------------> OTLP/HTTP metrics
                                             |
                                             v
                                      Grafana Alloy OTLP receiver
                                             |
                                             v
                                Prometheus exporter -> remote_write
```

The state stores cursors and cumulative totals keyed by agent plus transcript or
session identity. Writes use a private temporary file and atomic replacement.
Partial JSONL lines remain pending. A failed network post reports only to the
worker's ignored output and never affects the host; committed state is not
corrupted. The migration deliberately starts a new state/metric namespace, so
the README instructs users to remove the previous personal exporter hook.

## Implementation DAG

| Unit | Depends on | Files | Validation |
| --- | --- | --- | --- |
| U1: complete plugin | none | new plugin, root/package catalogs, root README, marketplace tests | Node unit tests, Python catalog tests, Alloy validation, plugin validation |

U1 is deliberately one write unit: exporter state and metric contracts are
consumed directly by all hooks, extensions, manifests, catalogs, tests, and
documentation. Parallel edits would create avoidable contract drift.

## Test strategy

Tests are written before production code. They cover Codex model changes,
malformed and partial JSONL, idempotent offsets, truncation, external pricing,
unknown models, metric labels, state writes, OTLP success/failure, and detached
best-effort adapters. Marketplace tests cover manifest parity and Pi/OMP
registration. The full Python test suite, plugin Node tests, Alloy formatting
and validation, plugin validation, and `git diff --check` are final gates.

## Rollout, rollback, and risks

Users install the plugin, configure Alloy and environment variables, then
enable/review the generated hook or extension. Roll back by disabling its hook
or extension; no remote configuration is changed. The old personal hook must
be disabled to prevent duplicate series.

The primary risks are concurrent lifecycle invocations, unavailable Alloy,
stale pricing, and host payload differences. Detached execution isolates the
agent from the first two; private atomic state and no-op non-Codex adapters
reduce the latter risks. The plugin intentionally does not send transcript
content or automatically deploy Alloy/Grafana.

## Native session parsing extension

The exporter now parses each supported agent's own session JSONL incrementally,
rather than relying on normalized usage from non-Codex hosts. Session paths from
the hook payload are authoritative. Pi and Oh My Pi extensions obtain the
current session file through `ctx.sessionManager.getSessionFile()` when an event
does not provide a path. Claude Code `SessionEnd` provides `transcript_path`;
the exporter does not scan the home directory for an arbitrary Claude session.

Codex continues to use `turn_context.payload.model` followed by
`event_msg`/`token_count`/`info.last_token_usage`. Claude Code accepts only
assistant records containing a string `message.model` and explicit usage fields.
Pi and Oh My Pi share a parser: `model_change` establishes model context, and
assistant `message` records map `usage.input`, `output`, `cacheRead`, and
`cacheWrite` to the existing normalized token types. Unsupported or ambiguous
records are ignored; token values are never inferred from text or cost.

Raw model IDs remain metric labels. Pricing is deliberately separate: a direct
model rate wins, otherwise `_aliases` in `pricing.json` maps an exact raw ID to
a priced model ID. An override supplied through `AGENT_USAGE_PRICING_FILE`
merges both rates and aliases. This provides provider-qualified aliases without
merging or rewriting observability labels.

The bundled pricing snapshot is dated 2026-08-14 and adds DeepSeek's official
`deepseek-v4-flash` and `deepseek-v4-pro` USD-per-million rates with peak and
off-peak tiers, converted from its CNY rates at 6.74 CNY/USD; all bundled
rates share one currency so cost series sum correctly. Each tiered model
carries its own `peak_hours` array of `{"start": 9, "end": 12}` range objects;
ranges are whole hours in the machine's local clock, half-open, and may wrap
midnight. Tiered models bill `peak` inside a range and `off_peak` otherwise;
sessions are billed at the tier active at export time. DeepSeek announced a
pricing change effective 2026-08-16; the plugin README records the source and
requires users to update or override the snapshot when rates change. No
cache-write rate is invented.

This extension is one tightly coupled unit: parser output, byte cursor state,
fixture tests, host extension session resolution, pricing aliases, and
documentation share one contract. TDD fixtures cover all four hosts, model
changes, partial/malformed lines, append/truncation, post-failure retry,
raw-label alias pricing, and the DeepSeek snapshot. Rollback remains disabling
the hook or extension; existing state is preserved and can be reused by a
corrected parser on the next lifecycle event.
