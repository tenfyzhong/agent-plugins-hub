# Agent Plugins Hub

A cross-agent marketplace for plugins maintained in this repository. It
supports OpenAI Codex, Claude Code, Pi, and Oh My Pi while keeping each agent's
native package metadata alongside shared Agent Skills.

## Repository layout

```text
.
├── .agents/plugins/marketplace.json    # Codex marketplace catalog
├── .claude-plugin/marketplace.json     # Claude Code marketplace catalog
├── .github/workflows/                  # Marketplace automation
├── plugins/
│   ├── agent-guard/                      # Cross-agent destructive-command guard
│   ├── agent-notifier/                   # Webhook and Telegram completion notifier
│   ├── agent-usage-exporter/              # Best-effort OTLP usage metrics
│   ├── engineering-delivery/             # Delivery skill and editable agent templates
│   └── lark-cli-skills/
│       ├── .claude-plugin/plugin.json  # Claude Code plugin manifest
│       ├── .codex-plugin/plugin.json   # Codex plugin manifest
│       ├── skills/lark/                # Registered lazy router skill
│       ├── internal-skills/            # Unregistered upstream skills
│       ├── LICENSE
│       └── .upstream-revision
├── package.json                        # Pi package manifest
├── scripts/                            # Marketplace maintenance scripts
└── tests/                              # Marketplace and sync validation
```

Marketplace entries use `./plugins/<plugin-name>` paths. Codex resolves these
paths from the marketplace repository root, not from the nested
`.agents/plugins/` directory.

## Install with Codex

Add the GitHub repository as a marketplace:

```bash
codex plugin marketplace add tenfyzhong/agent-plugins-hub --ref main
```

For local development, run this from the repository root instead:

```bash
codex plugin marketplace add .
```

Then install plugins through the Codex plugin browser or by name:

```bash
codex plugin add lark-cli-skills@tenfyzhong-agent-plugins-hub
codex plugin add agent-guard@tenfyzhong-agent-plugins-hub
codex plugin add agent-notifier@tenfyzhong-agent-plugins-hub
codex plugin add engineering-delivery@tenfyzhong-agent-plugins-hub
codex plugin add agent-usage-exporter@tenfyzhong-agent-plugins-hub
```

## Install with Claude Code

Add the GitHub repository as a Claude Code marketplace:

```bash
claude plugin marketplace add tenfyzhong/agent-plugins-hub
```

For local development, run this from the repository root instead:

```bash
claude plugin marketplace add .
```

Then install the plugin:

```bash
claude plugin install lark-cli-skills@tenfyzhong-agent-plugins-hub
claude plugin install agent-guard@tenfyzhong-agent-plugins-hub
claude plugin install agent-notifier@tenfyzhong-agent-plugins-hub
claude plugin install engineering-delivery@tenfyzhong-agent-plugins-hub
claude plugin install agent-usage-exporter@tenfyzhong-agent-plugins-hub
```

Claude Code namespaces plugin skills. Invoke the router explicitly with
`/lark-cli-skills:lark`, or let Claude select it from the request context.

## Install with Pi

Install the package directly from GitHub:

```bash
pi install git:github.com/tenfyzhong/agent-plugins-hub
```

For local development, run this from the repository root instead:

```bash
pi install .
```

Invoke the router explicitly with `/skill:lark`, or let Pi select it from the
request context.

## Install with Oh My Pi

Add this repository as an OMP marketplace and install Agent Guard as a plugin:

```bash
omp plugin marketplace add tenfyzhong/agent-plugins-hub
omp plugin install agent-guard@tenfyzhong-agent-plugins-hub
omp plugin install agent-notifier@tenfyzhong-agent-plugins-hub
omp plugin install engineering-delivery@tenfyzhong-agent-plugins-hub
omp plugin install agent-usage-exporter@tenfyzhong-agent-plugins-hub
```

## Engineering Delivery

The `engineering-delivery` plugin provides a shared skill for staged software delivery plus native
agent definitions for Codex, Claude Code, Pi, and Oh My Pi. One structured source defines every
role, and thin host templates generate the native files at install time. Plugin installation
exposes the skill; run the bundled installer from a clone of this repository to place editable
agent definitions in the four user configuration directories:

```bash
./plugins/engineering-delivery/scripts/install-agents.sh
```

