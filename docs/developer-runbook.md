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

The app currently persists to Postgres using:

```text
postgresql://synaptos:synaptos@localhost:5432/synaptos_v2
```

Set `DATABASE_URL` if you want to use a different Postgres instance.

## Resetting Local State

To fully reset the app’s durable local state:

1. stop the app
2. run `npm run db:down`
3. remove the Docker volume with `docker volume rm gg-hackathon_synaptos_postgres_data` if you want a full wipe
4. run `npm run db:up`
5. start the app again

On next boot, the app will:

- recreate schema
- re-import the baseline CSV
- reseed users

## Seeded Users

The app creates:

- one HQ admin
- one manager per store
- one staff user per store

The UI role selector uses `POST /api/auth/login` to switch between these seeded users.

## Baseline Import

The current import path is baseline-only.

Source:

- [SynaptOS_Data - SynaptOS_Baseline_Final_v4.csv](/Users/nguyenngochoa/Git/gg-hackathon/SynaptOS_Data%20-%20SynaptOS_Baseline_Final_v4.csv)

Admin users can trigger a fresh import through:

- `POST /api/imports`

Current import behavior:

- clears operational state tables
- reloads stores, snapshots, and inventory rows
- reseeds users
- records an import batch and audit event

## Local Postgres With Docker

This repo includes the local Postgres setup used by the app:

- [docker-compose.postgres.yml](/Users/nguyenngochoa/Git/gg-hackathon/docker-compose.postgres.yml)
- [.env.postgres.example](/Users/nguyenngochoa/Git/gg-hackathon/.env.postgres.example)

### Start

```bash
npm run db:up
```

### Stop

```bash
npm run db:down
```

### Logs

```bash
npm run db:logs
```

### Default connection

```text
postgresql://synaptos:synaptos@localhost:5432/synaptos_v2
```

## Verification

### Build

```bash
npm run build
```

This is the main verification currently available in the repo.

### Database inspection

To inspect the local Postgres tables quickly:

```bash
docker exec synaptos_postgres psql -U synaptos -d synaptos_v2 -c '\dt'
```

### Postgres readiness

If the Docker container is running:

```bash
docker exec synaptos_postgres pg_isready -U synaptos -d synaptos_v2
```

## Operational Notes

- The sandbox used during implementation may block binding a local port, so `next start` can be build-verified without being HTTP smoke-tested in the same environment.
- SSE events are in-process only; they are not durable or cross-instance.
- Recommendation recomputation currently happens inline on request-triggered actions.
- The app has no separate worker runtime yet.

## Known Gaps

- No real POS export adapter besides the baseline CSV
- No external POS writeback
- No procurement or routing flows
- No enterprise identity provider
- No production-grade Postgres deployment or migrations workflow
- No background job separation
