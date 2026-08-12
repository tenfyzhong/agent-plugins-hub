---
name: engineering-delivery
description: Coordinate end-to-end software delivery with brainstorming, user decision gates, host-native planning, specialized exploration, implementation, debugging, testing, and review. Use for features, bug fixes, refactors, migrations, or other repository changes that benefit from deliberate discovery and dependency-aware delivery.
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

## Brainstorming and decision gate

Before repository exploration or implementation planning, lead a short, structured brainstorm in
the main thread. Use `ed-requirements` to turn the request into a concise brief that contains:

- the desired outcome, user and system boundaries, and success criteria;
- two or more viable approaches when meaningful, with their trade-offs;
- explicit assumptions, risks, and non-goals; and
- decisions that would materially change scope, architecture, public contracts, data migration,
  dependencies, compatibility, security, cost, or irreversible actions.

Do not ask for confirmation merely to offload ordinary engineering judgment. Make and record a
reasonable assumption for an immaterial uncertainty. For every material decision, present a
numbered set of mutually exclusive options. Each option must state its impact and identify the
recommended option. Require the user's explicit selection before continuing past the decision
gate; do not begin implementation, create worktrees, or make production edits while a required
selection is outstanding.

If the user asks to revise the brainstorm, return to this phase. If exploration or planning
uncovers a new material decision, pause again with the same options format. When the request is
already unambiguous, state that no confirmation is required and continue.

## Host plan integration

Treat the decision-gated brief as the input to the host's native planning experience. Keep the
workflow contract below host-neutral; never rely on one host's slash command being available in
another host.

- **Codex:** use the host's Plan mode when available. Keep requirements, exploration, and planner
  work read-only through their native sandbox settings; if Plan mode is unavailable, use the same
  read-only phase and present the plan in the main thread before implementation.
- **Claude Code:** start or continue the discovery and planning phase with
  `--permission-mode plan` when the invoking environment supports it. The generated read-only
  agents remain a safe fallback when that launch option is unavailable.
- **Pi:** use its plan workflow when installed, including the optional `plan-mode` extension and
  its `/plan` command. Do not require that extension: the generated read-only tool allowlists and
  this decision gate are the portable fallback.
- **Oh My Pi:** follow the same portable read-only and decision-gated workflow.

## Design document gate

After the design is complete—meaning the requirements are confirmed, exploration evidence is
available, the implementation DAG is accepted, and no material decision remains—write the design
document to `docs/<task-id>-design.md` in the target repository. Create `docs/` when it does not
exist. Choose a stable, descriptive `<task-id>` and reuse it for the plan and any worktrees.

The document must capture the confirmed problem statement, accepted decisions and alternatives,
architecture or contract changes, implementation DAG, affected files, test strategy, assumptions,
risks, and rollout or rollback notes when applicable. Treat this as a project artifact, not a
chat-only summary. If the design changes materially, update the document before resuming work.

Writing this document is mandatory before creating worktrees or making implementation edits. If
the repository has a more specific documentation convention, follow it while still placing the
design document under `docs/`.

## Workflow

1. Inspect repository instructions and current git state. Preserve unrelated user changes. If a remote exists, run `git pull --ff-only` before implementation; stop on divergence instead of rebasing, stashing, or resetting automatically.
2. Run the brainstorming and decision gate with `ed-requirements`. Resolve only questions that materially change the solution; otherwise record explicit assumptions. Wait for required user selections.
3. Enter the host plan integration phase, then run `ed-backend-explorer`, `ed-frontend-explorer`, and `ed-docs` in parallel when their scopes apply. Omit irrelevant lanes and explain why.
4. Run `ed-planner` with the confirmed brief and exploration evidence. Require a dependency DAG before any production edit. Surface a new material decision to the user before accepting the plan.
5. Write the completed design to `docs/<task-id>-design.md`, then verify the document reflects the accepted plan.
6. Execute ready implementation units only after the design document and all required selections are confirmed. Run independent units in parallel only when their write sets do not overlap and their validation can run independently. When work cannot be safely split, create one implementation unit and assign it to exactly one `ed-implementer`.
7. Integrate completed units in dependency order.
8. Run `ed-tester` and `ed-reviewer` in parallel against the integrated result.
9. Send concrete failures to `ed-debugger`, then rerun the affected tests and review. Stop after three unsuccessful repair rounds and report the remaining blocker.
10. Summarize behavior delivered, tests run, review outcome, commits, worktrees, assumptions, and residual risks.

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
design_document: docs/<task-id>-design.md
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
