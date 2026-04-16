import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import {
  buildMetrics,
  buildSnapshots,
  buildStores,
  normalizeRow,
  parseCsv,
  runPrototype,
} from "@/lib/prototype-core";
import { publishEvent } from "@/lib/server/events";

const CSV_PATH = path.join(process.cwd(), "SynaptOS_Data - SynaptOS_Baseline_Final_v4.csv");
const DEFAULT_IMPORT_SOURCE = "baseline_csv";
const DEFAULT_POSTGRES_CONFIG = {
  host: "localhost",
  port: "5432",
  database: "synaptos_v2",
  user: "synaptos",
  password: "synaptos",
};
const BATCH_SIZE = 250;
const globalScope = globalThis;

function now() {
  return new Date().toISOString();
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.POSTGRES_HOST ?? DEFAULT_POSTGRES_CONFIG.host;
  const port = process.env.POSTGRES_PORT ?? DEFAULT_POSTGRES_CONFIG.port;
  const database = process.env.POSTGRES_DB ?? DEFAULT_POSTGRES_CONFIG.database;
  const user = process.env.POSTGRES_USER ?? DEFAULT_POSTGRES_CONFIG.user;
  const password = process.env.POSTGRES_PASSWORD ?? DEFAULT_POSTGRES_CONFIG.password;

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function getPool() {
  if (!globalScope.__synaptosPostgresPool) {
    globalScope.__synaptosPostgresPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 10,
    });
  }

  return globalScope.__synaptosPostgresPool;
}

async function ensureInitialized() {
  if (!globalScope.__synaptosPostgresInitPromise) {
    globalScope.__synaptosPostgresInitPromise = initializeDatabase().catch((error) => {
      globalScope.__synaptosPostgresInitPromise = null;
      throw error;
    });
  }

  return globalScope.__synaptosPostgresInitPromise;
}

