# SynaptOS Prototype

SynaptOS is a `v2` prototype for fresh-food retail markdown operations. It uses a baseline CSV dataset to seed a durable local store and simulate:

- perishable inventory risk
- deterministic markdown recommendations
- manager approval for high-risk actions
- virtual shelf-label price propagation
- audit and calibration workflows
- cookie-backed RBAC sessions
- realtime SSE operator updates

This repository contains a runnable `Next.js` App Router prototype with a PostgreSQL-backed persistence layer, not a production system.

## Local Postgres With Docker

The app now expects a local Postgres instance by default. The repo includes
[docker-compose.postgres.yml](/Users/nguyenngochoa/Git/gg-hackathon/docker-compose.postgres.yml).

Start it with:

```bash
npm run db:up
```

Stop it with:

```bash
npm run db:down
```

Tail logs with:

```bash
npm run db:logs
```

Default connection settings:

```text
host=localhost
port=5432
database=synaptos_v2
user=synaptos
password=synaptos
```

Example environment values are in
[.env.postgres.example](/Users/nguyenngochoa/Git/gg-hackathon/.env.postgres.example).

## What It Does

The app demonstrates the core SynaptOS loop:

1. load baseline inventory and context from the CSV
2. derive lot-level inventory state
3. score spoilage and sell-through risk
4. recommend markdown actions
5. allow manager approval or rejection for risky discounts
6. persist approvals, labels, audit, and calibration events
7. update active prices in a shelf-label view
8. stream operator updates over SSE

## Current Stack

- `Next.js` App Router
- `React`
- CSS in [app/globals.css](/Users/nguyenngochoa/Git/gg-hackathon/app/globals.css)
- baseline CSV import into PostgreSQL via `pg`
- cookie-backed RBAC sessions
- server-side persistence for approvals, labels, calibration, runs, audit, and imports
- SSE transport for live operator updates

## Project Structure

- [app/page.jsx](/Users/nguyenngochoa/Git/gg-hackathon/app/page.jsx): main page entry
- [components/PrototypeApp.jsx](/Users/nguyenngochoa/Git/gg-hackathon/components/PrototypeApp.jsx): interactive dashboard UI
- [lib/prototype-data.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/prototype-data.js): CSV loading and metadata extraction
- [lib/prototype-core.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/prototype-core.js): row normalization, lot derivation, recommendation engine, metrics
- [lib/server/prototype-store.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/prototype-store.js): durable server store, imports, runs, approvals, labels, calibration, audit
- [lib/server/auth.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/auth.js): session and RBAC helpers
- [lib/server/events.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/server/events.js): SSE event bus
- [app/api/stores/route.js](/Users/nguyenngochoa/Git/gg-hackathon/app/api/stores/route.js): returns store metadata
- [app/api/snapshots/route.js](/Users/nguyenngochoa/Git/gg-hackathon/app/api/snapshots/route.js): returns available timeline snapshots
- [app/api/recommendations/run/route.js](/Users/nguyenngochoa/Git/gg-hackathon/app/api/recommendations/run/route.js): persists and returns a recommendation run for a selected snapshot
- [app/api/recommendations/current/route.js](/Users/nguyenngochoa/Git/gg-hackathon/app/api/recommendations/current/route.js): returns the current persisted decision state without creating a new run
- [SynaptOS_Data - SynaptOS_Baseline_Final_v4.csv](/Users/nguyenngochoa/Git/gg-hackathon/SynaptOS_Data%20-%20SynaptOS_Baseline_Final_v4.csv): baseline simulation dataset

## Screens

The current UI includes:

- HQ Overview
- Store Operations
- Approval Queue
- Shelf Labels
- Calibration & Audit

## Getting Started

### Prerequisites

- `Node.js` 20+ recommended
- `npm`

### Install

```bash
npm install
```

### Run in Development

```bash
npm run db:up
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

### Production Build

```bash
npm run build
npm start
```

## Dataset Notes

The prototype uses the baseline CSV as the operational seed. It contains:

- 3 store contexts:
  - `Premium_Urban / Q1`
  - `Transit / Q3`
  - `Residential / Q7`
- hourly time slots
- SKU/category data
- expiry dates
- temperature and traffic signals
- import, sold, waste, price, revenue, and profit fields

The app derives lot-level inventory state from this dataset rather than reading pre-built lot records from a database.

## Implemented API Routes

### `GET /api/stores`

Returns the store list visible to the current session.

### `GET /api/snapshots`

Returns the available timeline snapshots extracted from the CSV.

### `POST /api/recommendations/run`

Runs the recommendation engine for a selected snapshot and persists the result.

Example request:

```json
{
  "snapshot": "2025-03-31T20:00:00",
  "calibrations": [],
  "pendingAdjustments": {},
  "previousLabels": {}
}
```

## Important Limitations

This is still a prototype. The following are intentionally not implemented yet:

- procurement and routing workflows
- billing or enterprise partner APIs
- external POS writeback
- enterprise identity integration
- production database infrastructure

The app now persists approval, label, calibration, run, import, and audit state in Postgres using `postgresql://synaptos:synaptos@localhost:5432/synaptos_v2` by default.

## Related Project Docs

- [docs/README.md](/Users/nguyenngochoa/Git/gg-hackathon/docs/README.md): documentation index
- [docs/system-reference.md](/Users/nguyenngochoa/Git/gg-hackathon/docs/system-reference.md): current architecture and runtime behavior
- [docs/api-reference.md](/Users/nguyenngochoa/Git/gg-hackathon/docs/api-reference.md): route-by-route API documentation
- [docs/developer-runbook.md](/Users/nguyenngochoa/Git/gg-hackathon/docs/developer-runbook.md): setup, operations, reset steps, and Postgres runbook
- [prototype-plan.md](/Users/nguyenngochoa/Git/gg-hackathon/prototype-plan.md): implementation plan
- [hackathon-architecture.md](/Users/nguyenngochoa/Git/gg-hackathon/hackathon-architecture.md): `v1 / v2 / v3` split, system diagram, and service boundaries
- [quickstart.md](/Users/nguyenngochoa/Git/gg-hackathon/quickstart.md): short build/run notes
- [research.md](/Users/nguyenngochoa/Git/gg-hackathon/research.md): planning decisions
- [data-model.md](/Users/nguyenngochoa/Git/gg-hackathon/data-model.md): conceptual data model
- [contracts/api-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/api-contract.md): intended API contract
- [contracts/ui-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/ui-contract.md): intended UI contract

## Next Recommended Step

If you want to evolve this beyond demo state, the highest-value next change is:

1. add a real ingestion adapter for POS exports instead of the baseline-only import path
2. add scheduling and background processing for unattended recomputation/import jobs
3. harden the local Postgres setup into a production-grade deployment topology
