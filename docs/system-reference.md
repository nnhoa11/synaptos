# System Reference

## Overview

SynaptOS is a fresh-food retail markdown operations prototype. The current codebase implements a durable `v2` app that:

- imports a baseline CSV into a local operational store
- derives lot-level inventory state
- computes deterministic markdown recommendations
- requires manager/admin approval for guarded discounts
- persists approvals, labels, calibration, runs, imports, and audit events
- streams live updates to the UI over Server-Sent Events

This is not a full retail operating system. Procurement, routing, external POS writeback, and enterprise integrations are still out of scope.

## Runtime Shape

The runtime is a modular monolith:

- UI: `Next.js` page + React client app
- API: Next route handlers under `app/api`
- Decision engine: deterministic scoring in [lib/prototype-core.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/prototype-core.js)
- Durable store: PostgreSQL-backed server state in [lib/server/prototype-store.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/prototype-store.js)
- Auth/RBAC: cookie-backed helpers in [lib/server/auth.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/auth.js)
- Eventing: in-process event bus in [lib/server/events.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/events.js)

## Main Modules

### UI

Primary files:

- [app/page.jsx](/Users/nguyenngochoa/Git/gg-hackathon/app/page.jsx)
- [components/PrototypeApp.jsx](/Users/nguyenngochoa/Git/gg-hackathon/components/PrototypeApp.jsx)

Responsibilities:

- render the dashboard tabs
- fetch session, stores, snapshots, and current run state
- trigger recommendation runs
- approve or reject recommendations
- submit calibration events
- display labels, metrics, and audit history
- subscribe to SSE events and refresh visible state

### Decision Engine

Primary file:

- [lib/prototype-core.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/prototype-core.js)

Responsibilities:

- parse and normalize CSV rows
- build stores and snapshots
- derive lot-level inventory state
- apply confidence penalties based on calibration
- compute risk scores and markdown levels
- derive recommendation status and metrics

Important properties:

- deterministic only
- no free-text AI reasoning
- approval thresholds are store-specific
- weather, traffic, stock pressure, and expiry drive scoring

### Durable Store

Primary file:

- [lib/server/prototype-store.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/prototype-store.js)

Responsibilities:

- bootstrap and maintain PostgreSQL schema
- import the baseline CSV into tables
- seed users and stores
- compute current payloads for a snapshot
- persist recommendation runs and recommendation rows
- persist decisions, labels, calibration, audit, and imports
- publish events to the SSE bus

### Auth and RBAC

Primary file:

- [lib/server/auth.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/auth.js)

Responsibilities:

- set and clear the `synaptos_session` cookie
- resolve session user
- enforce store access, approval permissions, and admin-only actions

### Eventing

Primary file:

- [lib/server/events.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/events.js)

Responsibilities:

- publish in-process events
- let SSE subscribers receive live updates

## Data Flow

### 1. Import

Source:

- [SynaptOS_Data - SynaptOS_Baseline_Final_v4.csv](/Users/nguyenngochoa/Git/gg-hackathon/SynaptOS_Data%20-%20SynaptOS_Baseline_Final_v4.csv)

Flow:

1. CSV is read and normalized.
2. Store records are derived.
3. Snapshot keys are derived.
4. Inventory rows are persisted.
5. Default users are seeded.
6. Audit and import-batch records are written.

### 2. Recommendation Run

Flow:

1. Client requests `POST /api/recommendations/run`.
2. Server loads persisted rows, stores, labels, approvals, and calibrations.
3. `runPrototype` computes the current recommendation set.
4. Run and recommendation rows are persisted.
5. Label rows are upserted.
6. Audit events are created.
7. SSE events are emitted.
8. Client refreshes UI state.

### 3. Approval

Flow:

1. Manager/admin submits approve or reject.
2. Decision is persisted in `approval_decisions`.
3. Audit event is created.
4. Snapshot is recomputed and persisted again.
5. Price and label events are emitted.

### 4. Calibration

Flow:

1. Manager/admin submits shrinkage/spoilage correction.
2. Calibration entry is persisted.
3. Audit event is created.
4. Snapshot is recomputed.
5. Confidence score and downstream recommendations change.

## RBAC Model

Roles:

- `admin`
- `manager`
- `staff`

Capabilities:

- `admin`: full access across stores, import access, approval access
- `manager`: store-scoped access, approval access, calibration access
- `staff`: read-only, no approval or calibration actions

Session behavior:

- sessions are cookie-based
- the UI role selector logs into a seeded local user
- the selected role changes what routes can do and which stores are visible

## Persistence Model

Current runtime store:

- `postgresql://synaptos:synaptos@localhost:5432/synaptos_v2`

Core tables:

- `stores`
- `inventory_rows`
- `snapshots`
- `users`
- `recommendation_runs`
- `recommendations`
- `approval_decisions`
- `shelf_labels`
- `calibrations`
- `audit_events`
- `import_batches`

Design note:

- the app now uses Postgres for runtime persistence
- the bundled Docker Compose service provides the default local database

## SSE Event Model

Transport:

- `GET /api/events`

Current event types emitted by the server include:

- `session.ready`
- `run.completed`
- `recommendation.updated`
- `label.updated`
- `price.updated`
- `calibration.recorded`
- `import.completed`
- `import.failed`

The client currently listens and refreshes state when important events arrive rather than applying event payloads as authoritative incremental patches.

## Recommendation Lifecycle

Possible statuses:

- `hold`
- `auto_applied`
- `pending_review`
- `approved`
- `rejected`

Lifecycle rules:

- low-risk markdowns can become `auto_applied`
- guarded discounts become `pending_review`
- manager/admin can transition to `approved` or `rejected`
- approvals can override the suggested discount percentage

## Local Postgres

The repo includes a Docker-based Postgres setup in:

- [docker-compose.postgres.yml](/Users/nguyenngochoa/Git/gg-hackathon/docker-compose.postgres.yml)
- [.env.postgres.example](/Users/nguyenngochoa/Git/gg-hackathon/.env.postgres.example)

Important:

- start Postgres before running the app locally
- `DATABASE_URL` overrides the bundled default connection if you want a different database

## Current Limits

Not implemented:

- real partner POS adapters
- supplier purchasing
- inter-store routing
- physical label hardware integration
- external identity provider integration
- background worker separation
- external production database integration
