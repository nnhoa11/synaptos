# SynaptOS Research

## Context

This research resolves planning questions for the SynaptOS prototype using the only evidence available in the workspace:

- `GDGoC_SynaptOS_Pitch_Deck (1).pdf`
- `GDGoC_SynaptOS_Business_Proposal_01.pdf`

BuildBetter evidence artifacts were not present, so evidence linkage below references source-PDF sections instead.

## Decision 1: Use a deterministic pricing engine for v1

- Decision: Build the first prototype around a deterministic spoilage-risk and markdown scoring engine, with any LLM usage limited to optional explanation or structured tool-call generation.
- Rationale: The source documents explicitly emphasize anti-hallucination guardrails, deterministic behavior, and enterprise safety. A rule-based core is more credible for a hackathon prototype and easier to test.
- Alternatives considered:
  - Fully autonomous LLM decision-making
  - Rule engine plus mandatory LLM reasoning layer
- Evidence linkage:
  - `BP-3.3`: anti-hallucination guardrails, temperature `0.0`, strict function-calling
  - `PD-6`: anti-hallucination guardrails presented as a core capability

## Decision 2: Prototype the POS layer with seeded imports instead of partner integrations

- Decision: Simulate POS data using seeded CSV/JSON imports and an internal inventory ledger.
- Rationale: The PDFs frame the long-term strategy as a POS overlay and plugin model, but a prototype cannot credibly ship vendor integrations in the same timeframe. Seeded imports still prove the product loop.
- Alternatives considered:
  - Real vendor integration
  - Manual-only input screens with no import path
- Evidence linkage:
  - `BP-3.5`: ledger and calibration loop
  - `PD-12`: POS plugin model and no rip-and-replace positioning
  - `PD-15`: early roadmap focuses on virtual protocol and agentic loop before broader scale

## Decision 3: Treat virtual shelf labels as the execution proof

- Decision: Make the "virtual E-ink" shelf label wall the main execution surface in the demo.
- Rationale: It creates a visible actuation moment without requiring hardware. It is the clearest way to show that the system does more than analytics.
- Alternatives considered:
  - Dashboard-only recommendations
  - Physical E-ink integration
- Evidence linkage:
  - `PD-5`: architecture ends with action
  - `PD-10`: virtual E-ink display protocol
  - `BP-20`: WebSocket-based software shelf-name MVP called out in Phase 1

## Decision 4: Keep procurement and logistics out of the prototype scope

- Decision: Document procurement and end-of-life routing as roadmap items only.
- Rationale: They are real differentiators in the source materials, but they expand scope well beyond a credible MVP. The pricing loop alone already demonstrates the commercial thesis.
- Alternatives considered:
  - Mock PO generation UI
  - Simplified inter-store transfer logic
- Evidence linkage:
  - `BP-10` and `BP-11`: procurement and end-of-life routing described as extensions of the operating model
  - `PD-7` and `PD-8`: procurement and EOL routing treated as advanced capabilities
  - `PD-15`: Foundation phase prioritizes agentic loop v1 and virtual protocol first

## Decision 5: Model three store archetypes only

- Decision: Use premium urban, transit, and residential stores in the prototype dataset.
- Rationale: The documents repeatedly use these store contexts to explain the core pricing thesis. They are sufficient to demonstrate differentiated strategy without overcomplicating the model.
- Alternatives considered:
  - Single-store demo
  - Large synthetic portfolio of stores
- Evidence linkage:
  - `BP-8` to `BP-12`: demographic and temporal pricing logic by zone
  - `PD-10`: geo-demographic pricing called out as a core capability

## Decision 6: Make manager approval a first-class workflow

- Decision: Add a manager approval queue for recommendations above a configurable threshold, with default review required beyond 50% discount.
- Rationale: This directly supports the governance story and prevents the prototype from implying unsafe autonomous pricing.
- Alternatives considered:
  - Fully automatic all-discount execution
  - Manual-only approvals for every decision
- Evidence linkage:
  - `BP-13`: store manager approval role and 50% safety threshold
  - `PD-10`: human-in-loop governance listed as a capability

## Decision 7: Use a single-stack web app

- Decision: Implement the prototype as a single web application with `Next.js`, `TypeScript`, `Tailwind CSS`, `Prisma`, and `SQLite`.
- Rationale: The workspace has no existing codebase, so the primary optimization is delivery speed. A single stack reduces handoff cost and supports demo-friendly UI plus internal API routes.
- Alternatives considered:
  - Split frontend and backend services
  - Python backend plus separate frontend
- Evidence linkage:
  - No direct PDF requirement; this is a delivery decision based on hackathon constraints and the need for a fast end-to-end prototype

## Decision 8: Use auditability as a core success criterion

- Decision: Every recommendation and execution action must be logged with status, actor, and rationale.
- Rationale: The business proposal repeatedly positions SynaptOS as audit-ready, especially in the context of waste reporting and enterprise trust.
- Alternatives considered:
  - Basic event logs only
  - No audit layer in the prototype
- Evidence linkage:
  - `BP-4`: regulatory support and food waste tracking demand
  - `BP-13`: RBAC and enterprise security hierarchy
  - `PD-8` and `PD-15`: ESG and compliance framing