async function initializeDatabase() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await createSchema(client);

    const inventoryCount = await getCount(client, "inventory_rows");
    if (inventoryCount === 0) {
      await client.query("BEGIN");
      try {
        await importBaselineDataInternal(client, {
          actorUserId: null,
          source: DEFAULT_IMPORT_SOURCE,
          resetState: false,
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } else {
      const storeCount = await getCount(client, "stores");
      const userCount = await getCount(client, "users");

      if (storeCount > 0 && userCount === 0) {
        const stores = await loadStores(client);
        await upsertUsers(client, buildSeedUsers(stores));
      }
    }
  } finally {
    client.release();
  }
}

async function createSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      archetype TEXT NOT NULL,
      district TEXT NOT NULL,
      name TEXT NOT NULL,
      approval_threshold_pct INTEGER NOT NULL,
      markdown_bias INTEGER NOT NULL,
      display_type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_rows (
      id BIGSERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      timestamp_ms BIGINT NOT NULL,
      timestamp_key TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      store_type TEXT NOT NULL,
      district TEXT NOT NULL,
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      archetype TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      category TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      expiry_at_ms BIGINT NOT NULL,
      temp DOUBLE PRECISION NOT NULL,
      item_traffic DOUBLE PRECISION NOT NULL,
      imported DOUBLE PRECISION NOT NULL,
      sold DOUBLE PRECISION NOT NULL,
      waste DOUBLE PRECISION NOT NULL,
      cost DOUBLE PRECISION NOT NULL,
      price DOUBLE PRECISION NOT NULL,
      revenue DOUBLE PRECISION NOT NULL,
      op_cost DOUBLE PRECISION NOT NULL,
      waste_loss DOUBLE PRECISION NOT NULL,
      net_profit DOUBLE PRECISION NOT NULL,
      lot_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      snapshot_key TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      store_id TEXT
    );

    CREATE TABLE IF NOT EXISTS recommendation_runs (
      id TEXT PRIMARY KEY,
      snapshot_key TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      actor_user_id TEXT,
      metrics_json JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      lot_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      category TEXT NOT NULL,
      risk_score INTEGER NOT NULL,
      recommended_discount_pct DOUBLE PRECISION NOT NULL,
      recommended_price DOUBLE PRECISION NOT NULL,
      approval_threshold_pct INTEGER NOT NULL,
      requires_approval BOOLEAN NOT NULL,
      reason_summary TEXT NOT NULL,
      expected_rescue_units DOUBLE PRECISION NOT NULL,
      expected_rescue_gmv DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      active_price DOUBLE PRECISION NOT NULL,
      lot_json JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approval_decisions (
      id TEXT PRIMARY KEY,
      recommendation_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      store_id TEXT NOT NULL,
      reviewed_by TEXT NOT NULL,
      status TEXT NOT NULL,
      discount_pct DOUBLE PRECISION,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shelf_labels (
      lot_id TEXT PRIMARY KEY,
      current_price DOUBLE PRECISION NOT NULL,
      previous_price DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      recommendation_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calibrations (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      sku_key TEXT NOT NULL,
      shrinkage_units DOUBLE PRECISION NOT NULL,
      spoiled_units DOUBLE PRECISION NOT NULL,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      store_id TEXT,
      type TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_user_id TEXT,
      message TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      summary_json JSONB,
      created_by TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS inventory_rows_timestamp_key_idx
      ON inventory_rows (timestamp_key);
    CREATE INDEX IF NOT EXISTS inventory_rows_store_id_idx
      ON inventory_rows (store_id);
    CREATE INDEX IF NOT EXISTS inventory_rows_lot_id_idx
      ON inventory_rows (lot_id);
    CREATE INDEX IF NOT EXISTS recommendations_snapshot_key_idx
      ON recommendations (snapshot_key);
    CREATE INDEX IF NOT EXISTS recommendations_store_id_idx
      ON recommendations (store_id);
    CREATE INDEX IF NOT EXISTS approval_decisions_snapshot_key_idx
      ON approval_decisions (snapshot_key);
    CREATE INDEX IF NOT EXISTS calibrations_store_id_idx
      ON calibrations (store_id);
    CREATE INDEX IF NOT EXISTS audit_events_store_id_idx
      ON audit_events (store_id);
  `);
}

async function withTransaction(work) {
  await ensureInitialized();
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getCount(client, tableName) {
  const result = await client.query(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return Number(result.rows[0]?.count ?? 0);
}

function readBaselineRows() {
  return parseCsv(readFileSync(CSV_PATH, "utf8"))
    .map(normalizeRow)
    .filter(Boolean);
}

function buildSeedUsers(stores) {
  return [
    {
      id: "user_admin_hq",
      name: "HQ Admin",
      email: "admin@synaptos.local",
      role: "admin",
      storeId: null,
    },
    ...stores.flatMap((store) => [
      {
        id: `user_manager_${store.id}`,
        name: `${store.district} Manager`,
        email: `${store.id}.manager@synaptos.local`,
        role: "manager",
        storeId: store.id,
      },
      {
        id: `user_staff_${store.id}`,
        name: `${store.district} Staff`,
        email: `${store.id}.staff@synaptos.local`,
        role: "staff",
        storeId: store.id,
      },
    ]),
  ];
}

async function clearPersistentState(client) {
  await client.query(`
    TRUNCATE TABLE
      recommendations,
      recommendation_runs,
      approval_decisions,
      shelf_labels,
      calibrations,
      audit_events,
      import_batches,
      users,
      snapshots,
      inventory_rows,
      stores
  `);
}

async function insertRows(client, tableName, columns, rows, mapRow, onConflictClause = "") {
  if (!rows.length) {
    return;
  }

  for (let startIndex = 0; startIndex < rows.length; startIndex += BATCH_SIZE) {
    const chunk = rows.slice(startIndex, startIndex + BATCH_SIZE);
    const values = [];
    const placeholders = chunk
      .map((row, rowIndex) => {
        const mapped = mapRow(row);
        values.push(...mapped);
        const offset = rowIndex * columns.length;
        return `(${columns.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(", ")})`;
      })
      .join(", ");

    await client.query(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${placeholders} ${onConflictClause}`,
      values
    );
  }
}

async function insertStores(client, stores) {
  await insertRows(
    client,
    "stores",
    [
      "id",
      "type",
      "archetype",
      "district",
      "name",
      "approval_threshold_pct",
      "markdown_bias",
      "display_type",
    ],
    stores,
    (store) => [
      store.id,
      store.type,
      store.archetype,
      store.district,
      store.name,
      store.approvalThresholdPct,
      store.markdownBias,
      store.displayType,
    ]
  );
}

async function insertSnapshots(client, snapshots) {
  await insertRows(
    client,
    "snapshots",
    ["snapshot_key"],
    snapshots,
    (snapshotKey) => [snapshotKey]
  );
}

async function insertInventoryRows(client, rows) {
  await insertRows(
    client,
    "inventory_rows",
    [
      "date",
      "timestamp_ms",
      "timestamp_key",
      "time_slot",
      "store_type",
      "district",
      "store_id",
      "store_name",
      "archetype",
      "sku_name",
      "category",
      "expiry_date",
      "expiry_at_ms",
      "temp",
      "item_traffic",
      "imported",
      "sold",
      "waste",
      "cost",
      "price",
      "revenue",
      "op_cost",
      "waste_loss",
      "net_profit",
      "lot_id",
    ],
    rows,
    (row) => [
      row.date,
      row.timestampMs,
      row.timestampKey,
      row.timeSlot,
      row.storeType,
      row.district,
      row.storeId,
      row.storeName,
      row.archetype,
      row.skuName,
      row.category,
      row.expiryDate,
      row.expiryAtMs,
      row.temp,
      row.itemTraffic,
      row.imported,
      row.sold,
      row.waste,
      row.cost,
      row.price,
      row.revenue,
      row.opCost,
      row.wasteLoss,
      row.netProfit,
      row.lotId,
    ]
  );
}

async function upsertUsers(client, users) {
  await insertRows(
    client,
    "users",
    ["id", "name", "email", "role", "store_id"],
    users,
    (user) => [user.id, user.name, user.email, user.role, user.storeId],
    `ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      role = EXCLUDED.role,
      store_id = EXCLUDED.store_id`
  );
}

async function insertAuditEvent(client, event) {
  const createdAt = event.createdAt ?? now();
  const record = {
    id: event.id ?? crypto.randomUUID(),
    storeId: event.storeId ?? null,
    type: event.type,
    actor: event.actor,
    actorUserId: event.actorUserId ?? null,
    message: event.message,
    details: event.details,
    createdAt,
  };

  await client.query(
    `INSERT INTO audit_events
      (id, store_id, type, actor, actor_user_id, message, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      record.id,
      record.storeId,
      record.type,
      record.actor,
      record.actorUserId,
      record.message,
      record.details,
      record.createdAt,
    ]
  );

  return record;
}

async function loadStores(client) {
  const result = await client.query(`
    SELECT id, type, archetype, district, name, approval_threshold_pct, markdown_bias, display_type
      FROM stores
     ORDER BY name ASC
  `);

  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    archetype: row.archetype,
    district: row.district,
    name: row.name,
    approvalThresholdPct: Number(row.approval_threshold_pct),
    markdownBias: Number(row.markdown_bias),
    displayType: row.display_type,
  }));
}

async function loadSnapshots(client) {
  const result = await client.query(`
    SELECT snapshot_key
      FROM snapshots
     ORDER BY snapshot_key ASC
  `);

  return result.rows.map((row) => row.snapshot_key);
}

async function loadInventoryRows(client) {
  const result = await client.query(`
    SELECT
      date,
      timestamp_ms,
      timestamp_key,
      time_slot,
      store_type,
      district,
      store_id,
      store_name,
      archetype,
      sku_name,
      category,
      expiry_date,
      expiry_at_ms,
      temp,
      item_traffic,
      imported,
      sold,
      waste,
      cost,
      price,
      revenue,
      op_cost,
      waste_loss,
      net_profit,
      lot_id
    FROM inventory_rows
    ORDER BY timestamp_ms ASC
  `);

  return result.rows.map((row) => ({
    date: row.date,
    timestampMs: Number(row.timestamp_ms),
    timestampKey: row.timestamp_key,
    timeSlot: row.time_slot,
    storeType: row.store_type,
    district: row.district,
    storeId: row.store_id,
    storeName: row.store_name,
    archetype: row.archetype,
    skuName: row.sku_name,
    category: row.category,
    expiryDate: row.expiry_date,
    expiryAtMs: Number(row.expiry_at_ms),
    temp: Number(row.temp),
    itemTraffic: Number(row.item_traffic),
    imported: Number(row.imported),
    sold: Number(row.sold),
    waste: Number(row.waste),
    cost: Number(row.cost),
    price: Number(row.price),
    revenue: Number(row.revenue),
    opCost: Number(row.op_cost),
    wasteLoss: Number(row.waste_loss),
    netProfit: Number(row.net_profit),
    lotId: row.lot_id,
  }));
}

async function loadCalibrations(client, storeId = null) {
  const result = await client.query(
    `
      SELECT id, store_id, sku_key, shrinkage_units, spoiled_units, notes, created_by, created_at
        FROM calibrations
       WHERE ($1::text IS NULL OR store_id = $1)
       ORDER BY created_at DESC
    `,
    [storeId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    storeId: row.store_id,
    skuKey: row.sku_key,
    shrinkageUnits: Number(row.shrinkage_units),
    spoiledUnits: Number(row.spoiled_units),
    notes: row.notes ?? "",
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

async function loadLabels(client) {
  const result = await client.query(`
    SELECT lot_id, current_price, previous_price, status, recommendation_id, updated_at
      FROM shelf_labels
  `);

  return Object.fromEntries(
    result.rows.map((row) => [
      row.lot_id,
      {
        currentPrice: Number(row.current_price),
        previousPrice: Number(row.previous_price),
        status: row.status,
        recommendationId: row.recommendation_id,
        updatedAt: row.updated_at,
      },
    ])
  );
}

async function loadPendingAdjustments(client, snapshotKey) {
  const result = await client.query(
    `
      SELECT DISTINCT ON (recommendation_id)
        recommendation_id,
        status,
        discount_pct
      FROM approval_decisions
      WHERE snapshot_key = $1
      ORDER BY recommendation_id, created_at DESC
    `,
    [snapshotKey]
  );

  return Object.fromEntries(
    result.rows.map((row) => [
      row.recommendation_id,
      {
        status: row.status,
        discountPct: row.discount_pct == null ? null : Number(row.discount_pct),
      },
    ])
  );
}

async function computePayload(client, snapshotKey) {
  const rows = await loadInventoryRows(client);
  const stores = await loadStores(client);
  const calibrations = await loadCalibrations(client);
  const labels = await loadLabels(client);
  const pendingAdjustments = await loadPendingAdjustments(client, snapshotKey);

  if (!stores.length || !rows.length) {
    return {
      latestRun: {
        snapshotDate: snapshotKey,
        activeLots: [],
        recommendations: [],
        metrics: buildMetrics([], []),
        generatedAt: now(),
      },
      labels: {},
      updatedLabelIds: [],
    };
  }

  return runPrototype({
    rows,
    stores,
    selectedSnapshot: snapshotKey,
    calibrations,
    pendingAdjustments,
    previousLabels: labels,
  });
}

function filterPayloadForUser(payload, user) {
  if (!user || user.role === "admin") {
    return payload;
  }

  const activeLots = payload.latestRun.activeLots.filter((lot) => lot.storeId === user.storeId);
  const recommendations = payload.latestRun.recommendations.filter(
    (recommendation) => recommendation.storeId === user.storeId
  );
  const visibleLotIds = new Set([
    ...activeLots.map((lot) => lot.lotId),
    ...recommendations.map((recommendation) => recommendation.lotId),
  ]);
  const labels = Object.fromEntries(
    Object.entries(payload.labels).filter(([lotId]) => visibleLotIds.has(lotId))
  );

  return {
    ...payload,
    latestRun: {
      ...payload.latestRun,
      activeLots,
      recommendations,
      metrics: buildMetrics(activeLots, recommendations),
    },
    labels,
    updatedLabelIds: payload.updatedLabelIds.filter((lotId) => visibleLotIds.has(lotId)),
  };
}

async function persistRecommendations(client, runId, snapshotKey, recommendations) {
  await client.query(`DELETE FROM recommendations WHERE snapshot_key = $1`, [snapshotKey]);

  await insertRows(
    client,
    "recommendations",
    [
      "id",
      "run_id",
      "snapshot_key",
      "lot_id",
      "store_id",
      "sku_name",
      "category",
      "risk_score",
      "recommended_discount_pct",
      "recommended_price",
      "approval_threshold_pct",
      "requires_approval",
      "reason_summary",
      "expected_rescue_units",
      "expected_rescue_gmv",
      "status",
      "active_price",
      "lot_json",
    ],
    recommendations,
    (recommendation) => [
      recommendation.id,
      runId,
      snapshotKey,
      recommendation.lotId,
      recommendation.storeId,
      recommendation.skuName,
      recommendation.category,
      recommendation.riskScore,
      recommendation.recommendedDiscountPct,
      recommendation.recommendedPrice,
      recommendation.approvalThresholdPct,
      recommendation.requiresApproval,
      recommendation.reasonSummary,
      recommendation.expectedRescueUnits,
      recommendation.expectedRescueGmv,
      recommendation.status,
      recommendation.activePrice,
      JSON.stringify(recommendation.lot),
    ]
  );
}

async function upsertLabels(client, labels) {
  const entries = Object.entries(labels);
  await insertRows(
    client,
    "shelf_labels",
    ["lot_id", "current_price", "previous_price", "status", "recommendation_id", "updated_at"],
    entries,
    ([lotId, label]) => [
      lotId,
      label.currentPrice,
      label.previousPrice,
      label.status,
      label.recommendationId,
      label.updatedAt ?? now(),
    ],
    `ON CONFLICT (lot_id) DO UPDATE SET
      current_price = EXCLUDED.current_price,
      previous_price = EXCLUDED.previous_price,
      status = EXCLUDED.status,
      recommendation_id = EXCLUDED.recommendation_id,
      updated_at = EXCLUDED.updated_at`
  );
}

async function persistRunState(client, snapshotKey, actorUserId, payload) {
  const runId = crypto.randomUUID();
  const generatedAt = payload.latestRun.generatedAt ?? now();

  await client.query(
    `INSERT INTO recommendation_runs (id, snapshot_key, generated_at, actor_user_id, metrics_json)
     VALUES ($1, $2, $3, $4, $5)`,
    [runId, snapshotKey, generatedAt, actorUserId, JSON.stringify(payload.latestRun.metrics)]
  );

  await persistRecommendations(client, runId, snapshotKey, payload.latestRun.recommendations);
  await upsertLabels(
    client,
    Object.fromEntries(
      Object.entries(payload.labels).map(([lotId, label]) => [
        lotId,
        {
          ...label,
          updatedAt: now(),
        },
      ])
    )
  );
}

async function loadUserById(client, userId) {
  if (!userId) {
    return null;
  }

  const result = await client.query(
    `SELECT id, name, email, role, store_id FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );

  if (!result.rows.length) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    storeId: row.store_id,
  };
}

async function loadDefaultSessionUser(client) {
  const admin = await loadUserById(client, "user_admin_hq");
  if (admin) {
    return admin;
  }

  const fallback = await client.query(
    `SELECT id, name, email, role, store_id FROM users ORDER BY role ASC, name ASC LIMIT 1`
  );

  if (!fallback.rows.length) {
    return null;
  }

  const row = fallback.rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    storeId: row.store_id,
  };
}

