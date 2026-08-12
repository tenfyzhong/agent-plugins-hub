# Single Implementer Delegation Design

## Problem statement

Engineering Delivery currently requires bounded implementation units but does not explicitly say
that an unsplittable implementation unit must be delegated to one `ed-implementer`.

## Decision

For every implementation-ready plan, use an `ed-implementer` for each bounded unit. When the
work cannot be safely split, the planner emits one unit and the coordinator assigns it to exactly
one `ed-implementer`. Parallel implementation remains limited to independent, non-overlapping
units. Documentation-only work does not require a meaningless implementation delegation.

## Alternatives

- Let the coordinator implement single-unit changes directly. This weakens the role contract and
  makes delegation inconsistent.
- Require multiple implementers for every task. This would add unsafe or artificial fan-out.

## Implementation DAG

1. Add a regression assertion for the single-implementer delegation contract.
2. Update the shared skill and generated-agent source prompts to state the contract.

## Affected files

- `plugins/engineering-delivery/skills/engineering-delivery/SKILL.md`
- `plugins/engineering-delivery/agent-templates/agents.json`
- `tests/test_engineering_delivery_plugin.py`

## Test strategy

Run the focused Engineering Delivery test module, then the full repository unittest suite. The
test must fail before the contract language is added and pass afterward.

## Assumptions and risks

The existing dirty changes in the affected files are preserved. The wording must not require an
implementer when there is no implementation unit.

## Rollback

Revert only the delegation-contract wording and its regression assertions.
