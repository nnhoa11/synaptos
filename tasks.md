# Tasks: SynaptOS LLM-Integrated Control Tower

## Feature

- Feature name: `synaptos-control-tower-llm`
- Plan: [plan.md](/Users/nguyenngochoa/Git/gg-hackathon/plan.md)
- Spec: [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md)

## Available Design Artifacts

- [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md)
- [plan.md](/Users/nguyenngochoa/Git/gg-hackathon/plan.md)
- [research.md](/Users/nguyenngochoa/Git/gg-hackathon/research.md)
- [data-model.md](/Users/nguyenngochoa/Git/gg-hackathon/data-model.md)
- [contracts/api-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/api-contract.md)
- [contracts/ui-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/ui-contract.md)
- [quickstart.md](/Users/nguyenngochoa/Git/gg-hackathon/quickstart.md)

## Phase 1: Setup

Purpose:

- establish the LLM gateway scaffolding and shared constants needed by every later phase

- [x] T001 Create shared LLM control-tower constants and rollout mode enums in `lib/server/control-tower/constants.js`
- [x] T002 [P] Create the provider registry scaffold in `lib/server/agent/provider-registry.js`
- [x] T003 [P] Create the OpenAI provider adapter scaffold in `lib/server/agent/providers/openai.js`
- [x] T004 [P] Create the Gemini provider adapter scaffold in `lib/server/agent/providers/gemini.js`
- [x] T005 [P] Create the mock provider adapter scaffold in `lib/server/agent/providers/mock.js`

## Phase 2: Foundational

Purpose:

- add blocking persistence, orchestration, auth, and realtime infrastructure that every user story depends on

- [x] T006 Extend Postgres bootstrap with prompt templates, model runs, input artifacts, and output artifacts in `lib/server/prototype-store.js`
- [x] T007 Add repository helpers for prompt templates, model runs, model artifacts, proposals, guardrails, approvals, and execution tasks in `lib/server/prototype-store.js`
- [x] T008 Extend role and permission handling for proposal review and route-specific dispatch in `lib/server/auth.js`
- [x] T009 Add model-run lifecycle event helpers in `lib/server/events.js`
- [x] T010 Add SSE support for model-run and control-tower event types in `app/api/events/route.js`
- [x] T011 Add runtime selection and legacy fallback helpers for `shadow`, `assisted`, and `live` modes in `lib/server/prototype-store.js`
- [x] T012 Add provider-aware model client resolution and failure handling in `lib/server/agent/client.js`

## Phase 3: User Story 1 - Control-Tower Monitoring

Story goal:

- let operations users inspect one aggregated snapshot with source freshness and latest model-run state before proposals are reviewed

Independent test criteria:

- a user can run aggregation, inspect the persisted snapshot, and see source freshness plus latest model-run status in the UI without requiring direct database inspection

- [x] T013 [US1] Implement source observation normalization for external and internal feeds in `lib/server/aggregation/load-signal-observations.js`
- [x] T014 [US1] Implement aggregated snapshot assembly and source-health scoring in `lib/server/aggregation/build-aggregated-snapshot.js`
- [x] T015 [US1] Add the aggregation run endpoint in `app/api/aggregation/run/route.js`
- [x] T016 [P] [US1] Add the aggregation run detail endpoint in `app/api/aggregation/runs/[id]/route.js`
- [x] T017 [US1] Add the model run detail endpoint in `app/api/agent/runs/[id]/route.js`
- [x] T018 [US1] Update the store summary endpoint with control-tower and LLM rollout status counts in `app/api/stores/route.js`
- [x] T019 [P] [US1] Add the store control-tower detail endpoint with source freshness and latest model-run summary in `app/api/stores/[storeId]/control-tower/route.js`
- [x] T020 [US1] Add the control-tower monitoring view with source freshness, runtime mode, and latest model-run status in `components/ControlTowerConsole.jsx`
- [x] T021 [US1] Add control-tower runtime selection and store detail hydration in `components/PrototypeApp.jsx`

Parallel execution example:

- after T015 lands, T016 and T019 can run in parallel

## Phase 4: User Story 2 - Safe Automated Markdown

Story goal:

- invoke a real provider-backed model run, parse structured markdown proposals, evaluate them through guardrails, and auto-route eligible markdowns to the virtual label path

Independent test criteria:

- in `shadow` or `live` mode, a low-risk markdown scenario produces a provider-backed model run, validates structured proposals, receives an approved guardrail result, and dispatches to the virtual label path without manual approval

