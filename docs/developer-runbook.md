# Developer Runbook

## Local Development

### Prerequisites

- Node.js
- npm
- Docker

### Install

```bash
npm install
```

### Start the app

```bash
npm run db:up
npm run dev
```

### Production build

```bash
npm run build
npm start
```

## Runtime Storage

Default local database:

```text
postgresql://synaptos:synaptos@localhost:5432/synaptos_v2
```

Set `DATABASE_URL` to point at a different Postgres instance.

## Resetting Local State

To fully reset durable local state:

1. stop the app
2. run `npm run db:down`
3. remove the Docker volume with `docker volume rm gg-hackathon_synaptos_postgres_data` for a full wipe
4. run `npm run db:up`
5. start the app again

Next boot will recreate schema, re-import the baseline CSV, and reseed users.

## Seeded Users

The app creates:

- one HQ admin
- one manager per store
- one staff user per store
- one procurement planner per store
- one logistics coordinator per store

The UI role selector uses `POST /api/auth/login` to switch between these seeded users.

## LLM Runtime Configuration

Useful env vars:

```bash
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
export LLM_PROVIDER="openai"
export LLM_MODEL="gpt-5.4"
export LLM_MODE="shadow"
export LLM_TIMEOUT_MS="15000"
export LLM_MAX_RETRIES="2"
```

Behavior:

- `shadow` and `assisted` can fall back to `mock`
- `live` requires a configured provider
- retry, timeout, and rate-limit state are exposed through the model-run detail surface

## Verification

### Build

```bash
npm run build
```

### Control-Tower Replay Check

Recommended manual verification:

1. run aggregation for a snapshot
2. run `/api/agent/runs` in `shadow` mode
3. inspect the latest model run in the control-tower UI
4. confirm provider, parse status, retry count, timeout state, and rate-limit state are visible
5. confirm proposals, guardrails, and audit history remain linked

### Database Inspection

```bash
docker exec synaptos_postgres psql -U synaptos -d synaptos_v2 -c '\dt'
```

## Rollout Modes

Store-level rollout modes:

- `disabled`
- `shadow`
- `assisted`
- `live`

Cutover guidance:

1. start in `shadow`
2. verify audit coverage, provenance visibility, and simulation badges
3. verify provider failure handling and fallback behavior
4. move to `assisted` or `live` only when rollback is documented

Rollback guidance:

- move the store back to `shadow` or `disabled`
- keep the legacy markdown path available
- use audit and model-run history to explain the rollback trigger

## Operational Notes

- The sandbox used during implementation may block binding a local port, so `next start` can be build-verified without a full HTTP smoke test in the same environment.
- SSE events are in-process only; they are not durable or cross-instance.
- Aggregation, model runs, and recommendation recomputation currently happen inline on request-triggered actions.
- The app has no separate worker runtime yet.

## Known Gaps

- No live POS export adapter besides the baseline CSV
- No external POS writeback
- No live procurement or routing connectors
- No enterprise identity provider
- No production-grade Postgres deployment or migrations workflow
- No background job separation
