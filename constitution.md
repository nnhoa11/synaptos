<!--
Sync Impact Report
- Version change: none -> 1.0.0
- Modified principles: initial adoption
- Added sections: Core Principles; Delivery and Review Gates; Governance
- Removed sections: none
- Templates requiring updates:
  - updated: plan.md
  - updated: checklists/requirements.md
  - pending: none
- Follow-up TODOs: none
-->
# SynaptOS Constitution

## Core Principles

### Deterministic Authority Over Model Output
Model output MUST remain advisory. Every proposal MUST pass deterministic validation and
guardrail evaluation before it can create or dispatch operational work. No provider adapter,
prompt, or model response may bypass policy enforcement, authorization, or route controls.
Rationale: the system is demonstrating decision architecture, not unconstrained autonomy.

### Auditability And Replay By Default
Every aggregation run, model run, parse outcome, guardrail decision, approval event, and
execution outcome MUST be persisted or derivable from durable artifacts so operators can inspect
what happened without direct database access. New execution paths MUST define their audit trail
before they are treated as complete. Rationale: trust depends on being able to explain outcomes.

### Honest Runtime States And Integrations
Simulated feeds, simulated executors, and rollout modes MUST be clearly labeled in API payloads,
UI surfaces, and documentation. The product MUST NOT imply that a connector, source, or
automation path is live when it is still mocked, replayed, or simulated. Rationale: demo
credibility depends on technical honesty.

### Additive Rollout With Safe Fallbacks
New control-tower capabilities MUST land incrementally and MUST preserve a working fallback path
while shadow or assisted modes are being validated. Provider failures, rate limits, and timeouts
MUST degrade safely rather than break the full runtime. Rationale: the prototype must stay
demoable while architecture evolves.

### Role-Aware Human Control
Risky actions MUST remain subject to role-based permissions and, where defined by policy, human
approval. Approval, rejection, dispatch, logistics handling, and procurement actions MUST be
performed only by authorized roles, and blocked proposals MUST never appear as executable work.
Rationale: operational control is part of the product promise, not an optional layer.

## Delivery And Review Gates

- Specs, plans, and task graphs MUST preserve the five core principles above.
- Work that introduces a new route, provider, or execution surface MUST include:
  - explicit audit coverage
  - explicit authorization coverage
  - visible runtime-state labeling where simulation or rollout modes apply
- Shadow mode is the default first release mode for new provider-backed behavior unless a later
  plan explicitly justifies `assisted` or `live`.
- A feature is not ready for implementation if its artifacts omit deterministic safety,
  auditability, or additive-rollout coverage.

## Governance

This constitution is authoritative for project-level planning and implementation governance.
Changes MUST be made through an explicit constitution update. Versioning follows semantic
versioning:

- MAJOR: backward-incompatible redefinition or removal of a core principle
- MINOR: a new principle or materially expanded governance requirement
- PATCH: wording clarifications that do not change governance meaning

Compliance review expectations:

- `spec.md`, `plan.md`, and `tasks.md` MUST be checked against this constitution before
  implementation is treated as ready.
- Any analysis that cannot validate constitution alignment MUST state that explicitly.
- If a planned change conflicts with this constitution, the spec, plan, or tasks MUST be changed,
  or the constitution MUST be amended in a separate explicit step.

Amendment procedure:

1. Propose the change and its rationale.
2. Determine semantic version impact.
3. Update `constitution.md` and any affected planning artifacts in the same change.
4. Re-run artifact consistency analysis before implementation proceeds.

**Version**: 1.0.0 | **Ratified**: 2026-04-17 | **Last Amended**: 2026-04-17
