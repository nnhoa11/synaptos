# SynaptOS LLM-Integrated Control Tower Implementation Plan

## Planning Metadata

- Feature: `synaptos-control-tower-llm`
- Workspace root: `/Users/nguyenngochoa/Git/gg-hackathon`
- Feature directory: `/Users/nguyenngochoa/Git/gg-hackathon`
- Branch: `main`
- Spec: [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md)
- Supporting references:
  - [research.md](/Users/nguyenngochoa/Git/gg-hackathon/research.md)
  - [data-model.md](/Users/nguyenngochoa/Git/gg-hackathon/data-model.md)
  - [contracts/api-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/api-contract.md)
  - [contracts/ui-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/ui-contract.md)
  - [quickstart.md](/Users/nguyenngochoa/Git/gg-hackathon/quickstart.md)

## Feature Summary

Integrate real LLM providers into the control-tower architecture without giving model output execution authority. The system should:

1. aggregate source facts
2. build a replayable prompt context
3. invoke a real provider through a gateway
4. parse structured proposals
5. enforce deterministic guardrails
6. route approved work to labels, approval, logistics, or procurement

## Technical Context

### Current Runtime

- `Next.js` App Router application
- `React` client UI
- `Postgres` persistence through `pg`
- cookie-backed RBAC
- `SSE` event stream
- deterministic inventory logic in `lib/prototype-core.js`
- durable orchestration in `lib/server/prototype-store.js`
- additive `legacy` and `control_tower` runtime modes

### Technical Decisions

- Keep the deployment shape as a modular monolith.
- Keep the LLM behind a provider gateway inside `lib/server/agent/providers/*`.
- Require strict structured output validation before proposal persistence.
- Keep deterministic rules as the sole authority for execution eligibility.
- Introduce `shadow`, `assisted`, and `live` rollout modes for model-backed runs.
- Preserve legacy deterministic fallback behavior when provider calls fail.

### Dependencies

- `Postgres` schema bootstrap in `lib/server/prototype-store.js`
- SSE bus in `lib/server/events.js`
- auth and RBAC helpers in `lib/server/auth.js`
- UI shell in `components/PrototypeApp.jsx`
- environment-backed provider credentials such as `OPENAI_API_KEY` or `GEMINI_API_KEY`

### Clarifications Resolved In Research

- provider integration stays inside the monolith
- model calls are adapter-based, not route-handler-specific
- prompt building, schema validation, and provider invocation are separate internal concerns
- full model-run artifacts must be persisted
- shadow mode is the first real-provider rollout mode

## Constitution Check

This plan is governed by [constitution.md](/Users/nguyenngochoa/Git/gg-hackathon/constitution.md)
`v1.0.0`.

Applicable constitutional gates:

- model output must remain advisory and cannot bypass deterministic guardrails
- provider failures must degrade safely and preserve fallback behavior
- simulated feeds and executors must stay explicit in payloads, UI, and docs
- every model run and execution path must be auditable and replayable
- risky actions must remain role-aware and human-controlled where policy requires it
- rollout must be additive, not a flag day rewrite

Post-design assessment:

- the plan keeps the new path additive
- every execution path still depends on guardrail outcomes
- the model layer is bounded by schema validation and deterministic rules
- procurement and logistics remain simulated-first
- the planned task graph includes audit, authorization, and runtime-state visibility gates

## BuildBetter Context

BuildBetter artifacts are unavailable in this workspace.

Planning evidence base:

- the user request to plan the real LLM-integrated architecture
- the existing control-tower spec in [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md)
- the current runtime already present in the repository

Affected product area:

- retail operations control tower

Affected users:

- admin
- manager
- staff
- procurement planner
- logistics coordinator

Affected domains:

- pricing
- approval workflow
- inventory routing
- procurement planning
- model governance

Role naming note:

- business-facing documents use `procurement planner` and `logistics coordinator`
- implementation identifiers use `procurement_planner` and `logistics_coordinator`

## Architecture and Boundaries

### Data Sources Boundary

Responsibilities:

