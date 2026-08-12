# Engineering Delivery

Engineering Delivery packages one shared delivery skill and native agent definitions for Codex,
Claude Code, Pi, and Oh My Pi. The workflow covers requirements analysis, parallel backend,
frontend, and documentation exploration, dependency-aware planning, isolated implementation,
debugging, testing, and independent review. All shared role metadata and prompts live in
`agent-templates/agents.json`. Four thin templates under `agent-templates/templates/` describe
only each host's native file format, and `scripts/generate-agents.py` renders the installable
definitions. The repository therefore does not keep 40 expanded agent files in sync by hand.

## Brainstorming and planning

Before exploring or implementing, Engineering Delivery turns the request into a short brainstorm:
outcome, alternatives, trade-offs, assumptions, risks, and non-goals. It asks for confirmation
only when a decision would materially affect scope, architecture, contracts, migrations,
dependencies, compatibility, security, cost, or an irreversible action. In that case it presents
numbered options with their impact and a recommendation, then waits for the user's selection.

After confirmation, the shared workflow enters the host's planning experience. Codex uses Plan
mode when available and otherwise uses its read-only agent sandbox; Claude Code can be launched
with `--permission-mode plan`; Pi can use its optional `plan-mode` extension. These integrations
are optional enhancements: the plugin always preserves a portable, read-only planning and user
decision gate for Codex, Claude Code, Pi, and Oh My Pi.

When the design is complete and approved, the coordinator writes it to
`docs/<task-id>-design.md` in the target repository before creating worktrees or changing
implementation files. The document records the confirmed requirements, decisions and
alternatives, architecture, implementation plan, test strategy, assumptions, risks, and rollout
notes. It is updated whenever the design changes materially.

## Workflow in practice

The coordinator owns the request, decisions, and integration. Specialist agents receive a
bounded scope and return concise evidence; they do not independently expand the work. The normal
path is:

```text
+-------------------+
| User request      |
+---------+---------+
          |
          v
+-------------------+     material decision      +-------------------+
| Inspect repo, git | -------------------------> | Ask user to choose |
| rules, and state  |                            +---------+---------+
+---------+---------+                                      |
          | no blocking decision                            v
          v                                      +-------------------+
+-------------------+                            | Record selection  |
| Requirements and  | <--------------------------+-------------------+
| brainstorm        |
+---------+---------+
          |
          v
+-------------------+
| Read-only         |
| exploration       |
| backend | frontend|
| docs (as needed)  |
+---------+---------+
          |
          v
+-------------------+
| Planner produces  |
| dependency DAG    |
+---------+---------+
          | new material decision
          +-------------------------------------> Ask user to choose
          |
          v
+-------------------+
| Write and verify  |
| docs/<task-id>-   |
| design.md         |
+---------+---------+
          |
          v
+-------------------+
| Implement units   |
| and unit tests    |
| (parallel only    |
| for disjoint work)|
+---------+---------+
          |
          v
+-------------------+
| Integrate in DAG  |
| dependency order  |
+---------+---------+
          |
          v
+-------------------+     failure                +-------------------+
| Test and review   | -------------------------> | Debug from        |
| in parallel       |                            | reproduced proof  |
+---------+---------+                            +---------+---------+
          | pass                                             |
          v                                                  |
+-------------------+ <--------------------------------------+
| Deliver summary   |       rerun affected checks and review
+-------------------+
```

1. **Establish the brief.** Inspect repository instructions and the current Git state, preserving
   unrelated changes. `ed-requirements` turns the request into outcomes, acceptance criteria,
   constraints, assumptions, risks, and non-goals. The coordinator asks the user only about
   decisions that would materially change the result; ordinary uncertainties become documented
   assumptions.
2. **Explore before editing.** Use the host's read-only planning mode when available. Run
   `ed-backend-explorer`, `ed-frontend-explorer`, and `ed-docs` concurrently only for applicable
   areas. Their reports identify relevant files, contracts, existing tests, dependencies, risks,
   and validation needs. Omitted lanes are recorded with a reason.
3. **Plan ownership and dependencies.** `ed-planner` converts the confirmed brief and evidence
   into a DAG. Each unit names its goal, dependencies, exact write set, forbidden paths, tests,
   parallel-safety decision, and risk. Units that could touch the same contract, generated file,
   lockfile, migration, schema, shared type, or global configuration are sequenced instead of
   parallelized.
4. **Make the approved design durable.** Before implementation, write
   `docs/<task-id>-design.md` with the accepted decisions, alternatives, architecture, DAG,
   affected files, test strategy, assumptions, risks, and rollout or rollback notes. A material
   change returns the workflow to the decision gate and updates this document.
5. **Implement with isolated ownership.** An `ed-implementer` owns one bounded unit and its
   tests. Independent write units may use worktrees under `.git/wtm/<task-id>/` and branches named
   `workflow/<task-id>/<unit-id>`; tightly coupled work remains one unit. Behavior changes follow
   TDD: add a reusable failing test, verify the failure, make the smallest change, then verify the
   pass.
6. **Integrate and independently verify.** Integrate completed units in DAG order. Then run
   `ed-tester` and `ed-reviewer` in parallel against the integrated tree. Their findings must cite
   reproducible evidence and concrete locations.
7. **Repair from evidence and close the loop.** `ed-debugger` changes code only after reproducing
   a failure or establishing its root cause. Rerun the affected tests and review after each repair;
   after three unsuccessful repair rounds, report the blocker rather than continuing blindly. The
   final summary states delivered behavior, tests, review outcome, commits, worktrees, assumptions,
   and residual risks.

The workflow uses worktrees only for parallel writing. A clean current checkout is the integration
worktree; otherwise it creates `.git/wtm/<task-id>/integration`, leaves the user's checkout
untouched, and integrates completed signed-off commits in dependency order.

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
