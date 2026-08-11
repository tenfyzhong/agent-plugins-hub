---
name: engineering-delivery
description: Coordinate end-to-end software delivery with specialized agents for requirements, backend and frontend exploration, documentation and dependency research, planning, implementation, debugging, testing, and review. Use for features, bug fixes, refactors, migrations, or other repository changes that benefit from staged analysis, parallel read-only exploration, dependency-aware planning, isolated worktree implementation, and independent verification.
---

# Engineering Delivery

Coordinate the work from the main thread. Delegate bounded tasks to the exact `ed-*` agents exposed by the current harness, collect their results, and keep decisions in the main thread.

## Roles

- `ed-requirements`: clarify scope, acceptance criteria, constraints, and open questions.
- `ed-backend-explorer`: trace backend entry points, data flow, tests, and risks without editing.
- `ed-frontend-explorer`: trace UI entry points, state, API boundaries, tests, and risks without editing.
- `ed-docs`: verify external documentation, versions, dependencies, and compatibility without editing.
- `ed-planner`: turn evidence into an implementation DAG with ownership and validation contracts.
- `ed-implementer`: implement one bounded unit and its tests.
- `ed-debugger`: diagnose failures and apply the smallest justified repair.
- `ed-tester`: run relevant checks and report reproducible evidence without editing product code.
- `ed-reviewer`: independently review correctness, security, regressions, and missing tests.
- `ed-main`: optional coordinator persona when the harness supports starting a named agent as the main session.

If an agent is unavailable, perform that role in the main thread and disclose the fallback.

## Workflow

1. Inspect repository instructions and current git state. Preserve unrelated user changes. If a remote exists, run `git pull --ff-only` before implementation; stop on divergence instead of rebasing, stashing, or resetting automatically.
2. Run `ed-requirements`. Resolve only questions that materially change the solution; otherwise record explicit assumptions.
3. Run `ed-backend-explorer`, `ed-frontend-explorer`, and `ed-docs` in parallel when their scopes apply. Omit irrelevant lanes and explain why.
4. Run `ed-planner` with the requirements and exploration briefs. Require a dependency DAG before any production edit.
5. Execute ready implementation units. Run independent units in parallel only when their write sets do not overlap and their validation can run independently.
6. Integrate completed units in dependency order.
7. Run `ed-tester` and `ed-reviewer` in parallel against the integrated result.
8. Send concrete failures to `ed-debugger`, then rerun the affected tests and review. Stop after three unsuccessful repair rounds and report the remaining blocker.
9. Summarize behavior delivered, tests run, review outcome, commits, worktrees, assumptions, and residual risks.

Do not delegate merely to increase agent count. Keep tightly coupled edits in one unit.

## Planning contract

Require the planner to return:

```yaml
summary: <one sentence>
shared_contracts:
  - <schema, API, migration, lockfile, shared type, or global config>
units:
  - id: <stable-id>
    goal: <bounded outcome>
    depends_on: []
    write_set: []
    forbidden_paths: []
    tests: []
    parallel_safe: true
    risk: low
integration_order: []
final_checks: []
```

Reject a plan when two parallel units may edit the same file, generated output, lockfile, migration chain, schema, shared type, or global configuration. Implement shared contracts first, then rebase dependent unit plans on that contract.

## Worktree protocol

Use worktrees only for parallel write units.

- Resolve the repository root and git common directory before creating paths.
- Place every worktree under `<repo>/.git/wtm/<task-id>/`.
- Use branches named `workflow/<task-id>/<unit-id>`.
- Use the current clean worktree as the integration worktree. If it is not clean, create `<repo>/.git/wtm/<task-id>/integration` and leave the user's checkout untouched.
- Give each implementer one worktree path, one branch, one write set, and one test contract.
- Require every command and edit to stay inside the assigned worktree.
- Require signed-off commits with `git commit -s`.
- Cherry-pick completed unit commits into the integration branch in dependency order.
- Never auto-stash, force-push, reset, delete branches, or remove worktrees. Report cleanup candidates to the user.
- Limit concurrent writers to three unless the plan demonstrates that a larger fan-out is safe.

## Implementation and verification rules

- Follow repository-local instruction files over this skill when they are more specific.
- Use TDD for feature, bug-fix, refactor, and behavior changes: add a reusable test, verify the expected failure, implement the smallest change, then verify the pass.
- Keep exploration, testing, and review agents read-only with respect to product code.
- Treat test output, compiler output, runtime traces, and cited source locations as evidence. Do not report success without evidence.
- Keep reviewer findings ordered by severity and tied to concrete files, symbols, or reproduction steps.
- Let the debugger edit only after a failure is reproduced or the root cause is supported by concrete evidence.
- Revalidate the integrated tree; unit-level success is insufficient.

## Agent handoff

Give every delegated agent:

- the user goal and accepted assumptions;
- the repository or worktree path;
- its exact scope and prohibited actions;
- relevant upstream findings or plan units;
- the expected output format;
- the commands or evidence needed to declare completion.

Ask agents to return concise summaries rather than raw logs. Preserve full logs in the agent transcript when the harness supports it.