Or install them directly with curl:

```bash
curl -fsSL https://raw.githubusercontent.com/tenfyzhong/agent-plugins-hub/main/plugins/engineering-delivery/scripts/install-agents.sh | bash
```

See [`plugins/engineering-delivery/README.md`](plugins/engineering-delivery/README.md) for
per-host installation, customization, and safe uninstallation details.

## Agent Guard

The `agent-guard` plugin blocks known destructive shell commands before they
run. It uses native hooks for Codex, Claude Code, and Oh My Pi, plus a Pi
extension. See
[`plugins/agent-guard/README.md`](plugins/agent-guard/README.md)
for its blocked-command policy.

## Agent Notifier

The `agent-notifier` plugin posts a completion notification after an
interactive agent run finishes, to either a user-configured webhook or a
Telegram chat. It uses native hooks for Codex, Claude Code, and Oh My Pi, plus
a Pi extension. See
[`plugins/agent-notifier/README.md`](plugins/agent-notifier/README.md)
for webhook and Telegram configuration.

## Agent Usage Exporter

`agent-usage-exporter` sends best-effort OTLP/HTTP metrics when an agent session
finishes. The launcher detaches immediately and always exits successfully, so an
unavailable telemetry endpoint cannot delay or fail a session. All four hosts
incrementally parse their own JSONL session records: Codex token-count events,
Claude Code assistant records with explicit model and usage, and Pi/Oh My Pi
model-change plus assistant usage records. No transcript content is exported.

By default it posts to `http://127.0.0.1:4318/v1/metrics` and writes private
incremental state to `${XDG_STATE_HOME:-~/.local/state}/agent-usage-exporter`.
Set `AGENT_USAGE_OTLP_ENDPOINT` and `AGENT_USAGE_STATE_DIR` to override those
locations. `AGENT_USAGE_PRICING_FILE` may point at a JSON object whose model
entries specify USD-per-million `input`, `cached_input`, `cache_write`, and
`output` rates; it overrides the bundled pricing. `_aliases` maps an exact raw
model ID to a priced model without changing the emitted model label. Unknown
models still export tokens but have no cost series. The bundled DeepSeek rates
are a 2026-08-14 snapshot; see the plugin README for the announced 2026-08-16
price change and official source.

Use the checked-in [Alloy configuration](plugins/agent-usage-exporter/alloy/agent-usage-exporter.alloy)
and replace its remote-write endpoint. It explicitly disables Alloy suffixes, so
the Prometheus metric names below stay exactly as shown:

The cumulative metric names are `agent_usage_tokens` (labels: `agent`, `model`,
`token_type`) and `agent_usage_cost_usd` (labels: `agent`, `model`). `input`
includes cached and cache-write input, so query one token type at a time or use
the separate `cached_input` and `cache_write` series rather than summing every
token type. Remove any prior personal usage exporter hook before enabling this
plugin to avoid duplicate series. See the plugin
[README](plugins/agent-usage-exporter/README.md) for configuration details.

## Lark CLI Skills

The `lark-cli-skills` plugin mirrors every skill under
[`larksuite/cli/skills`](https://github.com/larksuite/cli/tree/main/skills).
The manifest registers only the lightweight `lark` router under `skills/`;
the upstream skills are stored under `internal-skills/` and remain unregistered.
After a Lark or Feishu prompt selects the router, it reads the internal skill
metadata, selects the relevant workflow, and loads only that workflow's full
instructions. Each snapshot records its source commit in
`plugins/lark-cli-skills/.upstream-revision`.

The skills call the official `lark-cli`. Install and authenticate it before
using Lark operations:

```bash
npx @larksuite/cli@latest install
lark-cli config init
lark-cli auth login --recommend
```

### Upstream synchronization

The `Sync Lark CLI skills` GitHub Actions workflow checks the upstream `main`
branch every six hours and can also be run manually. When the upstream skills
change, it mirrors additions, updates, and removals, runs the tests, and pushes
a signed-off synchronization commit to this repository's default branch.

Run the same process locally with:

```bash
./scripts/sync_lark_cli_skills.sh
python3 -m unittest discover -s tests
```

The mirrored skills and plugin-level `LICENSE` are distributed under the
upstream project's MIT license. The surrounding repository uses its own MIT
license.
