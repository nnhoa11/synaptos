# SynaptOS Quickstart

## Prerequisites

- Node.js 20+
- npm
- Docker Desktop or a local PostgreSQL instance

## Environment

Create a local `.env` from `.env.example` and provide real values for:

- `DATABASE_URL`
- `EXA_API_KEY`
- `GEMINI_API_KEY`
- `STORE_ID`
- `MANAGER_PIN`

## Install

```bash
npm install
npm run db:up
```

## Start The App

```bash
npm run dev
```

The custom `server.js` entrypoint builds the Next.js app and starts the Socket.io server on `http://127.0.0.1:3000`.

Primary routes:

- `/admin/dashboard`
- `/admin/chains`
- `/admin/recommendations`
- `/admin/campaigns`
- `/admin/approvals`
- `/admin/tax-writeoff`
- `/admin/sdg-report`
- `/admin/settings`
- `/pos?storeId=Q7`
- `/eink?storeId=Q7`

## Validation Flow

1. Open `/admin/dashboard` and log in as `HQ Admin`.
2. Run the engine for `Q7`.
3. Open `/pos?storeId=Q7` and `/eink?storeId=Q7` in separate tabs.
4. Confirm markdown labels turn the same SKU red in both clients.
5. Create a flash campaign in `/admin/campaigns` and confirm it applies and reverts.
6. Complete a POS checkout and confirm the receipt modal and persisted transaction.

## Electron POS

```bash
npm run electron:dev
```

This opens the POS route in a frameless Electron window. Run `npm run dev` first.

## Windows Packaging

```bash
npm run build
npm run package:win
```

The packaged installer is written to `dist/`.
