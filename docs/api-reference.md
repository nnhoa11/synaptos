# API Reference

All current routes live under `app/api` and run in the Node runtime.

## Auth Model

Most routes infer the acting user from the `synaptos_session` cookie.

Seeded users exist for:

- one HQ admin
- one manager per store
- one staff user per store

## Error Shape

Current error responses use:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "snapshot is required"
  }
}
```

## Auth Routes

### `GET /api/auth/session`

Purpose:

- return the current session user and visible stores

Response:

```json
{
  "user": {
    "id": "user_admin_hq",
    "name": "HQ Admin",
    "email": "admin@synaptos.local",
    "role": "admin",
    "storeId": null
  },
  "stores": []
}
```

### `POST /api/auth/login`

Purpose:

- switch into a seeded local user and set the session cookie

Request:

```json
{
  "role": "manager",
  "storeId": "premium_urban_q1"
}
```

Notes:

- `admin` ignores `storeId`
- `manager` and `staff` require a resolvable store-scoped user

### `POST /api/auth/logout`

Purpose:

- clear the session cookie

Response:

```json
{
  "status": "logged_out"
}
```

## Metadata Routes

### `GET /api/stores`

Purpose:

- return the stores visible to the current session

Authorization:

- session-scoped

### `GET /api/snapshots`

Purpose:

- return available snapshot keys

Authorization:

- available to any current session

## Recommendation Routes

### `GET /api/recommendations/current?snapshot=...`

Purpose:

- compute and return the current visible payload for a snapshot without persisting a new run

Required query params:

- `snapshot`

Response shape:

```json
{
  "latestRun": {
    "snapshotDate": "2025-03-31T20:00:00",
    "activeLots": [],
    "recommendations": [],
    "metrics": {},
    "generatedAt": "..."
  },
  "labels": {},
  "updatedLabelIds": []
}
```

### `POST /api/recommendations/run`

Purpose:

- compute and persist a recommendation run

Request:

```json
{
  "snapshot": "2025-03-31T20:00:00"
}
```

Response:

- same shape as `GET /api/recommendations/current`

Side effects:

- inserts a `recommendation_runs` row
- upserts `recommendations`
- upserts `shelf_labels`
- writes `audit_events`
- emits SSE events

### `POST /api/recommendations/:id/approve`

Purpose:

- approve a guarded recommendation and optionally override the discount percent

Authorization:

- `admin` or store-scoped `manager`

Request:

```json
{
  "snapshot": "2025-03-31T20:00:00",
  "discountPct": 35,
  "comment": "Approved for end-of-day clearance"
}
```

Response:

```json
{
  "status": "approved",
  "payload": {}
}
```

Side effects:

- inserts an `approval_decisions` row
- writes an audit event
- recomputes and persists the snapshot

### `POST /api/recommendations/:id/reject`

Purpose:

- reject a guarded recommendation

Authorization:

- `admin` or store-scoped `manager`

Request:

```json
{
  "snapshot": "2025-03-31T20:00:00",
  "comment": "Holding margin for late traffic"
}
```

Response:

```json
{
  "status": "rejected",
  "payload": {}
}
```

## Calibration Routes

### `GET /api/calibration`

Purpose:

- list calibration entries

Query params:

- optional `storeId`

Authorization:

- `admin` can read all or one store
- non-admin users are constrained to their own store

### `POST /api/calibration`

Purpose:

- save a shrinkage/spoilage correction and recompute the snapshot

Request:

```json
{
  "storeId": "premium_urban_q1",
  "skuKey": "Organic Chicken",
  "shrinkageUnits": 1,
  "spoiledUnits": 2,
  "notes": "Damaged packaging",
  "snapshot": "2025-03-31T20:00:00"
}
```

Authorization:

- `admin`
- store-scoped `manager`

Response:

```json
{
  "status": "saved",
  "payload": {}
}
```

## Audit, Labels, and Metrics

### `GET /api/audit`

Purpose:

- list audit events

Query params:

- optional `storeId`

Authorization:

- store-scoped

### `GET /api/labels?storeId=...`

Purpose:

- list active shelf-label rows for one store

Required query params:

- `storeId`

Authorization:

- store-scoped

### `GET /api/metrics?snapshot=...`

Purpose:

- return current snapshot metrics

Required query params:

- `snapshot`

Authorization:

- session-scoped filtered payload

## Import Routes

### `POST /api/imports`

Purpose:

- reload the baseline CSV into the local durable store

Authorization:

- `admin` only

Response:

```json
{
  "status": "completed",
  "batch": {},
  "payload": {}
}
```

Current behavior:

- resets current operational state
- imports the baseline CSV
- reseeds users
- can immediately run the default snapshot

### `GET /api/imports/:id`

Purpose:

- retrieve import batch status and summary

Authorization:

- `admin` only

## SSE Route

### `GET /api/events`

Purpose:

- open an SSE stream for live operator events

Behavior:

- emits an immediate `session.ready`
- emits heartbeats
- forwards in-process published events

Current client behavior:

- treats SSE as a refresh trigger rather than a fully stateful patch stream