- [x] T022 [P] [US2] Implement prompt template loading and prompt building for markdown proposals in `lib/server/agent/prompt-builder.js`
- [x] T023 [P] [US2] Implement strict ActionProposal schemas for provider outputs in `lib/server/agent/schemas.js`
- [x] T024 [US2] Implement provider gateway resolution in `lib/server/agent/provider-registry.js`
- [x] T025 [US2] Implement the OpenAI provider adapter with usage capture and normalized structured output in `lib/server/agent/providers/openai.js`
- [x] T026 [P] [US2] Implement the mock provider adapter fallback for local development in `lib/server/agent/providers/mock.js`
- [x] T027 [US2] Implement response parsing and schema validation in `lib/server/agent/response-parser.js`
- [x] T028 [US2] Implement model-run orchestration with input and output artifact persistence in `lib/server/agent/orchestrator.js`
- [x] T029 [US2] Extend the agent run creation endpoint to invoke provider-backed model runs in `shadow` or `live` mode in `app/api/agent/runs/route.js`
- [x] T030 [US2] Implement low-risk markdown guardrail evaluation for provider proposals in `lib/server/rules/evaluate-proposal.js`
- [x] T031 [US2] Implement the virtual label execution task builder for approved markdown proposals in `lib/server/execution/label-executor.js`
- [x] T032 [US2] Add the proposal listing endpoint with model metadata and guardrail outcomes in `app/api/proposals/route.js`
- [x] T033 [US2] Update the proposal queue and virtual e-ink wall for provider-backed low-risk markdowns in `components/ControlTowerConsole.jsx`
- [x] T034 [P] [US2] Persist audit records for aggregation, model runs, parse status, and proposal creation in `lib/server/prototype-store.js`
- [x] T035 [US2] Persist audit records for provider timeout, rate-limit, and adapter failure states in `lib/server/agent/orchestrator.js`
- [x] T036 [US2] Persist audit records for label dispatch attempts and outcomes in `lib/server/execution/label-executor.js`

Parallel execution example:

- T022 and T023 can run in parallel before T027 integrates them

## Phase 5: Model Observability and Policy

Purpose:

- make shadow-mode proposals and failure states operator-visible before broader route expansion

Independent test criteria:

- operators can inspect model-run details, audit and policy history, and source provenance without direct database access

- [x] T037 Add the model run detail view for provider, mode, prompt version, usage, parse status, retry count, timeout status, and rate-limit state in `components/ControlTowerConsole.jsx`
- [x] T038 [P] Update audit output for model failures, guardrail outcomes, and execution events in `app/api/audit/route.js`
- [x] T039 Add the audit and policy history view for aggregation, model runs, parse failures, matched rules, approvals, and execution outcomes in `components/ControlTowerConsole.jsx`
- [x] T040 [P] Add source provenance and simulation-state fields to the store control-tower payload in `app/api/stores/[storeId]/control-tower/route.js`
- [x] T041 Add source provenance and simulated or live badges for feeds and executors in `components/ControlTowerConsole.jsx`

Parallel execution example:

- T038 and T040 can run in parallel once the model-run and control-tower payload contracts are stable

## Phase 6: User Story 3 - Human Review For High-Risk Actions

Story goal:

- route markdown proposals above the threshold into a human approval workflow before any execution occurs

Independent test criteria:

- a high-risk markdown scenario creates a pending approval request, cannot dispatch before review, and records approval or rejection outcomes visibly

- [x] T042 [US3] Implement approval request creation for high-risk model proposals in `lib/server/rules/create-approval-request.js`
- [x] T043 [US3] Extend guardrail evaluation to route above-threshold markdowns into approval state in `lib/server/rules/evaluate-proposal.js`
- [x] T044 [US3] Add the approval endpoint for high-risk proposals in `app/api/proposals/[id]/approve/route.js`
- [x] T045 [P] [US3] Add the rejection endpoint for high-risk proposals in `app/api/proposals/[id]/reject/route.js`
- [x] T046 [US3] Implement approval-to-dispatch handoff for reviewed markdown proposals in `lib/server/execution/approval-dispatch.js`
- [x] T047 [US3] Extend proposal review persistence and audit history for approval outcomes in `lib/server/prototype-store.js`
- [x] T048 [US3] Update the human approval console with provider rationale, matched rules, and review notes in `components/ControlTowerConsole.jsx`
- [x] T049 [US3] Enforce approval permissions for proposal review in `app/api/proposals/[id]/approve/route.js`
- [x] T050 [P] [US3] Enforce rejection permissions for proposal review in `app/api/proposals/[id]/reject/route.js`

Parallel execution example:

- T044 and T045 can run in parallel after T043 defines the approval state contract

## Phase 7: User Story 4 - Unsaleable Inventory Routing

Story goal:

- turn unsaleable inventory conditions into route-specific logistics tasks with explicit disposition state

Independent test criteria:

- an unsaleable scenario creates a logistics task from a model-backed proposal and the workbench shows route type, destination, status, and simulation state

- [x] T051 [US4] Extend prompt building to include unsaleable inventory context in `lib/server/agent/prompt-builder.js`
- [x] T052 [US4] Extend proposal validation for logistics disposition fields in `lib/server/agent/validate-proposals.js`
- [x] T053 [US4] Implement logistics eligibility rules and disposition mapping in `lib/server/rules/evaluate-proposal.js`
- [x] T054 [US4] Implement the simulated logistics executor for unsaleable tasks in `lib/server/execution/logistics-executor.js`
- [x] T055 [US4] Persist audit records for logistics task creation and executor outcomes in `lib/server/execution/logistics-executor.js`
- [x] T056 [US4] Add the logistics task listing endpoint in `app/api/logistics/tasks/route.js`
- [x] T057 [US4] Update the logistics workbench for unsaleable inventory tasks in `components/ControlTowerConsole.jsx`
- [x] T058 [US4] Enforce logistics workbench access rules in `app/api/logistics/tasks/route.js`