- ingest external and internal signals
- distinguish `simulated` vs `live` provenance
- preserve freshness metadata

Planned code area:

- `lib/server/aggregation/*`
- `lib/server/prototype-store.js`

### Aggregation Boundary

Responsibilities:

- normalize source records
- score freshness and source health
- compact operational context into an `AggregatedSnapshot`

Planned code area:

- `lib/server/aggregation/*`
- `app/api/aggregation/*`

### Prompting Boundary

Responsibilities:

- build compact prompt context from `AggregatedSnapshot`
- inject policy hints that inform but do not authorize
- version prompt templates

Planned code area:

- `lib/server/agent/prompt-builder.js`
- `lib/server/agent/prompt-templates/*`
- `lib/server/agent/schemas.js`

### Provider Gateway Boundary

Responsibilities:

- resolve provider adapters
- call `OpenAI`, `Gemini`, or `mock`
- handle retries, rate limits, and provider-specific normalization

Planned code area:

- `lib/server/agent/providers/*`
- `lib/server/agent/provider-registry.js`
- `lib/server/agent/client.js`

### Proposal Validation Boundary

Responsibilities:

- parse provider output
- validate structured proposals against the internal schema
- persist parse failures and validation failures

Planned code area:

- `lib/server/agent/response-parser.js`
- `lib/server/agent/validate-proposals.js`
- `lib/server/agent/orchestrator.js`

### Rule Boundary

Responsibilities:

- deterministic policy evaluation
- stale-source blocking
- auto-route, approval-route, or block decisions
- bounded procurement and logistics constraints

Planned code area:

- `lib/server/rules/*`
- `app/api/proposals/*`

### Execution Boundary

Responsibilities:

- label publication
- approval-cleared dispatch
- logistics task creation
- procurement task creation

Planned code area:

- `lib/server/execution/*`
- `app/api/execution/*`
- `app/api/logistics/*`
- `app/api/procurement/*`

### Observability Boundary

Responsibilities:

- persist model-run metadata, input artifacts, and output artifacts
- emit realtime events for aggregation, model runs, approvals, and execution
- expose operator-visible audit and policy views

Planned code area:

- `lib/server/prototype-store.js`
- `lib/server/events.js`
- `app/api/audit/*`
- `app/api/metrics/*`

### Control-Tower UI Boundary

Responsibilities:

- source freshness views
- model run visibility
- proposal queue
- approval queue
- logistics workbench
- procurement console
- audit and policy visibility

Primary code area:

- `components/PrototypeApp.jsx`
- `components/ControlTowerConsole.jsx`
- `app/page.jsx`

## Data Model Reference

The detailed entity model is in [data-model.md](/Users/nguyenngochoa/Git/gg-hackathon/data-model.md).

Plan-critical entities:

- `SignalObservation`
- `AggregationRun`
- `AggregatedSnapshot`
- `PromptTemplate`
- `ModelRun`
- `ModelInputArtifact`
- `ModelOutputArtifact`
- `ActionProposal`
- `GuardrailEvaluation`
- `ApprovalRequest`
- `ExecutionTask`
- `LogisticsRoute`
- `ProcurementOrder`

## Interface Contracts

The detailed interfaces are defined in:

- [contracts/api-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/api-contract.md)
- [contracts/ui-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/ui-contract.md)

## Implementation Phases

### Phase 0. Research and Safety Framing

Artifacts:

- [research.md](/Users/nguyenngochoa/Git/gg-hackathon/research.md)
- [plan.md](/Users/nguyenngochoa/Git/gg-hackathon/plan.md)

Outcome:

- the LLM integration constraints, provider strategy, and rollout model are defined

### Phase 1. LLM Gateway Foundation

Deliverables:

- provider registry
- at least one real provider adapter
- prompt template versioning
- model-run persistence tables

Implementation focus:

- add `lib/server/agent/providers/*`
- extend `lib/server/prototype-store.js`
- add provider-aware model-run endpoints

Acceptance criteria:

