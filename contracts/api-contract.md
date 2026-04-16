# SynaptOS Prototype API Contract

## Scope

This contract defines the internal HTTP and realtime interfaces expected by the prototype. These are prototype-level contracts, not public enterprise APIs.

## Conventions

- Content type: `application/json`
- Time values: ISO 8601
- Currency fields: numeric decimal values in local display currency
- IDs: opaque strings

## HTTP Endpoints

### `GET /api/stores`

Purpose:

- Return stores and high-level operational status.

Response:

```json
[
  {
    "id": "store_d1",
    "name": "SynaptOS D1 Premium",
    "type": "premium",
    "district": "District 1",
    "pendingReviews": 3,
    "expiringLots": 8
  }
]
```

### `GET /api/stores/:storeId/dashboard`

Purpose:

- Return operational data for one store.

Response shape:

- `store`
- `summary`
- `expiringLots`
- `activeMarkdowns`
- `signals`

### `GET /api/recommendations`

Query params:

- `storeId` optional
- `status` optional

Purpose:

- Return recommendation queue items.

### `POST /api/recommendations/run`

Purpose:

- Trigger a recommendation engine pass.

Request:

```json
{
  "storeId": "store_d1"
}
```

Response:

```json
{
  "runId": "run_001",
  "status": "running"
}
```

### `POST /api/recommendations/:id/approve`

Purpose:

- Approve a recommendation and optionally edit its discount.

Request:

```json
{
  "reviewedBy": "user_manager_1",
  "approvedDiscountPct": 25,
  "comment": "Approved for lunch window"
}
```

Response:

```json
{
  "id": "rec_001",
  "status": "approved"
}
```

### `POST /api/recommendations/:id/reject`

Purpose:

- Reject a recommendation.

Request:

```json
{
  "reviewedBy": "user_manager_1",
  "comment": "Foot traffic stronger than expected"
}
```

### `POST /api/calibration`

Purpose:

- Submit end-of-day shrinkage or spoilage corrections.

Request:

```json
{
  "storeId": "store_d7",
  "skuId": "sku_chicken_family_pack",
  "lotId": "lot_1002",
  "shrinkageUnits": 1,
  "spoiledUnits": 2,
  "notes": "Damaged packaging"
}
```

### `GET /api/labels`

Query params:

- `storeId` required

Purpose:

- Return active shelf-label data for a store.

### `GET /api/metrics`

Query params:

- `storeId` optional
- `date` optional

Purpose:

- Return rescued GMV and operational metrics.

## Realtime Contract

### `GET /api/events`

Transport:

- Server-Sent Events

Event types:

- `recommendation.updated`
- `price.updated`
- `label.updated`
- `run.completed`

Example event payload:

```json
{
  "type": "price.updated",
  "storeId": "store_d1",
  "lotId": "lot_1001",
  "currentPrice": 3.9,
  "previousPrice": 4.5,
  "reason": "expiry_risk"
}
```

## Error Contract

Error response shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "approvedDiscountPct must be between 0 and 100"
  }
}
```

Common codes:

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `INVALID_STATE`
- `UNAUTHORIZED_ROLE`