Parallel execution example:

- T056 and T058 can run in parallel after T055 defines the logistics task contract

## Phase 8: User Story 5 - Stockout Prevention

Story goal:

- convert stockout-risk conditions into bounded procurement tasks with supplier and quantity context

Independent test criteria:

- a stockout-risk scenario creates a procurement task from a model-backed proposal and the procurement console shows supplier, quantity, cost, status, and simulation state

- [x] T059 [US5] Extend prompt building to include stockout-risk procurement context in `lib/server/agent/prompt-builder.js`
- [x] T060 [US5] Extend proposal validation for supplier and quantity fields in `lib/server/agent/validate-proposals.js`
- [x] T061 [US5] Implement procurement spend-cap and supplier eligibility rules in `lib/server/rules/evaluate-proposal.js`
- [x] T062 [US5] Implement the simulated procurement executor in `lib/server/execution/procurement-executor.js`
- [x] T063 [US5] Persist audit records for procurement task creation and executor outcomes in `lib/server/execution/procurement-executor.js`
- [x] T064 [US5] Add the procurement order listing endpoint in `app/api/procurement/orders/route.js`
- [x] T065 [US5] Update the procurement console for stockout-risk tasks in `components/ControlTowerConsole.jsx`
- [x] T066 [US5] Enforce procurement console access rules in `app/api/procurement/orders/route.js`

Parallel execution example:

- T064 and T066 can run in parallel after T063 defines the procurement task contract

## Phase 9: Production Hardening and Documentation

Purpose:

- align retry behavior, replayability, metrics, and rollout guidance with the completed LLM-integrated control-tower path

- [x] T067 Implement provider retry and timeout policy with bounded backoff in `lib/server/agent/client.js`
- [x] T068 Extend the model run detail endpoint with retry, timeout, and rate-limit metadata in `app/api/agent/runs/[id]/route.js`
- [x] T069 Add seeded replay and evaluation fixtures for model-run regression scenarios in `lib/server/agent/__fixtures__/`
- [x] T070 [P] Update metrics output for model-run counts, route counts, and estimated provider cost in `app/api/metrics/route.js`
- [x] T071 Update the quickstart for provider env vars, shadow mode, and replay scenarios in `quickstart.md`
- [x] T072 [P] Update the system reference and API docs for the LLM gateway architecture in `docs/system-reference.md`
- [x] T073 [P] Update rollout criteria for moving stores from `shadow` to `assisted` or `live` in `docs/developer-runbook.md`

## Dependencies

- Phase 1 must complete before Phase 2.
- Phase 2 must complete before any user story phase.
- US1 must complete before US2 because provider-backed model runs depend on aggregated snapshots and runtime monitoring surfaces.
- US2 must complete before Phase 5 because shadow-mode observability depends on real model-run artifacts and proposal outcomes.
- Phase 5 must complete before US3, US4, and US5 so approval, logistics, and procurement routes inherit operator-visible audit, provenance, and failure surfaces.
- US3, US4, and US5 may proceed in parallel after Phase 5 if the shared proposal and rule contracts are stable.
- Production hardening and documentation should start only after the targeted runtime paths are implemented.

## Phase Completion Order

1. US1 Control-Tower Monitoring
2. US2 Safe Automated Markdown
3. Phase 5 Model Observability and Policy
4. US3 Human Review For High-Risk Actions
5. US4 Unsaleable Inventory Routing
6. US5 Stockout Prevention
7. Phase 9 Production Hardening and Documentation

## Parallel Opportunities

- Setup: T002, T003, T004, and T005 can run in parallel after T001.
- US1: T016 and T019 can run in parallel after T015.
- US2: T022 and T023 can run in parallel before T027, and T025 and T026 can run in parallel after T024.
- Phase 5: T038 and T040 can run in parallel once model-run and control-tower payload shapes are stable.
- US3: T044 and T045 can run in parallel after T043.
- US4: T056 and T058 can run in parallel after T055.
- US5: T064 and T066 can run in parallel after T063.
- Phase 9: T070, T072, and T073 can run in parallel once the runtime shape is stable.

## Implementation Strategy

### MVP First

- complete through Phase 5 first to prove one real provider-backed model run with operator-visible audit and provenance end to end
- keep the first rollout in `shadow` mode until proposal quality, audit coverage, and failure visibility are trustworthy
- treat US3 as the minimum governance extension for a credible high-risk path
- keep US4 and US5 simulated-first so model integration stays technically honest without requiring live enterprise connectors

### Incremental Delivery

- preserve the legacy markdown flow while the model-backed path is introduced
- add provider invocation and structured parsing before broadening execution scope
- land operator-visible observability before broader route expansion
- move stores from `disabled` to `shadow` before `assisted` or `live`
- cut over only after model observability, audit coverage, retry behavior, and rollback guidance are in place