- one provider-backed model run can be invoked with environment credentials
- provider failures are persisted with clear failure states
- the existing app still starts without requiring all providers to be configured

### Phase 2. Structured Proposal Parsing and Shadow Mode

Deliverables:

- prompt builder
- strict output schema
- parse and validation pipeline
- `shadow` mode runtime controls

Implementation focus:

- add `lib/server/agent/prompt-builder.js`
- add `lib/server/agent/response-parser.js`
- extend `lib/server/agent/orchestrator.js`

Acceptance criteria:

- malformed provider output is rejected before proposal persistence
- successful model runs persist input and output artifacts
- shadow mode proposals appear in UI and audit history without bypassing guardrails

### Phase 3. Deterministic Guardrails and Execution Routing

Deliverables:

- policy evaluation for model proposals
- approval routing for risky markdowns
- typed execution task generation for all routes
- execution-stage audit persistence for route outcomes and provider failure states

Implementation focus:

- extend `lib/server/rules/*`
- extend `lib/server/execution/*`
- add route-level authorization and dispatch enforcement

Acceptance criteria:

- every proposal receives a deterministic guardrail outcome
- low-risk markdowns can route to labels
- high-risk markdowns require approval
- logistics and procurement tasks remain bounded and simulated-first
- final route outcomes and provider failure states are captured in audit history

### Phase 4. Model Observability and Control-Tower UI

Deliverables:

- model run detail surface
- provider/model visibility in the UI
- audit and policy views that include model stages
- source provenance and simulation badges for feeds and downstream connectors

Implementation focus:

- evolve `components/PrototypeApp.jsx`
- extend `components/ControlTowerConsole.jsx`
- extend `app/api/stores/[storeId]/control-tower/route.js`
- extend `app/api/agent/runs/[id]/route.js`
- extend audit and metrics endpoints

Acceptance criteria:

- users can distinguish aggregation, model run, proposal, guardrail, and execution state
- operator-visible audit history includes model failures and parse failures
- source provenance is visible in control-tower views
- simulation badges remain visible for non-live connectors

### Phase 5. Production Hardening and Rollout

Deliverables:

- retry and timeout policy
- provider cost accounting
- seeded eval and replay scenarios
- operator-visible rate-limit and timeout state
- cutover rules for moving stores from `shadow` to `assisted` or `live`

Acceptance criteria:

- model run cost and usage can be reported
- rate-limit and timeout behavior is operator-visible
- seeded replay scenarios can be executed for regression checks
- the legacy deterministic path remains available during rollout validation

## Delivery Order

1. LLM gateway foundation
2. structured proposal parsing and shadow mode
3. deterministic guardrails and execution routing
4. model observability and control-tower UI
5. production hardening and rollout

## Risks and Mitigations

### Risk: The model becomes the de facto execution authority

Mitigation:

- keep deterministic rules after every model run
- reject any proposal that does not validate or lacks guardrail evaluation

### Risk: Provider failures make the product unreliable

Mitigation:

- persist provider failure states
- keep additive rollout and deterministic fallback behavior
- expose model-run failure state in the UI

### Risk: Prompt and output drift break trust in proposals

Mitigation:

- version prompt templates
- persist raw and parsed artifacts
- require strict structured output contracts

### Risk: Costs grow invisibly

Mitigation:

- capture provider usage and estimated cost per model run
- surface model-run metrics in audit or admin views

### Risk: UI complexity outruns implementation pace

Mitigation:

- prioritize model run visibility before advanced operator polish
- ship `shadow` mode before `assisted` or `live`

## Minimum Credible Demo Cut Line

If implementation time is constrained, the minimum acceptable LLM-integrated release includes:

1. aggregated snapshot generation
2. one real provider-backed model run
3. strict structured proposal parsing
4. deterministic guardrail evaluation
5. label routing for low-risk markdowns
6. operator-visible model run and audit history

## Readiness for Next Phase

This artifact set is ready for task regeneration. The next step should be a fresh `tasks.md` aligned to the real LLM gateway, prompt, observability, and rollout work described above.
