# SynaptOS LLM Integration Research

## Context

This research replans the control-tower architecture so SynaptOS can integrate with real LLM providers instead of keeping the agent layer as a local stub.

BuildBetter evidence artifacts were not present in this workspace, so evidence linkage references:

- the user-requested target architecture
- the current repository runtime
- the existing control-tower spec in [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md)

## Decision 1: Keep the LLM behind a provider gateway

- Decision: Implement a provider gateway inside `lib/server/agent/providers/*` with a single orchestration interface that can call `OpenAI`, `Gemini`, or another approved provider.
- Rationale: The repo needs real model integration, but the rest of the system should not know vendor-specific request formats, auth headers, retry behavior, or response shapes.
- Alternatives considered:
  - call one provider directly from route handlers
  - hard-code one provider across the full codebase
- Evidence linkage:
  - user request: "the big architecture we actually integrate with llms"
  - current repo already centralizes orchestration inside the monolith, so a provider boundary fits the existing shape

## Decision 2: The LLM remains a proposal engine, not an execution authority

- Decision: The model may produce structured `ActionProposal` objects, but deterministic rules remain the only authority that can mark work executable.
- Rationale: This preserves the safety properties already required by the spec while allowing the system to benefit from model reasoning and summarization.
- Alternatives considered:
  - let the model decide auto-dispatch directly
  - embed all business rules into prompts instead of code
- Evidence linkage:
  - [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md): `FR-4 Guardrail Enforcement` and `NFR-1 Deterministic Safety`
  - existing architecture already treats rules and execution as separate boundaries

## Decision 3: Use strict structured output contracts

- Decision: Every provider response must parse into a strict schema before proposal persistence.
- Rationale: Without strict schema validation, model integration becomes an unbounded text-generation problem that is hard to audit, test, or recover from.
- Alternatives considered:
  - accept markdown or free-text recommendations
  - parse loosely and rely on downstream business logic to catch shape errors
- Evidence linkage:
  - [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md): `FR-3 Structured Proposal Generation`
  - current codebase is already typed around route-specific objects rather than free-form text

## Decision 4: Persist full model-run artifacts

- Decision: Persist model runs, model inputs, model outputs, prompt versions, parse failures, and usage metadata as first-class records.
- Rationale: Real LLM integration requires replayability, cost tracking, auditability, and incident analysis. Storing only the final proposal is not enough.
- Alternatives considered:
  - log provider output only to console or transient logs
  - keep only the final validated proposal rows
- Evidence linkage:
  - [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md): `FR-9 Stage-Level Auditability` and `NFR-2 Auditability`
  - operator-facing audit and policy views already exist in the plan and should include model stages

## Decision 5: Add shadow mode before live routing

- Decision: Introduce `shadow`, `assisted`, and `live` model-run modes, with `shadow` as the first real-provider rollout mode.
- Rationale: Shadow mode lets SynaptOS compare model proposals against deterministic outcomes and human expectations before any model-backed proposal can affect execution.
- Alternatives considered:
  - switch directly from stubbed proposals to live auto-routing
  - keep the model disconnected from the real UI and audit path
- Evidence linkage:
  - [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md): `FR-12 Incremental Adoption` and `NFR-5 Incremental Delivery`
  - the repo already supports additive rollout between legacy and control-tower paths

## Decision 6: Build prompts from aggregated snapshots, not raw tables

- Decision: Prompts should be built from a compacted `AggregatedSnapshot` plus explicit policy hints, not from raw CSV rows or unconstrained database dumps.
- Rationale: Prompt size, consistency, auditability, and replayability all improve when the model sees one normalized state bundle per run.
- Alternatives considered:
  - prompt from raw inventory and POS rows
  - let each provider adapter build its own prompt ad hoc
- Evidence linkage:
  - [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md): `FR-1 Aggregated Snapshot`
  - current architecture already centers the aggregator before the agent

## Decision 7: Keep execution simulated-first even with real LLMs

- Decision: Provider-backed model runs can become real, while logistics, procurement, and external signal connectors remain explicitly simulated in the first rollout.
- Rationale: The hard problem being validated now is the decision architecture, not enterprise connector completeness. Live execution integrations can follow once model quality and governance are stable.
- Alternatives considered:
  - require live downstream connectors before real model calls
  - block real LLM integration until every execution system is real
- Evidence linkage:
  - [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md): `NFR-4 Technical Honesty`
  - current repo and docs already frame logistics and procurement as simulated-first

## Decision 8: Add provider health, retry, and cost accounting

- Decision: The provider layer must capture latency, retry count, rate-limit failures, token or usage metadata, and estimated cost per run.
- Rationale: Once the architecture depends on external LLM APIs, cost and reliability become product behavior, not just infra details.
- Alternatives considered:
  - treat provider calls as fire-and-forget
  - omit usage and cost records until later
- Evidence linkage:
  - the user explicitly asked for an architecture that actually integrates with LLMs
  - real-provider integration introduces failure classes the current local stub does not have

## Decision 9: Preserve a fallback deterministic path

- Decision: If provider invocation fails, the system must be able to mark the model run failed, surface that failure in the UI, and continue operating via legacy deterministic flows.
- Rationale: The control tower cannot become unavailable just because a model provider is slow, unavailable, or rate-limited.
- Alternatives considered:
  - block all decision generation when the model is unavailable
  - silently swallow model failures and present partial state
- Evidence linkage:
  - [spec.md](/Users/nguyenngochoa/Git/gg-hackathon/spec.md): staged rollout and operational clarity requirements
  - the repo already supports additive dual-path runtime behavior

## Resolved Clarifications

- Real provider integration should be added inside the current monolith, not via an immediate service split.
- Provider support should be adapter-based and swappable.
- Prompt building, schema validation, and provider invocation are distinct sub-boundaries inside the agent layer.
- Model-run persistence must be deeper than the current `AgentRun` abstraction.
- Shadow mode is the correct first release mode for real LLMs.
