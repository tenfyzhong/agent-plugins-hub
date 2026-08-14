# Agent Usage Exporter

Agent Usage Exporter sends best-effort cumulative OTLP/HTTP token and estimated
cost metrics when a coding-agent session finishes. The lifecycle hook starts a
detached worker and exits successfully; an unavailable collector never blocks a
session.

Each supported host has a native incremental session adapter. Codex reads
`turn_context.payload.model` and `event_msg` `token_count`
`info.last_token_usage`; Claude Code accepts only assistant records with a
string `message.model` and explicit `message.usage`; Pi and Oh My Pi use
`model_change` plus assistant `message.usage` records. Pi records model changes
as `provider` plus `modelId` and assistant `message.model` takes precedence;
Oh My Pi records the combined model label. Claude Code assistant response IDs
retain the latest cumulative usage snapshot across incremental scans, so a
progressive response contributes its terminal output without double-counting.
The exporter ignores
unknown or ambiguous records and never exports transcript content.

The shared hook file registers only Codex `Stop` and Claude Code `SessionEnd`.
Its launcher also requires `PLUGIN_ROOT` (without `CLAUDE_PLUGIN_ROOT`) for
Codex and `CLAUDE_PLUGIN_ROOT` for Claude Code, so accidental cross-host hook
discovery is a successful no-op.

## Configure Alloy

Copy [`alloy/config.alloy`](alloy/config.alloy) into your Alloy configuration
and [`alloy/config.env.sample`](alloy/config.env.sample) into your environment.
It listens on the default OTLP/HTTP address, so the exporter default is
`http://127.0.0.1:4318/v1/metrics`, converts the metrics with
`add_metric_suffixes = false`, and remote-writes them to a
Prometheus-compatible endpoint.

For Grafana Cloud specifically, follow the step-by-step
[`grafana-cloud.md`](grafana-cloud.md) setup guide (endpoints, credentials,
verification, and troubleshooting).

The template reads its endpoint and credentials from environment variables:

- `AGENT_USAGE_PROMETHEUS_URL`: remote-write endpoint. For Grafana Cloud this is
  `https://prometheus-prod-<N>-prod-<region>.grafana.net/api/prom/push` — the
  same host as the stack's Prometheus data-source URL with the path
  `/api/prom/push`.
- `AGENT_USAGE_PROMETHEUS_USERNAME`: basic-auth user. For Grafana Cloud this is
  the stack's **Prometheus metrics instance ID**, which differs from the OTLP
  instance ID. Do not reuse `GRAFANA_CLOUD_INSTANCE_ID` here; find the exact
  value in the Grafana Cloud portal under the stack's "Send metrics"
  instructions.
- `AGENT_USAGE_PROMETHEUS_PASSWORD`: basic-auth password. For Grafana Cloud use
  an API key with role `MetricsPublisher`, or an access-policy token whose
  policy has scope `metrics:write` and a realm covering the stack.

The checked-in configuration sets `add_metric_suffixes = false`; therefore the
Prometheus metric names are exactly `agent_usage_tokens` and
`agent_usage_cost_usd`. Example queries are:

```promql
sum by (agent) (agent_usage_tokens{token_type="output"})
sum by (agent, model) (agent_usage_cost_usd)
```

`input` includes cache-read and cache-write tokens. Use the separate
`cached_input` and `cache_write` labels when analyzing token classes instead of
summing every `token_type`. This normalization is consistent across hosts even
where their native input field excludes cache tokens. Cost keeps that native
raw-input basis, then charges uncached input, cached input, cache-write input,
and output at the configured per-model rates.

Token and cost points also carry a `project` attribute naming the working
project: the basename of the enclosing git root when the session runs inside a
git repository, otherwise the basename of the agent's working directory. For a
session in `~/go/src/github.com/pingcap/ticdc`, `project` is `ticdc`. Query
per-project spend with:

```promql
sum by (project) (agent_usage_cost_usd)
```

## Configuration and state

Set `AGENT_USAGE_OTLP_ENDPOINT` to change the collector endpoint and
`AGENT_USAGE_STATE_DIR` to change private state storage. By default state is in
`${XDG_STATE_HOME:-~/.local/state}/agent-usage-exporter`. State serializes worker
updates, preserves cumulative stream start times, and stores accrued costs, so a
later pricing-file change never reprices past usage.

`AGENT_USAGE_PRICING_FILE` can override bundled per-million-token rates and add
exact raw-model aliases through `_aliases`. Metrics retain the raw model label
even when an alias supplies the price.

Pricing entries are flat rate objects (`{"input": 5, "cached_input": 0.5, ...}`)
or time-tiered objects with a per-model `peak_hours` array plus `off_peak` and
`peak` rate sub-objects. All rates are USD per million tokens. Each
`peak_hours` entry is a range object like `{"start": 9, "end": 12}` (from
09:00 inclusive to 12:00 exclusive, whole hours in the machine's local clock);
ranges may wrap midnight (`{"start": 22, "end": 2}`). A model with tiers bills
`peak` while the local hour is inside any of its ranges and `off_peak`
otherwise (missing or invalid `peak_hours` always bills `off_peak`); flat
entries ignore the clock. A session is priced at the tier active when it is
exported, so a session crossing a boundary is billed entirely at the closing
tier.

Bundled prices cover `gpt-5.6`, `gpt-5.6-sol`, `gpt-5.6-terra`,
`gpt-5.6-luna`, `deepseek-v4-flash`, and `deepseek-v4-pro`; cache writes use a
rate only when a provider publishes one. DeepSeek rates are USD per million
tokens, converted from its CNY rates at 6.74 CNY/USD on 2026-08-14, with peak
hours `09-12` and `14-18` Beijing local time:

| Model | Tier | Input | Cached input | Output |
| --- | --- | ---: | ---: | ---: |
| deepseek-v4-flash | off-peak | 0.2226 | 0.0074 | 0.6677 |
| deepseek-v4-flash | peak | 0.4451 | 0.0148 | 1.3353 |
| deepseek-v4-pro | off-peak | 0.6677 | 0.0223 | 2.003 |
| deepseek-v4-pro | peak | 1.3353 | 0.0445 | 4.0059 |

DeepSeek has announced a pricing change effective 2026-08-16; consult its
[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) page and
update or override this snapshot when prices change. Unknown models still
export tokens but no cost series. Remove an old personal usage-exporter hook
before enabling this plugin to avoid duplicate metrics.