async function importBaselineDataInternal(client, { actorUserId, source, resetState }) {
  if (resetState) {
    await clearPersistentState(client);
  }

  const batchId = crypto.randomUUID();
  const createdAt = now();
  await client.query(
    `INSERT INTO import_batches (id, source, status, summary_json, created_by, created_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [batchId, source, "running", null, actorUserId, createdAt, null]
  );

  const rows = readBaselineRows();
  const stores = buildStores(rows);
  const snapshots = buildSnapshots(rows);
  const users = buildSeedUsers(stores);

  await insertStores(client, stores);
  await insertInventoryRows(client, rows);
  await insertSnapshots(client, snapshots);
  await upsertUsers(client, users);

  const summary = {
    rows: rows.length,
    stores: stores.length,
    snapshots: snapshots.length,
  };
  const completedAt = now();

  await client.query(
    `UPDATE import_batches
        SET status = $2,
            summary_json = $3,
            completed_at = $4
      WHERE id = $1`,
    [batchId, "completed", JSON.stringify(summary), completedAt]
  );

  const actor = actorUserId ? (await loadUserById(client, actorUserId))?.name ?? "HQ Admin" : "SynaptOS";

  await insertAuditEvent(client, {
    type: "Baseline import",
    storeId: null,
    actor,
    actorUserId,
    message: "Baseline inventory import completed",
    details: `${rows.length} rows seeded across ${stores.length} stores and ${snapshots.length} snapshots.`,
    createdAt: completedAt,
  });

  return {
    id: batchId,
    source,
    status: "completed",
    summaryJson: summary,
    createdBy: actorUserId,
    createdAt,
    completedAt,
  };
}

function createStoreAccessError() {
  const error = new Error("FORBIDDEN");
  error.code = "FORBIDDEN";
  return error;
}

async function assertAccessibleRecommendation(client, snapshotKey, recommendationId, user) {
  const payload = await computePayload(client, snapshotKey);
  const recommendation =
    payload.latestRun.recommendations.find((item) => item.id === recommendationId) ?? null;

  if (!recommendation) {
    const error = new Error("NOT_FOUND");
    error.code = "NOT_FOUND";
    throw error;
  }

  if (user?.role !== "admin" && user?.storeId !== recommendation.storeId) {
    throw createStoreAccessError();
  }

  return recommendation;
}

export async function getPrototypeMeta() {
  await ensureInitialized();
  const pool = getPool();
  const [stores, snapshots] = await Promise.all([loadStores(pool), loadSnapshots(pool)]);

  return {
    stores,
    snapshots,
    defaultSnapshot: snapshots.at(-1) ?? null,
  };
}

export async function getDefaultSessionUser() {
  await ensureInitialized();
  return loadDefaultSessionUser(getPool());
}

export async function getUserById(userId) {
  await ensureInitialized();
  return loadUserById(getPool(), userId);
}

export async function getUserForRole(role, storeId) {
  await ensureInitialized();

  if (role === "admin") {
    return getDefaultSessionUser();
  }

  if (!storeId) {
    return null;
  }

  const result = await getPool().query(
    `
      SELECT id, name, email, role, store_id
        FROM users
       WHERE role = $1
         AND store_id = $2
       ORDER BY name ASC
       LIMIT 1
    `,
    [role, storeId]
  );

  if (!result.rows.length) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    storeId: row.store_id,
  };
}

export async function getAccessibleStores(user) {
  await ensureInitialized();
  const stores = await loadStores(getPool());
  if (!user || user.role === "admin") {
    return stores;
  }

  return stores.filter((store) => store.id === user.storeId);
}

export async function getCurrentPayload(snapshotKey, user = null) {
  await ensureInitialized();
  const payload = await computePayload(getPool(), snapshotKey);
  return filterPayloadForUser(payload, user);
}

export async function runAndPersist(snapshotKey, actorUserId, user = null) {
  const payload = await withTransaction(async (client) => {
    const nextPayload = await computePayload(client, snapshotKey);
    await persistRunState(client, snapshotKey, actorUserId, nextPayload);

    const actor =
      (await loadUserById(client, actorUserId))?.name ??
      (await loadDefaultSessionUser(client))?.name ??
      "SynaptOS";

    await insertAuditEvent(client, {
      type: "Recommendation engine run",
      storeId: null,
      actor,
      actorUserId,
      message: "Recommendation engine completed",
      details: `${nextPayload.latestRun.recommendations.length} recommendations recalculated for ${snapshotKey}.`,
    });

    return nextPayload;
  });

  publishEvent("run.completed", {
    snapshotKey,
    recommendationCount: payload.latestRun.recommendations.length,
  });

  return filterPayloadForUser(payload, user);
}

export async function approveRecommendation({
  recommendationId,
  discountPct,
  comment = "",
  user,
  snapshotKey,
}) {
  const payload = await withTransaction(async (client) => {
    const recommendation = await assertAccessibleRecommendation(
      client,
      snapshotKey,
      recommendationId,
      user
    );

    await client.query(
      `INSERT INTO approval_decisions
        (id, recommendation_id, snapshot_key, store_id, reviewed_by, status, discount_pct, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        crypto.randomUUID(),
        recommendationId,
        snapshotKey,
        recommendation.storeId,
        user.id,
        "approved",
        discountPct,
        comment,
        now(),
      ]
    );

    const nextPayload = await computePayload(client, snapshotKey);
    await persistRunState(client, snapshotKey, user.id, nextPayload);
    await insertAuditEvent(client, {
      type: "Recommendation approved",
      storeId: recommendation.storeId,
      actor: user.name,
      actorUserId: user.id,
      message: `${recommendation.skuName} approved at ${discountPct}% markdown`,
      details: comment || `Approval recorded for ${recommendationId}.`,
    });

    return nextPayload;
  });

  publishEvent("recommendation.updated", {
    recommendationId,
    status: "approved",
    snapshotKey,
  });

  if (payload.updatedLabelIds.length) {
    publishEvent("label.updated", {
      snapshotKey,
      lotIds: payload.updatedLabelIds,
    });
    publishEvent("price.updated", {
      snapshotKey,
      lotIds: payload.updatedLabelIds,
    });
  }

  return filterPayloadForUser(payload, user);
}

