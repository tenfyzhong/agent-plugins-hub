# Repository Guidelines

## Project Structure & Module Organization

This repository distributes cross-agent plugins for Codex, Claude Code, and Pi. Marketplace catalogs live in `.agents/plugins/marketplace.json` and `.claude-plugin/marketplace.json`; `package.json` supplies Pi metadata. Each plugin belongs under `plugins/<plugin-name>/` with agent-specific manifests, registered skills in `skills/`, and any supporting assets beside the skill that uses them.

The `lark-cli-skills` plugin exposes one lazy router at `plugins/lark-cli-skills/skills/lark/`. Its `internal-skills/` tree and `LICENSE` mirror `larksuite/cli`; regenerate them with the sync script instead of editing mirrored files manually. Maintenance utilities live in `scripts/`, repository tests in `tests/`, and automation in `.github/workflows/`.

## Build, Test, and Development Commands

There is no build step. Run commands from the repository root:

- `python3 -m unittest discover -s tests` runs the full validation suite.
- `python3 -m unittest tests.test_marketplace_layout` runs one test module.
- `./scripts/sync_lark_cli_skills.sh` fetches, normalizes, and records the latest upstream skills snapshot. This requires network access and replaces mirrored content.
- `codex plugin marketplace add .`, `claude plugin marketplace add .`, or `pi install .` installs the local checkout for manual testing.

## Coding Style & Naming Conventions

Use four spaces in Python and shell scripts, and two spaces in YAML and JSON. Remove trailing whitespace and keep files newline-terminated. Follow existing Python `unittest` style, descriptive `snake_case` names, and `test_<behavior>` methods. Plugin and skill directories use lowercase kebab-case, such as `lark-cli-skills`. Keep manifests valid JSON and keep versions and skill paths aligned across agent manifests.

## Testing Guidelines

Use test-driven development for behavior changes: add a reusable failing test first, confirm the expected failure, then implement the smallest fix. Add tests under `tests/test_<topic>.py` using Python's standard `unittest` framework. Validate catalog paths, manifest parity, router discovery, and synchronization behavior when those areas change. Run the complete suite before opening a pull request.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit-style subjects: `feat: ...`, `refactor(lark-cli-skills): ...`, and `chore(lark-cli-skills): ...`. Keep commits focused and always sign them off with `git commit -s`. Pull requests should explain the change, affected agents or plugins, test results, and any upstream revision involved; link relevant issues and include screenshots only for visible UI changes.
