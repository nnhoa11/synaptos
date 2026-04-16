# SynaptOS Prototype

SynaptOS is a prototype for fresh-food retail markdown operations. It uses a baseline CSV dataset to simulate:

- perishable inventory risk
- deterministic markdown recommendations
- manager approval for high-risk actions
- virtual shelf-label price propagation
- audit and calibration workflows

This repository contains a runnable `Next.js` App Router prototype, not a production system.

## What It Does

The app demonstrates the core SynaptOS loop:

1. load baseline inventory and context from the CSV
2. derive lot-level inventory state
3. score spoilage and sell-through risk
4. recommend markdown actions
5. allow manager approval or rejection for risky discounts
6. update active prices in a shelf-label view
7. track audit and calibration events

## Current Stack

- `Next.js` App Router
- `React`
- CSS in [app/globals.css](/Users/nguyenngochoa/Git/gg-hackathon/app/globals.css)
- CSV-backed server-side data loading
- in-memory client state for approvals, labels, and calibration

## Project Structure

- [app/page.jsx](/Users/nguyenngochoa/Git/gg-hackathon/app/page.jsx): main page entry
- [components/PrototypeApp.jsx](/Users/nguyenngochoa/Git/gg-hackathon/components/PrototypeApp.jsx): interactive dashboard UI
- [lib/prototype-data.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/prototype-data.js): CSV loading and metadata extraction
- [lib/prototype-core.js](/Users/nguyenngochoa/Git/gg-hackathon/lib/prototype-core.js): row normalization, lot derivation, recommendation engine, metrics
- [app/api/stores/route.js](/Users/nguyenngochoa/Git/gg-hackathon/app/api/stores/route.js): returns store metadata
- [app/api/snapshots/route.js](/Users/nguyenngochoa/Git/gg-hackathon/app/api/snapshots/route.js): returns available timeline snapshots
- [app/api/recommendations/run/route.js](/Users/nguyenngochoa/Git/gg-hackathon/app/api/recommendations/run/route.js): computes the prototype engine result for a selected snapshot
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

Returns the store list used by the prototype.

### `GET /api/snapshots`

Returns the available timeline snapshots extracted from the CSV.

### `POST /api/recommendations/run`

Runs the recommendation engine for a selected snapshot.

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

- persistent storage with Prisma or SQLite
- authentication
- real POS integrations
- server-side approval persistence
- realtime transport via SSE or WebSockets
- procurement and routing workflows
- billing or enterprise partner APIs

Current approval, label, and calibration state lives in the browser session.

## Related Project Docs

- [prototype-plan.md](/Users/nguyenngochoa/Git/gg-hackathon/prototype-plan.md): implementation plan
- [quickstart.md](/Users/nguyenngochoa/Git/gg-hackathon/quickstart.md): short build/run notes
- [research.md](/Users/nguyenngochoa/Git/gg-hackathon/research.md): planning decisions
- [data-model.md](/Users/nguyenngochoa/Git/gg-hackathon/data-model.md): conceptual data model
- [contracts/api-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/api-contract.md): intended API contract
- [contracts/ui-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/ui-contract.md): intended UI contract

## Next Recommended Step

If you want to evolve this beyond demo state, the highest-value next change is:

1. add persistent state for approvals, labels, and calibration
2. align the implemented API routes more closely with [contracts/api-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/api-contract.md)
3. add store dashboard and recommendation history persistence