export async function rejectRecommendation({ recommendationId, comment = "", user, snapshotKey }) {
  const payload = await withTransaction(async (client) => {
    const recommendation = await assertAccessibleRecommendation(
      client,
      snapshotKey,
      recommendationId,
      user
    );

    await client.query(
      `INSERT INTO approval_decisions
        (id, recommendation_id, snapshot_key, store_id, reviewed_by, status, discount_pct, comment, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        crypto.randomUUID(),
        recommendationId,
        snapshotKey,
        recommendation.storeId,
        user.id,
        "rejected",
        null,
        comment,
        now(),
      ]
    );

    const nextPayload = await computePayload(client, snapshotKey);
    await persistRunState(client, snapshotKey, user.id, nextPayload);
    await insertAuditEvent(client, {
      type: "Recommendation rejected",
      storeId: recommendation.storeId,
      actor: user.name,
      actorUserId: user.id,
      message: `${recommendation.skuName} recommendation rejected`,
      details: comment || `Rejection recorded for ${recommendationId}.`,
    });

    return nextPayload;
  });

  publishEvent("recommendation.updated", {
    recommendationId,
    status: "rejected",
    snapshotKey,
  });

  if (payload.updatedLabelIds.length) {
    publishEvent("label.updated", {
      snapshotKey,
      lotIds: payload.updatedLabelIds,
    });
    publishEvent("price.updated", {
      snapshotKey,
      lotIds: payload.updatedLabelIds,
    });
  }

  return filterPayloadForUser(payload, user);
}

export async function saveCalibration({
  storeId,
  skuKey,
  shrinkageUnits,
  spoiledUnits,
  notes = "",
  snapshotKey,
  user,
}) {
  if (!user || !["admin", "manager"].includes(user.role)) {
    throw createStoreAccessError();
  }

  if (user.role !== "admin" && user.storeId !== storeId) {
    throw createStoreAccessError();
  }

  const payload = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO calibrations
        (id, store_id, sku_key, shrinkage_units, spoiled_units, notes, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        crypto.randomUUID(),
        storeId,
        skuKey,
        shrinkageUnits,
        spoiledUnits,
        notes,
        user.id,
        now(),
      ]
    );

    const nextPayload = await computePayload(client, snapshotKey);
    await persistRunState(client, snapshotKey, user.id, nextPayload);
    await insertAuditEvent(client, {
      type: "Calibration recorded",
      storeId,
      actor: user.name,
      actorUserId: user.id,
      message: `Calibration recorded for ${skuKey}`,
      details: `Shrinkage ${shrinkageUnits}, spoilage ${spoiledUnits}${notes ? `. ${notes}` : ""}`,
    });

    return nextPayload;
  });

  publishEvent("calibration.recorded", {
    storeId,
    skuKey,
    snapshotKey,
  });

  return filterPayloadForUser(payload, user);
}

export async function listCalibrations(storeId = null) {
  await ensureInitialized();
  return loadCalibrations(getPool(), storeId);
}

export async function listAuditEvents(storeId = null) {
  await ensureInitialized();
  const result = await getPool().query(
    `
      SELECT id, store_id, type, actor, actor_user_id, message, details, created_at
        FROM audit_events
       WHERE ($1::text IS NULL OR store_id = $1 OR store_id IS NULL)
       ORDER BY created_at DESC
       LIMIT 100
    `,
    [storeId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    storeId: row.store_id,
    type: row.type,
    actor: row.actor,
    actorUserId: row.actor_user_id,
    message: row.message,
    details: row.details,
    createdAt: row.created_at,
  }));
}

export async function listLabels(storeId = null) {
  await ensureInitialized();
  const result = await getPool().query(
    `
      SELECT lot_id, current_price, previous_price, status, recommendation_id, updated_at
        FROM shelf_labels
       WHERE (
         $1::text IS NULL
         OR EXISTS (
           SELECT 1
             FROM recommendations
            WHERE recommendations.id = shelf_labels.recommendation_id
              AND recommendations.store_id = $1
         )
       )
    `,
    [storeId]
  );

  return Object.fromEntries(
    result.rows.map((row) => [
      row.lot_id,
      {
        currentPrice: Number(row.current_price),
        previousPrice: Number(row.previous_price),
        status: row.status,
        recommendationId: row.recommendation_id,
        updatedAt: row.updated_at,
      },
    ])
  );
}

export async function importBaselineData({
  actorUserId = null,
  source = DEFAULT_IMPORT_SOURCE,
  resetState = false,
}) {
  const batch = await withTransaction((client) =>
    importBaselineDataInternal(client, { actorUserId, source, resetState })
  );

  publishEvent("import.completed", {
    batchId: batch.id,
    source: batch.source,
    summary: batch.summaryJson,
  });

  return batch;
}

export async function getImportBatch(id) {
  await ensureInitialized();
  const result = await getPool().query(
    `
      SELECT id, source, status, summary_json, created_by, created_at, completed_at
        FROM import_batches
       WHERE id = $1
       LIMIT 1
    `,
    [id]
  );

  if (!result.rows.length) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    summaryJson: row.summary_json,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
