# Agent Plugins Hub

A cross-agent marketplace for plugins maintained in this repository. It
supports OpenAI Codex, Claude Code, Pi, Oh My Pi, and Antigravity CLI (`agy`)
while keeping each agent's native package metadata alongside shared Agent Skills.

## Repository layout

```text
.
├── .agents/plugins/marketplace.json    # Codex marketplace catalog
├── .claude-plugin/marketplace.json     # Claude Code marketplace catalog
├── .omp-plugin/marketplace.json        # OMP marketplace catalog
├── .github/workflows/                  # Marketplace automation
├── plugins/
│   ├── agent-guard/                      # Cross-agent destructive-command guard
│   ├── agent-notifier/                   # Webhook and Telegram completion notifier
│   ├── omp-conventions/                  # OMP-only system conventions naming workaround
│   ├── lark-cli-skills/
│       ├── .claude-plugin/plugin.json  # Claude Code plugin manifest
│       ├── .codex-plugin/plugin.json   # Codex plugin manifest
│       ├── skills/lark/                # Registered lazy router skill
│       ├── internal-skills/            # Unregistered upstream skills
│       ├── LICENSE
│       └── .upstream-revision
│   └── obsidian-skills/
│       ├── .claude-plugin/plugin.json  # Claude Code plugin manifest
│       ├── .codex-plugin/plugin.json   # Codex plugin manifest
│       ├── skills/obsidian/             # Registered lazy router skill
│       ├── internal-skills/             # Unregistered upstream skills
│       ├── LICENSE
│       └── .upstream-revision
├── package.json                        # Pi package manifest
├── scripts/                            # Marketplace maintenance scripts
└── tests/                              # Marketplace and sync validation
```

Marketplace entries use `./plugins/<plugin-name>` paths. Codex resolves these
paths from the marketplace repository root, not from the nested
`.agents/plugins/` directory.

## Continuous integration

GitHub Actions runs the repository validation suite for every pull request and
every push to `main`.

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
codex plugin add obsidian-skills@tenfyzhong-agent-plugins-hub
codex plugin add agent-guard@tenfyzhong-agent-plugins-hub
codex plugin add agent-notifier@tenfyzhong-agent-plugins-hub
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
claude plugin install obsidian-skills@tenfyzhong-agent-plugins-hub
claude plugin install agent-guard@tenfyzhong-agent-plugins-hub
claude plugin install agent-notifier@tenfyzhong-agent-plugins-hub
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
request context. Invoke the Obsidian router explicitly with `/skill:obsidian`,
or let Pi select it from the request context.

## Install with Oh My Pi

Add this repository as an OMP marketplace and install the required plugins:

```bash
omp plugin marketplace add tenfyzhong/agent-plugins-hub
omp plugin install agent-guard@tenfyzhong-agent-plugins-hub
omp plugin install agent-notifier@tenfyzhong-agent-plugins-hub
omp install omp-conventions@tenfyzhong-agent-plugins-hub
```

## Install with Antigravity CLI (agy)

Clone this repository, then install each desired plugin from its directory:

```bash
git clone https://github.com/tenfyzhong/agent-plugins-hub.git
cd agent-plugins-hub
agy plugin install ./plugins/lark-cli-skills
agy plugin install ./plugins/obsidian-skills
agy plugin install ./plugins/agent-guard
agy plugin install ./plugins/agent-notifier
agy plugin list --json
```

For local development, run the four install commands from your checkout.
After updating the checkout, reinstall the desired plugins and restart agy.
Invoke the skill routers with `/lark` or `/obsidian`. `omp-conventions` is
OMP-only and is not an agy plugin.

Each supported plugin has `.antigravity-plugin/plugin.json`. Antigravity
loads the shared `skills/` directory and its own root-level `hooks.json`;
mirrored `internal-skills/` remain unregistered. The guard and notifier use
separate agy adapters for its native hook payloads and responses.

Validate a plugin with `agy plugin validate ./plugins/<name>`. The two hook
plugins produce an expected warning that `hooks/hooks.json` is ignored by
agy: that file belongs to Codex/Claude, while agy loads `hooks.json` at the
plugin root. Consequently `--strict` fails on that coexistence warning;
the skill-only plugins pass strict validation. Repository tests reject any
other validation warning and, when agy is installed, verify installation and
component discovery in a temporary home directory.

See the official [plugin authoring guide](https://antigravity.google/docs/build-plugins/)
and [hook contract](https://antigravity.google/docs/hooks/).

## Agent Guard

The `agent-guard` plugin blocks known destructive shell commands before they
run. It uses native hooks for Codex, Claude Code, and Antigravity CLI, plus
Pi and OMP extensions. See
[`plugins/agent-guard/README.md`](plugins/agent-guard/README.md)
for its blocked-command policy.

## Agent Notifier

The `agent-notifier` plugin posts a completion notification after an
interactive agent run finishes, to either a user-configured webhook or a
Telegram chat. It uses native hooks for Codex, Claude Code, and Antigravity CLI,
plus Pi and OMP extensions. See
[`plugins/agent-notifier/README.md`](plugins/agent-notifier/README.md)
for webhook and Telegram configuration.

## OMP Conventions

The `omp-conventions` plugin renames complete opening and closing
`system-conventions` and `system_conventions` XML tags to `conventions` in
Cloud Code Assist system instructions, preserving plain-text names and block
contents. It uses an Oh My Pi extension and applies only to Oh My Pi. See
[`plugins/omp-conventions/README.md`](plugins/omp-conventions/README.md)
for installation, updates, and validation instructions.

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

## Obsidian Skills

The `obsidian-skills` plugin mirrors every skill under
[`kepano/obsidian-skills/skills`](https://github.com/kepano/obsidian-skills/tree/main/skills).
The manifest registers only the lightweight `obsidian` router under `skills/`;
the upstream skills are stored under `internal-skills/` and remain unregistered.
The router activates for Obsidian requests and work in an Obsidian vault, then
loads only the selected workflow. Each snapshot records its source commit in
`plugins/obsidian-skills/.upstream-revision`.

Routing uses the discovered skill metadata rather than a fixed list, so newly
synchronized workflows remain discoverable. Knap requests cover Markdown
template rendering and batch note generation from JSON or CSV; web extraction
followed by template rendering uses Defuddle together with Knap.

### Upstream synchronization

The `Sync Obsidian skills` GitHub Actions workflow checks the upstream `main`
branch every six hours and can also be run manually. When the upstream skills
change, it mirrors additions, updates, and removals, runs the tests, and pushes
a signed-off synchronization commit to this repository's default branch.

Run the same process locally with:

```bash
./scripts/sync_obsidian_skills.sh
python3 -m unittest discover -s tests
```

The mirrored skills and plugin-level `LICENSE` are distributed under the
upstream project's MIT license. The surrounding repository uses its own MIT
license.
