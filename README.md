# SynaptOS

SynaptOS is an agentic AI operations stack for fresh-food retail inventory management in Vietnam. This repository packages the platform as a Next.js 15 + React 19 + PostgreSQL application with three operator-facing surfaces:

- `/admin` for HQ and store managers
- `/pos` for cashier workflows and live markdown pricing
- `/eink` for store-scoped E-ink price boards

## What Is Implemented

- custom `server.js` boot path with Socket.io room routing by `storeId`
- five-stage Gemini pipeline:
  - ingestion
  - aggregation
  - risk scoring
  - recommendation
  - campaign suggestion
- schema validation and failed-artifact persistence for every agent stage
- deterministic guardrails and approval routing
- campaign scheduling with live price updates
- client-side PDF exports for tax write-off and SDG reports
- Electron wrapper for the POS client

## Core Stack

- Next.js 15 App Router
- React 19
- PostgreSQL via `pg`
- Socket.io
- jsPDF + jspdf-autotable
- Electron + electron-builder

## Project Layout

- `app/(admin)/admin/*`: manager dashboard routes
- `app/(pos)/pos/page.jsx`: POS entry route
- `app/(eink)/eink/page.jsx`: E-ink price board entry route
- `app/api/*`: RBAC-protected API routes
- `components/admin/*`: admin UI
- `components/pos/*`: POS UI
- `components/eink/*`: E-ink UI
- `lib/server/agent/*`: multi-agent orchestration and providers
- `lib/server/prototype-store.js`: PostgreSQL persistence and bootstrap
- `lib/server/campaign-scheduler.js`: campaign activation/expiry loop
- `lib/client/pdf/*`: browser-side PDF generation
- `electron/*`: Electron runtime and packaging config

## Local Run

```bash
npm install
npm run db:up
npm run dev
```

Open:

- `http://127.0.0.1:3000/admin/dashboard`
- `http://127.0.0.1:3000/pos?storeId=Q7`
- `http://127.0.0.1:3000/eink?storeId=Q7`

## Environment

Copy `.env.example` to `.env` and configure:

- `DATABASE_URL`
- `EXA_API_KEY`
- `GEMINI_API_KEY`
- `STORE_ID`
- `MANAGER_PIN`

If `GEMINI_API_KEY` is blank, the pipeline still runs with deterministic fallbacks, but Gemini-backed stages report provider configuration failure and return the structured fallback payloads instead of live model output.

## Packaging

```bash
npm run build
npm run package:win
```

This produces a Windows installer in `dist/`.

## Notes

- `npm run dev` uses the custom `server.js` entrypoint, not `next dev`.
- Socket price updates are emitted only to `store:{storeId}` rooms.
- The backend remains additive to the original prototype; existing API groups were preserved.
