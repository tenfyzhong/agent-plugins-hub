# Engineering Delivery

Engineering Delivery packages one shared delivery skill and native agent definitions for Codex,
Claude Code, Pi, and Oh My Pi. The workflow covers requirements analysis, parallel backend,
frontend, and documentation exploration, dependency-aware planning, isolated implementation,
debugging, testing, and independent review. All shared role metadata and prompts live in
`agent-templates/agents.json`. Four thin templates under `agent-templates/templates/` describe
only each host's native file format, and `scripts/generate-agents.py` renders the installable
definitions. The repository therefore does not keep 40 expanded agent files in sync by hand.

## Install agent definitions

Install all four agent sets directly from GitHub with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/tenfyzhong/agent-plugins-hub/main/plugins/engineering-delivery/scripts/install-agents.sh | bash
```

The installer requires `python3`; curl-based installation also requires `curl`.

Pass installer options after `bash -s --`, for example:

```bash
curl -fsSL https://raw.githubusercontent.com/tenfyzhong/agent-plugins-hub/main/plugins/engineering-delivery/scripts/install-agents.sh | bash -s -- --platform codex
```

From the repository root, install all four agent sets with:

```bash
./plugins/engineering-delivery/scripts/install-agents.sh
```

Install only one host with `--platform codex`, `claude`, `pi`, or `omp`:

```bash
./plugins/engineering-delivery/scripts/install-agents.sh --platform codex
```

The installer generates native definitions in a temporary directory, then copies them to these
editable locations:

| Host | Agent directory |
| --- | --- |
| Codex | `~/.codex/agents/` |
| Claude Code | `~/.claude/agents/` |
| Pi | `~/.pi/agent/agents/` |
| Oh My Pi | `~/.omp/agent/agents/` |

Running the installer again preserves files that differ from the bundled templates. Use `--force`
to back up and replace customized files. Backups are stored below
`${XDG_STATE_HOME:-~/.local/state}/engineering-delivery/backups/`.

## Edit or generate agent definitions

Edit role descriptions, prompts, and per-host model settings in
`agent-templates/agents.json`. Edit the files under `agent-templates/templates/` only when a
host's native agent format changes. To inspect every generated definition without installing it:

```bash
python3 plugins/engineering-delivery/scripts/generate-agents.py \
  --definitions plugins/engineering-delivery/agent-templates/agents.json \
  --templates plugins/engineering-delivery/agent-templates/templates \
  --output /tmp/engineering-delivery-agents
```

Pass `--platform codex`, `claude`, `pi`, or `omp` to generate one host only. Generated files are
build artifacts and should not be added back under `agent-templates/`.

## Uninstall agent definitions

Remove all four agent sets directly from GitHub with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/tenfyzhong/agent-plugins-hub/main/plugins/engineering-delivery/scripts/uninstall-agents.sh | bash
```

Remove all four agent sets with:

```bash
./plugins/engineering-delivery/scripts/uninstall-agents.sh
```

Use `--platform` to remove one host only. Customized files are backed up before removal.

## Install the skill plugin

After adding this repository as a marketplace, install `engineering-delivery` through Codex,
Claude Code, or Oh My Pi:

```bash
codex plugin add engineering-delivery@tenfyzhong-agent-plugins-hub
claude plugin install engineering-delivery@tenfyzhong-agent-plugins-hub
omp plugin install engineering-delivery@tenfyzhong-agent-plugins-hub
```

Pi users can install the repository package; its package metadata registers this skill:

```bash
pi install git:github.com/tenfyzhong/agent-plugins-hub
```

The plugin install and the agent installer are separate: the plugin exposes the shared skill,
while the script places editable host-native agent definitions in each user's configuration
directory.
