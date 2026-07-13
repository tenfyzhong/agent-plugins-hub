# Agent Plugins Hub

A cross-agent marketplace for plugins maintained in this repository. It
supports OpenAI Codex, Claude Code, and Pi while keeping each agent's native
package metadata alongside shared Agent Skills.

## Repository layout

```text
.
├── .agents/plugins/marketplace.json    # Codex marketplace catalog
├── .claude-plugin/marketplace.json     # Claude Code marketplace catalog
├── .github/workflows/                  # Marketplace automation
├── plugins/
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
