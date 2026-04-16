# System Reference

## Overview

SynaptOS is a modular-monolith retail operations prototype with two runtime paths:

- a legacy deterministic markdown workflow
- a control-tower workflow that aggregates signals, invokes a provider-backed model layer, parses structured proposals, applies deterministic guardrails, and creates typed execution tasks

The current implementation is still demo-oriented. Logistics, procurement, and external feeds are visible and persisted, but downstream enterprise connectors remain simulated-first.

## Runtime Shape

- UI: `Next.js` App Router + React client
- API: route handlers under `app/api`
- Deterministic inventory logic: `lib/prototype-core.js`
- Aggregation: `lib/server/aggregation/*`
- Agent layer: `lib/server/agent/*`
- Deterministic rules: `lib/server/rules/*`
- Execution: `lib/server/execution/*`
- Persistence: `lib/server/prototype-store.js`
- Auth/RBAC: `lib/server/auth.js`
- Eventing: `lib/server/events.js`

## Main Modules

### Prototype UI

Primary files:

- `app/page.jsx`
- `components/PrototypeApp.jsx`
- `components/ControlTowerConsole.jsx`

Responsibilities:

- render legacy and control-tower runtimes
- fetch session, stores, snapshots, metrics, audit, and control-tower detail
- trigger aggregation and model-backed proposal runs
- review approvals and dispatch execution tasks
- display model-run detail, audit history, and simulation badges

### Deterministic Core

Primary file:

- `lib/prototype-core.js`

Responsibilities:

- parse and normalize CSV rows
- derive lot-level inventory state
- compute deterministic markdown recommendations and metrics

Important properties:

- remains deterministic
- continues to power the legacy fallback path
- provides candidate context for control-tower aggregation

### Control-Tower Agent Layer

Primary files:

- `lib/server/agent/client.js`
- `lib/server/agent/orchestrator.js`
- `lib/server/agent/prompt-builder.js`
- `lib/server/agent/response-parser.js`
- `lib/server/agent/provider-registry.js`
- `lib/server/agent/providers/openai.js`
- `lib/server/agent/providers/gemini.js`
- `lib/server/agent/providers/mock.js`

Responsibilities:

- build prompt context from `AggregatedSnapshot`
- resolve provider adapters
- apply retry and timeout policy
- parse structured output into proposal candidates
- persist model input and output artifacts

### Durable Store

Primary file:

- `lib/server/prototype-store.js`

Responsibilities:

- bootstrap and maintain PostgreSQL schema
- persist aggregation, model runs, proposals, guardrails, approvals, execution tasks, and audit events
- preserve last successful store state when a later model run fails
- publish realtime events to the SSE bus

## Data Flow

### 1. Import

1. Baseline CSV is read and normalized.
2. Store records and snapshot keys are derived.
3. Inventory rows are persisted.
4. Seed users are created.
5. Import and audit records are written.

### 2. Aggregation Run

1. Client requests `POST /api/aggregation/run`.
2. Server builds `SignalObservation` records from external and internal signal types.
3. One `AggregatedSnapshot` is persisted per store.
4. Audit and SSE events are emitted.

### 3. Model Run

1. Client requests `POST /api/agent/runs`.
2. Server loads latest aggregated snapshots.
3. Prompt context is built per store.
4. Provider adapters invoke `OpenAI`, `Gemini`, or `mock`.
5. `ModelRun`, input artifact, and output artifact records are persisted.
6. Parsed proposals continue to deterministic rules.

### 4. Guardrails and Routing

1. Every proposal is evaluated by `lib/server/rules/evaluate-proposal.js`.
2. Low-risk markdowns route to labels.
3. High-risk markdowns create approval requests.
4. Unsaleable and stockout-risk proposals create logistics or procurement execution tasks.
5. Audit events are written for model, guardrail, approval, and execution stages.

## RBAC Model

Roles:

- `admin`
- `manager`
- `staff`
- `procurement_planner`
- `logistics_coordinator`

Capabilities:

- `admin`: full access across stores and routes
- `manager`: store-scoped approval and label dispatch
- `staff`: read-only
- `procurement_planner`: procurement console access
- `logistics_coordinator`: logistics workbench access

## Persistence Model

Default local runtime store:

- `postgresql://synaptos:synaptos@localhost:5432/synaptos_v2`

Core tables:

- `stores`
- `inventory_rows`
- `snapshots`
- `users`
- `signal_observations`
- `aggregation_runs`
- `aggregated_snapshots`
- `prompt_templates`
- `agent_runs`
- `model_runs`
- `model_input_artifacts`
- `model_output_artifacts`
- `action_proposals`
- `guardrail_evaluations`
- `approval_requests`
- `execution_tasks`
- `logistics_routes`
- `procurement_orders`
- `recommendation_runs`
- `recommendations`
- `approval_decisions`
- `shelf_labels`
- `calibrations`
- `audit_events`
- `import_batches`

## SSE Event Model

Transport:

- `GET /api/events`

Important event types:

- `session.ready`
- `aggregation.completed`
- `agent.completed`
- `model_run.updated`
- `proposal.updated`
- `approval.updated`
- `execution.updated`
- `logistics.updated`
- `procurement.updated`
- `recommendation.updated`
- `label.updated`
- `price.updated`
- `calibration.recorded`
- `import.completed`

The client treats SSE as an invalidation stream and refetches authoritative state from HTTP routes.

## Control-Tower Visibility Model

The UI separates:

- source freshness and provenance
- latest model-run state
- proposal queue
- approval queue
- logistics workbench
- procurement console
- audit and policy history

Failed model runs do not imply successful execution. Deterministic guardrails remain the only execution authority.

## Current Limits

Not implemented:

- live POS adapters
- live supplier purchasing
- live inter-store routing
- physical label hardware integration
- enterprise identity provider integration
- background worker separation
