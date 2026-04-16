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
import {
  buildAggregationRunSummary,
  buildAggregatedSnapshots,
  buildSignalObservations,
} from "@/lib/server/aggregation";
import {
  buildAgentRunResult,
  getDefaultPromptTemplateRecord,
} from "@/lib/server/agent";
import {
  buildApprovalDispatchResult,
  buildLabelExecution,
  buildLogisticsExecution,
  buildProcurementExecution,
} from "@/lib/server/execution";
import {
  AUDIT_TYPES,
  AUTO_MARKDOWN_THRESHOLD_PCT,
  CONTROL_TOWER_MODE,
  DEFAULT_PROMPT_TEMPLATE,
  EXECUTION_ROUTES,
  GUARDRAIL_OUTCOMES,
  LEGACY_MODE,
  LLM_ROLLOUT_MODES,
  MODEL_RUN_STATUSES,
  PARSE_STATUSES,
  PROPOSAL_STATUSES,
  SIMULATION_LABEL,
  TASK_STATUSES,
} from "@/lib/server/control-tower/constants";
import {
  publishAggregationCompleted,
  publishAgentCompleted,
  publishApprovalUpdated,
  publishEvent,
  publishExecutionUpdated,
  publishLogisticsUpdated,
  publishModelRunUpdated,
  publishProcurementUpdated,
  publishProposalUpdated,
} from "@/lib/server/events";
import { createApprovalRequestDraft, evaluateProposal } from "@/lib/server/rules";

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
    await ensureDefaultPromptTemplate(client);

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

    ALTER TABLE stores ADD COLUMN IF NOT EXISTS control_tower_enabled BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS markdown_max_auto_discount_pct INTEGER NOT NULL DEFAULT 50;
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS simulated_integrations BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE stores ADD COLUMN IF NOT EXISTS llm_mode TEXT NOT NULL DEFAULT 'shadow';

    CREATE TABLE IF NOT EXISTS signal_observations (
      id TEXT PRIMARY KEY,
      aggregation_run_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      store_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_family TEXT NOT NULL,
      freshness_status TEXT NOT NULL,
      freshness_minutes INTEGER NOT NULL,
      provenance TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      payload_json JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aggregation_runs (
      id TEXT PRIMARY KEY,
      snapshot_key TEXT NOT NULL,
      actor_user_id TEXT,
      status TEXT NOT NULL,
      summary_json JSONB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aggregated_snapshots (
      id TEXT PRIMARY KEY,
      aggregation_run_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      store_id TEXT NOT NULL,
      status TEXT NOT NULL,
      source_health TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      aggregation_run_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      actor_user_id TEXT,
      status TEXT NOT NULL,
      summary_json JSONB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      developer_prompt TEXT NOT NULL,
      response_schema_json JSONB NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS action_proposals (
      id TEXT PRIMARY KEY,
      agent_run_id TEXT NOT NULL,
      model_run_id TEXT,
      aggregation_run_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      store_id TEXT NOT NULL,
      lot_id TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      proposal_type TEXT NOT NULL,
      execution_route TEXT NOT NULL,
      recommended_discount_pct DOUBLE PRECISION NOT NULL,
      proposed_price DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      rationale TEXT NOT NULL,
      metadata_json JSONB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_runs (
      id TEXT PRIMARY KEY,
      agent_run_id TEXT NOT NULL,
      aggregation_run_id TEXT NOT NULL,
      snapshot_key TEXT NOT NULL,
      store_id TEXT NOT NULL,
      actor_user_id TEXT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      rollout_mode TEXT NOT NULL,
      prompt_template_name TEXT NOT NULL,
      prompt_template_version TEXT NOT NULL,
      status TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER,
      estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      usage_json JSONB NOT NULL,
      failure_code TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS model_input_artifacts (
      id TEXT PRIMARY KEY,
      model_run_id TEXT NOT NULL,
      prompt_context_json JSONB NOT NULL,
      request_json JSONB NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_output_artifacts (
      id TEXT PRIMARY KEY,
      model_run_id TEXT NOT NULL,
      raw_output_text TEXT,
      raw_output_json JSONB,
      parsed_output_json JSONB,
      parse_status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    ALTER TABLE action_proposals ADD COLUMN IF NOT EXISTS model_run_id TEXT;

    CREATE TABLE IF NOT EXISTS guardrail_evaluations (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      matched_rule TEXT NOT NULL,
      execution_route TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      status TEXT NOT NULL,
      matched_rule TEXT NOT NULL,
      requested_by TEXT,
      reviewed_by TEXT,
      review_notes TEXT,
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS execution_tasks (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      route TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json JSONB NOT NULL,
      simulated BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL,
      dispatched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS logistics_routes (
      id TEXT PRIMARY KEY,
      execution_task_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      route_type TEXT NOT NULL,
      destination TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS procurement_orders (
      id TEXT PRIMARY KEY,
      execution_task_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      supplier TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      estimated_cost DOUBLE PRECISION NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS signal_observations_snapshot_key_idx
      ON signal_observations (snapshot_key);
    CREATE INDEX IF NOT EXISTS aggregated_snapshots_store_id_idx
      ON aggregated_snapshots (store_id);
    CREATE INDEX IF NOT EXISTS prompt_templates_name_version_idx
      ON prompt_templates (name, version);
    CREATE INDEX IF NOT EXISTS model_runs_snapshot_key_idx
      ON model_runs (snapshot_key);
    CREATE INDEX IF NOT EXISTS model_runs_store_id_idx
      ON model_runs (store_id);
    CREATE INDEX IF NOT EXISTS model_input_artifacts_model_run_id_idx
      ON model_input_artifacts (model_run_id);
    CREATE INDEX IF NOT EXISTS model_output_artifacts_model_run_id_idx
      ON model_output_artifacts (model_run_id);
    CREATE INDEX IF NOT EXISTS action_proposals_snapshot_key_idx
      ON action_proposals (snapshot_key);
    CREATE INDEX IF NOT EXISTS action_proposals_store_id_idx
      ON action_proposals (store_id);
    CREATE INDEX IF NOT EXISTS execution_tasks_store_id_idx
      ON execution_tasks (store_id);
  `);
}

async function ensureDefaultPromptTemplate(client) {
  const template = getDefaultPromptTemplateRecord();
  await client.query(
    `
      INSERT INTO prompt_templates
        (id, name, version, system_prompt, developer_prompt, response_schema_json, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      `${template.name}:${template.version}`,
      template.name,
      template.version,
      template.systemPrompt,
      template.developerPrompt,
      JSON.stringify(template.responseSchemaJson),
      true,
      now(),
    ]
  );
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
      {
        id: `user_procurement_${store.id}`,
        name: `${store.district} Procurement`,
        email: `${store.id}.procurement@synaptos.local`,
        role: "procurement_planner",
        storeId: store.id,
      },
      {
        id: `user_logistics_${store.id}`,
        name: `${store.district} Logistics`,
        email: `${store.id}.logistics@synaptos.local`,
        role: "logistics_coordinator",
        storeId: store.id,
      },
    ]),
  ];
}

async function clearPersistentState(client) {
  await client.query(`
    TRUNCATE TABLE
      model_output_artifacts,
      model_input_artifacts,
      model_runs,
      prompt_templates,
      procurement_orders,
      logistics_routes,
      execution_tasks,
      approval_requests,
      guardrail_evaluations,
      action_proposals,
      agent_runs,
      aggregated_snapshots,
      aggregation_runs,
      signal_observations,
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
  await ensureDefaultPromptTemplate(client);
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
      "control_tower_enabled",
      "markdown_max_auto_discount_pct",
      "simulated_integrations",
      "llm_mode",
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
      store.controlTowerEnabled ?? true,
      store.markdownMaxAutoDiscountPct ?? AUTO_MARKDOWN_THRESHOLD_PCT,
      store.simulatedIntegrations ?? true,
      store.llmMode ?? LLM_ROLLOUT_MODES.SHADOW,
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
    SELECT
      id,
      type,
      archetype,
      district,
      name,
      approval_threshold_pct,
      markdown_bias,
      display_type,
      control_tower_enabled,
      markdown_max_auto_discount_pct,
      simulated_integrations,
      llm_mode
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
    controlTowerEnabled: row.control_tower_enabled,
    markdownMaxAutoDiscountPct: Number(row.markdown_max_auto_discount_pct),
    simulatedIntegrations: row.simulated_integrations,
    llmMode: row.llm_mode ?? LLM_ROLLOUT_MODES.SHADOW,
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

function parseJson(value, fallback) {
  return value == null ? fallback : value;
}

function mapPromptTemplateRow(row) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    systemPrompt: row.system_prompt,
    developerPrompt: row.developer_prompt,
    responseSchemaJson: parseJson(row.response_schema_json, {}),
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function mapAggregationRunRow(row) {
  return {
    id: row.id,
    snapshotKey: row.snapshot_key,
    actorUserId: row.actor_user_id,
    status: row.status,
    summary: parseJson(row.summary_json, {}),
    createdAt: row.created_at,
  };
}

function mapAggregatedSnapshotRow(row) {
  return {
    id: row.id,
    aggregationRunId: row.aggregation_run_id,
    snapshotKey: row.snapshot_key,
    storeId: row.store_id,
    status: row.status,
    sourceHealth: row.source_health,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
  };
}

function mapProposalRow(row) {
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    modelRunId: row.model_run_id,
    aggregationRunId: row.aggregation_run_id,
    snapshotKey: row.snapshot_key,
    storeId: row.store_id,
    lotId: row.lot_id,
    skuName: row.sku_name,
    proposalType: row.proposal_type,
    executionRoute: row.execution_route,
    recommendedDiscountPct: Number(row.recommended_discount_pct),
    proposedPrice: Number(row.proposed_price),
    status: row.status,
    rationale: row.rationale,
    metadata: parseJson(row.metadata_json, {}),
    modelRun: row.model_run_id
      ? {
          id: row.model_run_id,
          provider: row.model_run_provider ?? null,
          model: row.model_run_model ?? null,
          mode: row.model_run_mode ?? null,
          parseStatus: row.model_run_parse_status ?? null,
        }
      : null,
    createdAt: row.created_at,
  };
}

function mapModelRunRow(row) {
  return {
    id: row.id,
    agentRunId: row.agent_run_id,
    aggregationRunId: row.aggregation_run_id,
    snapshotKey: row.snapshot_key,
    storeId: row.store_id,
    actorUserId: row.actor_user_id,
    provider: row.provider,
    model: row.model,
    mode: row.rollout_mode,
    promptTemplateName: row.prompt_template_name,
    promptTemplateVersion: row.prompt_template_version,
    status: row.status,
    parseStatus: row.parse_status,
    retryCount: Number(row.retry_count ?? 0),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    estimatedCost: Number(row.estimated_cost ?? 0),
    usage: parseJson(row.usage_json, {}),
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function mapGuardrailRow(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    storeId: row.store_id,
    outcome: row.outcome,
    matchedRule: row.matched_rule,
    executionRoute: row.execution_route,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapApprovalRequestRow(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    storeId: row.store_id,
    status: row.status,
    matchedRule: row.matched_rule,
    requestedBy: row.requested_by,
    reviewedBy: row.reviewed_by,
    reviewNotes: row.review_notes ?? "",
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

function mapExecutionTaskRow(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    storeId: row.store_id,
    route: row.route,
    taskType: row.task_type,
    status: row.status,
    details: parseJson(row.details_json, {}),
    simulated: row.simulated,
    createdAt: row.created_at,
    dispatchedAt: row.dispatched_at,
  };
}

function mapSignalObservationRow(row) {
  return {
    id: row.id,
    aggregationRunId: row.aggregation_run_id,
    snapshotKey: row.snapshot_key,
    storeId: row.store_id,
    sourceType: row.source_type,
    sourceFamily: row.source_family,
    freshnessStatus: row.freshness_status,
    freshnessMinutes: Number(row.freshness_minutes),
    provenance: row.provenance,
    observedAt: row.observed_at,
    payload: parseJson(row.payload_json, {}),
  };
}

async function loadLatestAggregationRun(client, snapshotKey) {
  const result = await client.query(
    `
      SELECT id, snapshot_key, actor_user_id, status, summary_json, created_at
        FROM aggregation_runs
       WHERE snapshot_key = $1
       ORDER BY created_at DESC
       LIMIT 1
    `,
    [snapshotKey]
  );
  return result.rows.length ? mapAggregationRunRow(result.rows[0]) : null;
}

async function loadAggregationRunById(client, aggregationRunId) {
  const result = await client.query(
    `
      SELECT id, snapshot_key, actor_user_id, status, summary_json, created_at
        FROM aggregation_runs
       WHERE id = $1
       LIMIT 1
    `,
    [aggregationRunId]
  );
  return result.rows.length ? mapAggregationRunRow(result.rows[0]) : null;
}

async function loadAggregatedSnapshotsForRun(client, aggregationRunId) {
  const result = await client.query(
    `
      SELECT id, aggregation_run_id, snapshot_key, store_id, status, source_health, payload_json, created_at
        FROM aggregated_snapshots
       WHERE aggregation_run_id = $1
       ORDER BY store_id ASC
    `,
    [aggregationRunId]
  );
  return result.rows.map(mapAggregatedSnapshotRow);
}

async function loadSignalObservationsForRun(client, aggregationRunId, storeId = null) {
  const result = await client.query(
    `
      SELECT
        id,
        aggregation_run_id,
        snapshot_key,
        store_id,
        source_type,
        source_family,
        freshness_status,
        freshness_minutes,
        provenance,
        observed_at,
        payload_json
      FROM signal_observations
      WHERE aggregation_run_id = $1
        AND ($2::text IS NULL OR store_id = $2)
      ORDER BY store_id ASC, source_family ASC, source_type ASC
    `,
    [aggregationRunId, storeId]
  );
  return result.rows.map(mapSignalObservationRow);
}

async function loadLatestAgentRunForSnapshot(client, snapshotKey) {
  const result = await client.query(
    `
      SELECT id, aggregation_run_id, snapshot_key, actor_user_id, status, summary_json, created_at
        FROM agent_runs
       WHERE snapshot_key = $1
       ORDER BY created_at DESC
       LIMIT 1
    `,
    [snapshotKey]
  );
  if (!result.rows.length) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    aggregationRunId: row.aggregation_run_id,
    snapshotKey: row.snapshot_key,
    actorUserId: row.actor_user_id,
    status: row.status,
    summary: parseJson(row.summary_json, {}),
    createdAt: row.created_at,
  };
}

async function loadActivePromptTemplate(client, name = DEFAULT_PROMPT_TEMPLATE.NAME) {
  const result = await client.query(
    `
      SELECT id, name, version, system_prompt, developer_prompt, response_schema_json, is_active, created_at
      FROM prompt_templates
      WHERE name = $1
        AND is_active = TRUE
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [name]
  );

  if (!result.rows.length) {
    return getDefaultPromptTemplateRecord();
  }

  return mapPromptTemplateRow(result.rows[0]);
}

async function loadModelRunById(client, modelRunId) {
  const result = await client.query(
    `
      SELECT
        id,
        agent_run_id,
        aggregation_run_id,
        snapshot_key,
        store_id,
        actor_user_id,
        provider,
        model,
        rollout_mode,
        prompt_template_name,
        prompt_template_version,
        status,
        parse_status,
        retry_count,
        latency_ms,
        estimated_cost,
        usage_json,
        failure_code,
        failure_reason,
        created_at,
        completed_at
      FROM model_runs
      WHERE id = $1
      LIMIT 1
    `,
    [modelRunId]
  );
  return result.rows.length ? mapModelRunRow(result.rows[0]) : null;
}

async function loadLatestModelRunsForSnapshot(client, snapshotKey, storeId = null) {
  const result = await client.query(
    `
      SELECT DISTINCT ON (store_id)
        id,
        agent_run_id,
        aggregation_run_id,
        snapshot_key,
        store_id,
        actor_user_id,
        provider,
        model,
        rollout_mode,
        prompt_template_name,
        prompt_template_version,
        status,
        parse_status,
        retry_count,
        latency_ms,
        estimated_cost,
        usage_json,
        failure_code,
        failure_reason,
        created_at,
        completed_at
      FROM model_runs
      WHERE snapshot_key = $1
        AND ($2::text IS NULL OR store_id = $2)
      ORDER BY store_id ASC, created_at DESC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map(mapModelRunRow);
}

async function loadModelRunHistory(client, snapshotKey, storeId = null) {
  const result = await client.query(
    `
      SELECT
        id,
        agent_run_id,
        aggregation_run_id,
        snapshot_key,
        store_id,
        actor_user_id,
        provider,
        model,
        rollout_mode,
        prompt_template_name,
        prompt_template_version,
        status,
        parse_status,
        retry_count,
        latency_ms,
        estimated_cost,
        usage_json,
        failure_code,
        failure_reason,
        created_at,
        completed_at
      FROM model_runs
      WHERE snapshot_key = $1
        AND ($2::text IS NULL OR store_id = $2)
      ORDER BY created_at DESC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map(mapModelRunRow);
}

async function loadModelInputArtifact(client, modelRunId) {
  const result = await client.query(
    `
      SELECT id, model_run_id, prompt_context_json, request_json, created_at
      FROM model_input_artifacts
      WHERE model_run_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [modelRunId]
  );

  if (!result.rows.length) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    modelRunId: row.model_run_id,
    promptContext: parseJson(row.prompt_context_json, {}),
    request: parseJson(row.request_json, {}),
    createdAt: row.created_at,
  };
}

async function loadModelOutputArtifact(client, modelRunId) {
  const result = await client.query(
    `
      SELECT id, model_run_id, raw_output_text, raw_output_json, parsed_output_json, parse_status, error_code, error_message, created_at
      FROM model_output_artifacts
      WHERE model_run_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [modelRunId]
  );

  if (!result.rows.length) {
    return null;
  }
  const row = result.rows[0];
  return {
    id: row.id,
    modelRunId: row.model_run_id,
    rawText: row.raw_output_text ?? "",
    rawJson: parseJson(row.raw_output_json, null),
    parsedOutput: parseJson(row.parsed_output_json, null),
    parseStatus: row.parse_status,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

async function loadProposals(client, snapshotKey, storeId = null) {
  const result = await client.query(
    `
      SELECT
        ap.id,
        ap.agent_run_id,
        ap.model_run_id,
        ap.aggregation_run_id,
        ap.snapshot_key,
        ap.store_id,
        ap.lot_id,
        ap.sku_name,
        ap.proposal_type,
        ap.execution_route,
        ap.recommended_discount_pct,
        ap.proposed_price,
        ap.status,
        ap.rationale,
        ap.metadata_json,
        mr.provider AS model_run_provider,
        mr.model AS model_run_model,
        mr.rollout_mode AS model_run_mode,
        mr.parse_status AS model_run_parse_status,
        ap.created_at
      FROM action_proposals ap
      LEFT JOIN model_runs mr ON mr.id = ap.model_run_id
      WHERE ap.snapshot_key = $1
        AND ($2::text IS NULL OR ap.store_id = $2)
      ORDER BY ap.created_at DESC, ap.sku_name ASC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map(mapProposalRow);
}

async function loadProposalById(client, proposalId) {
  const result = await client.query(
    `
      SELECT
        id,
        agent_run_id,
        aggregation_run_id,
        snapshot_key,
        store_id,
        lot_id,
        sku_name,
        proposal_type,
        execution_route,
        recommended_discount_pct,
        proposed_price,
        status,
        rationale,
        metadata_json,
        created_at
      FROM action_proposals
      WHERE id = $1
      LIMIT 1
    `,
    [proposalId]
  );
  return result.rows.length ? mapProposalRow(result.rows[0]) : null;
}

async function loadGuardrailEvaluations(client, snapshotKey, storeId = null) {
  const result = await client.query(
    `
      SELECT
        ge.id,
        ge.proposal_id,
        ge.store_id,
        ge.outcome,
        ge.matched_rule,
        ge.execution_route,
        ge.reason,
        ge.status,
        ge.created_at
      FROM guardrail_evaluations ge
      JOIN action_proposals ap ON ap.id = ge.proposal_id
      WHERE ap.snapshot_key = $1
        AND ($2::text IS NULL OR ge.store_id = $2)
      ORDER BY ge.created_at DESC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map(mapGuardrailRow);
}

async function loadApprovalRequests(client, snapshotKey, storeId = null) {
  const result = await client.query(
    `
      SELECT
        ar.id,
        ar.proposal_id,
        ar.store_id,
        ar.status,
        ar.matched_rule,
        ar.requested_by,
        ar.reviewed_by,
        ar.review_notes,
        ar.created_at,
        ar.reviewed_at
      FROM approval_requests ar
      JOIN action_proposals ap ON ap.id = ar.proposal_id
      WHERE ap.snapshot_key = $1
        AND ($2::text IS NULL OR ar.store_id = $2)
      ORDER BY ar.created_at DESC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map(mapApprovalRequestRow);
}

async function loadExecutionTasks(client, snapshotKey, storeId = null, route = null) {
  const result = await client.query(
    `
      SELECT
        et.id,
        et.proposal_id,
        et.store_id,
        et.route,
        et.task_type,
        et.status,
        et.details_json,
        et.simulated,
        et.created_at,
        et.dispatched_at
      FROM execution_tasks et
      JOIN action_proposals ap ON ap.id = et.proposal_id
      WHERE ap.snapshot_key = $1
        AND ($2::text IS NULL OR et.store_id = $2)
        AND ($3::text IS NULL OR et.route = $3)
      ORDER BY et.created_at DESC
    `,
    [snapshotKey, storeId, route]
  );
  return result.rows.map(mapExecutionTaskRow);
}

async function loadExecutionTaskById(client, taskId) {
  const result = await client.query(
    `
      SELECT id, proposal_id, store_id, route, task_type, status, details_json, simulated, created_at, dispatched_at
      FROM execution_tasks
      WHERE id = $1
      LIMIT 1
    `,
    [taskId]
  );
  return result.rows.length ? mapExecutionTaskRow(result.rows[0]) : null;
}

async function loadLogisticsRoutes(client, snapshotKey, storeId = null) {
  const result = await client.query(
    `
      SELECT
        lr.id,
        lr.execution_task_id,
        lr.store_id,
        lr.route_type,
        lr.destination,
        lr.status,
        lr.created_at
      FROM logistics_routes lr
      JOIN execution_tasks et ON et.id = lr.execution_task_id
      JOIN action_proposals ap ON ap.id = et.proposal_id
      WHERE ap.snapshot_key = $1
        AND ($2::text IS NULL OR lr.store_id = $2)
      ORDER BY lr.created_at DESC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    executionTaskId: row.execution_task_id,
    storeId: row.store_id,
    routeType: row.route_type,
    destination: row.destination,
    status: row.status,
    createdAt: row.created_at,
  }));
}

async function loadProcurementOrders(client, snapshotKey, storeId = null) {
  const result = await client.query(
    `
      SELECT
        po.id,
        po.execution_task_id,
        po.store_id,
        po.supplier,
        po.quantity,
        po.estimated_cost,
        po.status,
        po.created_at
      FROM procurement_orders po
      JOIN execution_tasks et ON et.id = po.execution_task_id
      JOIN action_proposals ap ON ap.id = et.proposal_id
      WHERE ap.snapshot_key = $1
        AND ($2::text IS NULL OR po.store_id = $2)
      ORDER BY po.created_at DESC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    executionTaskId: row.execution_task_id,
    storeId: row.store_id,
    supplier: row.supplier,
    quantity: Number(row.quantity),
    estimatedCost: Number(row.estimated_cost),
    status: row.status,
    createdAt: row.created_at,
  }));
}

async function clearControlTowerSnapshotState(client, snapshotKey, storeIds = null) {
  const proposalResult = await client.query(
    `
      SELECT id
      FROM action_proposals
      WHERE snapshot_key = $1
        AND ($2::text[] IS NULL OR store_id = ANY($2::text[]))
    `,
    [snapshotKey, storeIds]
  );
  const proposalIds = proposalResult.rows.map((row) => row.id);
  if (!proposalIds.length) {
    return;
  }

  const taskResult = await client.query(
    `SELECT id FROM execution_tasks WHERE proposal_id = ANY($1::text[])`,
    [proposalIds]
  );
  const taskIds = taskResult.rows.map((row) => row.id);

  if (taskIds.length) {
    await client.query(`DELETE FROM logistics_routes WHERE execution_task_id = ANY($1::text[])`, [
      taskIds,
    ]);
    await client.query(`DELETE FROM procurement_orders WHERE execution_task_id = ANY($1::text[])`, [
      taskIds,
    ]);
  }

  await client.query(`DELETE FROM approval_requests WHERE proposal_id = ANY($1::text[])`, [
    proposalIds,
  ]);
  await client.query(`DELETE FROM guardrail_evaluations WHERE proposal_id = ANY($1::text[])`, [
    proposalIds,
  ]);
  await client.query(`DELETE FROM execution_tasks WHERE proposal_id = ANY($1::text[])`, [
    proposalIds,
  ]);
  await client.query(`DELETE FROM action_proposals WHERE id = ANY($1::text[])`, [proposalIds]);
}

async function persistAggregationArtifacts(client, { snapshotKey, actorUserId, payload }) {
  const stores = await loadStores(client);
  const signalObservations = buildSignalObservations({ snapshotKey, stores, payload });
  const aggregatedSnapshots = buildAggregatedSnapshots({
    stores,
    payload,
    signalObservations,
  });
  const aggregationRunId = crypto.randomUUID();
  const createdAt = now();
  const summary = buildAggregationRunSummary({
    snapshotKey,
    signalObservations,
    aggregatedSnapshots,
  });

  await client.query(
    `
      INSERT INTO aggregation_runs (id, snapshot_key, actor_user_id, status, summary_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [aggregationRunId, snapshotKey, actorUserId, "completed", JSON.stringify(summary), createdAt]
  );

  await insertRows(
    client,
    "signal_observations",
    [
      "id",
      "aggregation_run_id",
      "snapshot_key",
      "store_id",
      "source_type",
      "source_family",
      "freshness_status",
      "freshness_minutes",
      "provenance",
      "observed_at",
      "payload_json",
    ],
    signalObservations,
    (observation) => [
      crypto.randomUUID(),
      aggregationRunId,
      observation.snapshotKey,
      observation.storeId,
      observation.sourceType,
      observation.sourceFamily,
      observation.freshnessStatus,
      observation.freshnessMinutes,
      observation.provenance,
      observation.observedAt,
      JSON.stringify(observation.payload),
    ]
  );

  await insertRows(
    client,
    "aggregated_snapshots",
    [
      "id",
      "aggregation_run_id",
      "snapshot_key",
      "store_id",
      "status",
      "source_health",
      "payload_json",
      "created_at",
    ],
    aggregatedSnapshots,
    (snapshot) => [
      crypto.randomUUID(),
      aggregationRunId,
      snapshotKey,
      snapshot.storeId,
      "ready",
      snapshot.sourceHealth,
      JSON.stringify(snapshot),
      createdAt,
    ]
  );

  const actor =
    (await loadUserById(client, actorUserId))?.name ??
    (await loadDefaultSessionUser(client))?.name ??
    "SynaptOS";

  await insertAuditEvent(client, {
    type: AUDIT_TYPES.AGGREGATION,
    storeId: null,
    actor,
    actorUserId,
    message: "Control-tower aggregation completed",
    details: `${aggregatedSnapshots.length} store snapshots assembled from ${signalObservations.length} source observations.`,
    createdAt,
  });

  return {
    aggregationRun: {
      id: aggregationRunId,
      snapshotKey,
      actorUserId,
      status: "completed",
      summary,
      createdAt,
    },
    signalObservations,
    aggregatedSnapshots,
  };
}

async function persistExecutionTask(client, executionTaskDraft) {
  const taskId = crypto.randomUUID();
  const createdAt = now();

  await client.query(
    `
      INSERT INTO execution_tasks
        (id, proposal_id, store_id, route, task_type, status, details_json, simulated, created_at, dispatched_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      taskId,
      executionTaskDraft.proposalId,
      executionTaskDraft.storeId,
      executionTaskDraft.route,
      executionTaskDraft.taskType,
      executionTaskDraft.status,
      JSON.stringify(executionTaskDraft),
      executionTaskDraft.simulated ?? true,
      createdAt,
      executionTaskDraft.status === TASK_STATUSES.DISPATCHED ? createdAt : null,
    ]
  );

  if (executionTaskDraft.logisticsRoute) {
    await client.query(
      `
        INSERT INTO logistics_routes
          (id, execution_task_id, store_id, route_type, destination, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        crypto.randomUUID(),
        taskId,
        executionTaskDraft.storeId,
        executionTaskDraft.logisticsRoute.routeType,
        executionTaskDraft.logisticsRoute.destination,
        executionTaskDraft.status,
        createdAt,
      ]
    );
  }

  if (executionTaskDraft.procurementOrder) {
    await client.query(
      `
        INSERT INTO procurement_orders
          (id, execution_task_id, store_id, supplier, quantity, estimated_cost, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        crypto.randomUUID(),
        taskId,
        executionTaskDraft.storeId,
        executionTaskDraft.procurementOrder.supplier,
        executionTaskDraft.procurementOrder.quantity,
        executionTaskDraft.procurementOrder.estimatedCost,
        executionTaskDraft.status,
        createdAt,
      ]
    );
  }

  if (executionTaskDraft.labelUpdate) {
    await upsertLabels(client, {
      [executionTaskDraft.labelUpdate.lotId]: {
        currentPrice: executionTaskDraft.labelUpdate.currentPrice,
        previousPrice: executionTaskDraft.labelUpdate.previousPrice,
        status: "published",
        recommendationId: executionTaskDraft.proposalId,
        updatedAt: createdAt,
      },
    });
  }

  return { ...executionTaskDraft, id: taskId, createdAt, dispatchedAt: createdAt };
}

async function persistAgentArtifacts(client, { snapshotKey, aggregationRunId, actorUserId }) {
  const aggregationSnapshots = await loadAggregatedSnapshotsForRun(client, aggregationRunId);
  const storePolicies = await loadStores(client);
  const promptTemplate = await loadActivePromptTemplate(client);
  const agentRunId = crypto.randomUUID();
  const createdAt = now();
  const agentResult = await buildAgentRunResult({
    aggregationRunId,
    snapshotKey,
    aggregatedSnapshots: aggregationSnapshots.map((snapshot) => snapshot.payload),
    storePolicies,
    promptTemplate,
  });

  await client.query(
    `
      INSERT INTO agent_runs (id, aggregation_run_id, snapshot_key, actor_user_id, status, summary_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      agentRunId,
      aggregationRunId,
      snapshotKey,
      actorUserId,
      agentResult.summary.failedModelRuns === agentResult.summary.modelRunCount ? "failed" : "completed",
      JSON.stringify(agentResult.summary),
      createdAt,
    ]
  );

  const actor =
    (await loadUserById(client, actorUserId))?.name ??
    (await loadDefaultSessionUser(client))?.name ??
    "SynaptOS";

  const modelRuns = [];
  const proposals = [];
  const guardrailEvaluations = [];
  const approvalRequests = [];
  const executionTasks = [];

  for (const draftModelRun of agentResult.modelRuns) {
    const modelRunId = crypto.randomUUID();
    const modelRun = {
      ...draftModelRun,
      id: modelRunId,
      agentRunId,
    };

    await client.query(
      `
        INSERT INTO model_runs
          (id, agent_run_id, aggregation_run_id, snapshot_key, store_id, actor_user_id, provider, model,
           rollout_mode, prompt_template_name, prompt_template_version, status, parse_status, retry_count,
           latency_ms, estimated_cost, usage_json, failure_code, failure_reason, created_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      `,
      [
        modelRun.id,
        agentRunId,
        aggregationRunId,
        snapshotKey,
        modelRun.storeId,
        actorUserId,
        modelRun.provider,
        modelRun.model,
        modelRun.mode,
        modelRun.promptTemplateName,
        modelRun.promptTemplateVersion,
        modelRun.status,
        modelRun.parseStatus,
        modelRun.retryCount,
        modelRun.latencyMs,
        modelRun.estimatedCost,
        JSON.stringify(modelRun.usage),
        modelRun.failureCode,
        modelRun.failureReason,
        modelRun.createdAt,
        modelRun.completedAt,
      ]
    );

    await client.query(
      `
        INSERT INTO model_input_artifacts (id, model_run_id, prompt_context_json, request_json, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        crypto.randomUUID(),
        modelRun.id,
        JSON.stringify(modelRun.inputArtifact.promptContext),
        JSON.stringify(modelRun.inputArtifact.request),
        modelRun.createdAt,
      ]
    );

    await client.query(
      `
        INSERT INTO model_output_artifacts
          (id, model_run_id, raw_output_text, raw_output_json, parsed_output_json, parse_status, error_code, error_message, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        crypto.randomUUID(),
        modelRun.id,
        modelRun.outputArtifact.rawText,
        modelRun.outputArtifact.rawJson == null ? null : JSON.stringify(modelRun.outputArtifact.rawJson),
        modelRun.outputArtifact.parsedOutput == null
          ? null
          : JSON.stringify(modelRun.outputArtifact.parsedOutput),
        modelRun.outputArtifact.parseStatus,
        modelRun.outputArtifact.errorCode,
        modelRun.outputArtifact.errorMessage,
        modelRun.createdAt,
      ]
    );

    modelRuns.push(modelRun);

    await insertAuditEvent(client, {
      type: AUDIT_TYPES.MODEL_RUN,
      storeId: modelRun.storeId,
      actor,
      actorUserId,
      message:
        modelRun.status === MODEL_RUN_STATUSES.COMPLETED
          ? `Model run completed for ${modelRun.storeId}`
          : `Model run failed for ${modelRun.storeId}`,
      details:
        modelRun.status === MODEL_RUN_STATUSES.COMPLETED
          ? `${modelRun.provider}/${modelRun.model} ran in ${modelRun.mode} mode with parse status ${modelRun.parseStatus}.`
          : `${modelRun.failureCode ?? "PROVIDER_FAILED"}: ${modelRun.failureReason ?? "unknown provider failure"}`,
      createdAt: modelRun.createdAt,
    });
  }

  const hasUsableModelRun = modelRuns.some((modelRun) => modelRun.status !== MODEL_RUN_STATUSES.FAILED);
  if (hasUsableModelRun) {
    await clearControlTowerSnapshotState(
      client,
      snapshotKey,
      modelRuns
        .filter((modelRun) => modelRun.status !== MODEL_RUN_STATUSES.FAILED)
        .map((modelRun) => modelRun.storeId)
    );
  }

  for (const modelRun of modelRuns) {
    if (modelRun.status === MODEL_RUN_STATUSES.FAILED) {
      continue;
    }

    const storeSnapshot = aggregationSnapshots.find(
      (snapshot) => snapshot.storeId === modelRun.storeId
    )?.payload;
    const storePolicy = storePolicies.find((store) => store.id === modelRun.storeId);

    for (const draft of modelRun.proposals) {
      const proposalId = crypto.randomUUID();
      const guardrail = evaluateProposal({
        proposal: { ...draft, id: proposalId },
        storePolicy,
        sourceHealth: storeSnapshot?.sourceHealth ?? "healthy",
      });

      const status =
        guardrail.outcome === GUARDRAIL_OUTCOMES.REQUIRES_APPROVAL
          ? PROPOSAL_STATUSES.PENDING_APPROVAL
          : guardrail.outcome === GUARDRAIL_OUTCOMES.BLOCKED
            ? PROPOSAL_STATUSES.BLOCKED
            : PROPOSAL_STATUSES.APPROVED;

      const proposal = {
        ...draft,
        id: proposalId,
        agentRunId,
        modelRunId: modelRun.id,
        aggregationRunId,
        snapshotKey,
        status,
        metadata: {
          ...draft.metadata,
          basePrice: draft.metadata.basePrice ?? draft.proposedPrice,
          provider: modelRun.provider,
          model: modelRun.model,
          mode: modelRun.mode,
          parseStatus: modelRun.parseStatus,
        },
        createdAt,
      };

      await client.query(
        `
          INSERT INTO action_proposals
            (id, agent_run_id, model_run_id, aggregation_run_id, snapshot_key, store_id, lot_id, sku_name, proposal_type,
             execution_route, recommended_discount_pct, proposed_price, status, rationale, metadata_json, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `,
        [
          proposal.id,
          agentRunId,
          modelRun.id,
          aggregationRunId,
          snapshotKey,
          proposal.storeId,
          proposal.lotId,
          proposal.skuName,
          proposal.proposalType,
          proposal.executionRoute,
          proposal.recommendedDiscountPct,
          proposal.proposedPrice,
          proposal.status,
          proposal.rationale,
          JSON.stringify(proposal.metadata),
          createdAt,
        ]
      );
      proposals.push(proposal);

      const guardrailRecord = {
        id: crypto.randomUUID(),
        proposalId: proposal.id,
        storeId: proposal.storeId,
        outcome: guardrail.outcome,
        matchedRule: guardrail.matchedRule,
        executionRoute: guardrail.executionRoute,
        reason: guardrail.reason,
        status: guardrail.executionStatus,
        createdAt,
      };
      await client.query(
        `
          INSERT INTO guardrail_evaluations
            (id, proposal_id, store_id, outcome, matched_rule, execution_route, reason, status, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          guardrailRecord.id,
          guardrailRecord.proposalId,
          guardrailRecord.storeId,
          guardrailRecord.outcome,
          guardrailRecord.matchedRule,
          guardrailRecord.executionRoute,
          guardrailRecord.reason,
          guardrailRecord.status,
          createdAt,
        ]
      );
      guardrailEvaluations.push(guardrailRecord);

      if (guardrail.outcome === GUARDRAIL_OUTCOMES.REQUIRES_APPROVAL) {
        const approvalRequest = {
          id: crypto.randomUUID(),
          ...createApprovalRequestDraft({
            proposal,
            evaluation: guardrailRecord,
            actorUserId,
          }),
          createdAt,
          reviewedAt: null,
          reviewedBy: null,
          reviewNotes: "",
        };
        await client.query(
          `
            INSERT INTO approval_requests
              (id, proposal_id, store_id, status, matched_rule, requested_by, reviewed_by, review_notes, created_at, reviewed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `,
          [
            approvalRequest.id,
            approvalRequest.proposalId,
            approvalRequest.storeId,
            approvalRequest.status,
            approvalRequest.matchedRule,
            approvalRequest.requestedBy,
            null,
            "",
            createdAt,
            null,
          ]
        );
        approvalRequests.push(approvalRequest);
        continue;
      }

      if (guardrail.outcome === GUARDRAIL_OUTCOMES.BLOCKED) {
        continue;
      }

      const executionDraft =
        proposal.proposalType === "markdown"
          ? buildLabelExecution({ proposal })
          : proposal.proposalType === "unsaleable"
            ? buildLogisticsExecution({ proposal })
            : buildProcurementExecution({ proposal });
      const task = await persistExecutionTask(client, executionDraft);
      executionTasks.push(task);
    }
  }

  await insertAuditEvent(client, {
    type: AUDIT_TYPES.PROPOSAL_GENERATION,
    storeId: null,
    actor,
    actorUserId,
    message: "Control-tower proposal generation completed",
    details: `${proposals.length} proposals generated and ${executionTasks.length} execution tasks created from ${modelRuns.length} model runs.`,
    createdAt,
  });

  for (const evaluation of guardrailEvaluations) {
    await insertAuditEvent(client, {
      type: AUDIT_TYPES.GUARDRAIL,
      storeId: evaluation.storeId,
      actor,
      actorUserId,
      message: `Guardrail ${evaluation.outcome} for proposal ${evaluation.proposalId}`,
      details: `${evaluation.matchedRule}: ${evaluation.reason}`,
      createdAt,
    });
  }

  for (const task of executionTasks) {
    const routeLabel = task.route === EXECUTION_ROUTES.LABEL
      ? "virtual label"
      : task.route === EXECUTION_ROUTES.LOGISTICS
        ? "simulated logistics"
        : "simulated procurement";
    await insertAuditEvent(client, {
      type: AUDIT_TYPES.EXECUTION,
      storeId: task.storeId,
      actor,
      actorUserId,
      message: `Execution created on ${task.route}`,
      details: `Task ${task.id} entered the ${routeLabel} route with status ${task.status}.`,
      createdAt,
    });
  }

  return {
    agentRun: {
      id: agentRunId,
      aggregationRunId,
      snapshotKey,
      actorUserId,
      status:
        agentResult.summary.failedModelRuns === agentResult.summary.modelRunCount ? "failed" : "completed",
      summary: agentResult.summary,
      createdAt,
    },
    modelRuns,
    proposals,
    guardrailEvaluations,
    approvalRequests,
    executionTasks,
  };
}

function filterByUserStore(items, user) {
  if (!user || user.role === "admin") {
    return items;
  }
  return items.filter((item) => item.storeId === user.storeId);
}

function summarizeProposalState(proposals, guardrailEvaluations, approvalRequests, executionTasks) {
  const guardrailByProposalId = Object.fromEntries(
    guardrailEvaluations.map((evaluation) => [evaluation.proposalId, evaluation])
  );
  const approvalByProposalId = Object.fromEntries(
    approvalRequests.map((request) => [request.proposalId, request])
  );
  const taskByProposalId = Object.fromEntries(
    executionTasks.map((task) => [task.proposalId, task])
  );

  return proposals.map((proposal) => ({
    ...proposal,
    guardrail: guardrailByProposalId[proposal.id] ?? null,
    approvalRequest: approvalByProposalId[proposal.id] ?? null,
    executionTask: taskByProposalId[proposal.id] ?? null,
  }));
}

export async function getRuntimeSelection(storeId, user = null) {
  await ensureInitialized();
  const stores = await loadStores(getPool());
  const selectedStore =
    stores.find((store) => store.id === storeId) ??
    stores.find((store) => store.id === user?.storeId) ??
    stores[0] ??
    null;

  if (!selectedStore) {
    return { mode: LEGACY_MODE, enabled: false, llmMode: LLM_ROLLOUT_MODES.DISABLED };
  }

  return {
    mode: selectedStore.controlTowerEnabled ? CONTROL_TOWER_MODE : LEGACY_MODE,
    enabled: selectedStore.controlTowerEnabled,
    storeId: selectedStore.id,
    llmMode: selectedStore.llmMode ?? LLM_ROLLOUT_MODES.SHADOW,
  };
}

export async function runAggregationForSnapshot(snapshotKey, actorUserId, user = null) {
  const result = await withTransaction(async (client) => {
    const payload = await computePayload(client, snapshotKey);
    return persistAggregationArtifacts(client, { snapshotKey, actorUserId, payload });
  });

  publishAggregationCompleted({
    snapshotKey,
    aggregationRunId: result.aggregationRun.id,
    storeCount: result.aggregatedSnapshots.length,
  });

  return {
    ...result,
    signalObservations: filterByUserStore(result.signalObservations, user),
    aggregatedSnapshots: filterByUserStore(result.aggregatedSnapshots, user),
  };
}

export async function getAggregationRunDetail(aggregationRunId, user = null) {
  await ensureInitialized();
  const client = getPool();
  const aggregationRun = await loadAggregationRunById(client, aggregationRunId);
  if (!aggregationRun) {
    return null;
  }

  const aggregatedSnapshots = await loadAggregatedSnapshotsForRun(client, aggregationRunId);
  const visibleSnapshots = filterByUserStore(aggregatedSnapshots, user);
  const visibleStoreIds = new Set(visibleSnapshots.map((snapshot) => snapshot.storeId));
  const signalObservations = (await loadSignalObservationsForRun(client, aggregationRunId)).filter(
    (observation) => visibleStoreIds.has(observation.storeId)
  );

  return {
    aggregationRun,
    signalObservations,
    aggregatedSnapshots: visibleSnapshots,
  };
}

export async function runAgentPipeline(snapshotKey, actorUserId, user = null) {
  const result = await withTransaction(async (client) => {
    const aggregationRun = await loadLatestAggregationRun(client, snapshotKey);
    const readyAggregation =
      aggregationRun ??
      (await persistAggregationArtifacts(client, {
        snapshotKey,
        actorUserId,
        payload: await computePayload(client, snapshotKey),
      })).aggregationRun;

    return persistAgentArtifacts(client, {
      snapshotKey,
      aggregationRunId: readyAggregation.id,
      actorUserId,
    });
  });

  publishAgentCompleted({
    snapshotKey,
    agentRunId: result.agentRun.id,
    proposalCount: result.proposals.length,
  });
  publishProposalUpdated({
    snapshotKey,
    proposalCount: result.proposals.length,
  });
  if (result.approvalRequests.length) {
    publishApprovalUpdated({
      snapshotKey,
      pendingApprovals: result.approvalRequests.length,
    });
  }
  if (result.executionTasks.length) {
    publishExecutionUpdated({
      snapshotKey,
      taskCount: result.executionTasks.length,
    });
  }
  for (const modelRun of result.modelRuns) {
    publishModelRunUpdated({
      snapshotKey,
      modelRunId: modelRun.id,
      storeId: modelRun.storeId,
      status: modelRun.status,
      parseStatus: modelRun.parseStatus,
      provider: modelRun.provider,
      model: modelRun.model,
      mode: modelRun.mode,
    });
  }

  return {
    ...result,
    modelRuns: filterByUserStore(result.modelRuns, user),
    proposals: filterByUserStore(result.proposals, user),
    guardrailEvaluations: filterByUserStore(result.guardrailEvaluations, user),
    approvalRequests: filterByUserStore(result.approvalRequests, user),
    executionTasks: filterByUserStore(result.executionTasks, user),
  };
}

export async function listControlTowerStores(user) {
  await ensureInitialized();
  const client = getPool();
  const stores = await getAccessibleStores(user);
  const latestSnapshot = (await loadSnapshots(client)).at(-1) ?? null;
  const latestModelRuns = latestSnapshot
    ? await loadLatestModelRunsForSnapshot(client, latestSnapshot)
    : [];
  const proposals = latestSnapshot ? await loadProposals(client, latestSnapshot) : [];
  const approvals = latestSnapshot ? await loadApprovalRequests(client, latestSnapshot) : [];
  const logistics = latestSnapshot
    ? await loadExecutionTasks(client, latestSnapshot, null, EXECUTION_ROUTES.LOGISTICS)
    : [];
  const procurement = latestSnapshot
    ? await loadExecutionTasks(client, latestSnapshot, null, EXECUTION_ROUTES.PROCUREMENT)
    : [];
  const latestAggregation = latestSnapshot ? await loadLatestAggregationRun(client, latestSnapshot) : null;

  return stores.map((store) => ({
    id: store.id,
    name: store.name,
    pendingApprovals: approvals.filter(
      (request) => request.storeId === store.id && request.status === "pending"
    ).length,
    queuedLogisticsTasks: logistics.filter((task) => task.storeId === store.id).length,
    queuedProcurementOrders: procurement.filter((task) => task.storeId === store.id).length,
    proposalCount: proposals.filter((proposal) => proposal.storeId === store.id).length,
    lastAggregationAt: latestAggregation?.createdAt ?? null,
    controlTowerEnabled: store.controlTowerEnabled,
    simulatedIntegrations: store.simulatedIntegrations,
    llmMode: store.llmMode,
    latestModelRun:
      latestModelRuns.find((modelRun) => modelRun.storeId === store.id) ?? null,
  }));
}

export async function getStoreControlTowerDetail({ storeId, snapshotKey, user }) {
  await ensureInitialized();
  const client = getPool();
  const runtime = await getRuntimeSelection(storeId, user);
  const targetSnapshotKey = snapshotKey ?? (await loadSnapshots(client)).at(-1) ?? null;

  if (!targetSnapshotKey) {
    return {
      storeId,
      mode: runtime.mode,
      llmMode: runtime.llmMode,
      snapshotKey: null,
      aggregationRun: null,
      latestModelRun: null,
      modelRunHistory: [],
      sourceObservations: [],
      aggregatedSnapshot: null,
      proposals: [],
      approvals: [],
      logisticsTasks: [],
      procurementOrders: [],
      labels: {},
      audit: [],
    };
  }

  const aggregationRun = await loadLatestAggregationRun(client, targetSnapshotKey);
  const aggregatedSnapshot = aggregationRun
    ? (await loadAggregatedSnapshotsForRun(client, aggregationRun.id)).find(
        (snapshot) => snapshot.storeId === storeId
      ) ?? null
    : null;
  const sourceObservations = aggregationRun
    ? await loadSignalObservationsForRun(client, aggregationRun.id, storeId)
    : [];
  const modelRunHistory = await loadModelRunHistory(client, targetSnapshotKey, storeId);
  const latestModelRun = modelRunHistory[0] ?? null;
  const proposals = await loadProposals(client, targetSnapshotKey, storeId);
  const guardrailEvaluations = await loadGuardrailEvaluations(client, targetSnapshotKey, storeId);
  const approvals = await loadApprovalRequests(client, targetSnapshotKey, storeId);
  const executionTasks = await loadExecutionTasks(client, targetSnapshotKey, storeId);
  const logisticsTasks = await loadLogisticsRoutes(client, targetSnapshotKey, storeId);
  const procurementOrders = await loadProcurementOrders(client, targetSnapshotKey, storeId);
  const labels = await listLabels(storeId);
  const audit = await listAuditEvents(storeId);

  return {
    storeId,
    mode: runtime.mode,
    llmMode: runtime.llmMode,
    snapshotKey: targetSnapshotKey,
    aggregationRun,
    latestModelRun,
    modelRunHistory,
    sourceObservations,
    aggregatedSnapshot,
    proposals: summarizeProposalState(proposals, guardrailEvaluations, approvals, executionTasks),
    approvals,
    logisticsTasks,
    procurementOrders,
    executionTasks,
    labels,
    audit,
    simulated: true,
  };
}

export async function getModelRunDetail(modelRunId, user = null) {
  await ensureInitialized();
  const client = getPool();
  const modelRun = await loadModelRunById(client, modelRunId);
  if (!modelRun) {
    return null;
  }
  if (user && user.role !== "admin" && user.storeId && user.storeId !== modelRun.storeId) {
    throw createStoreAccessError();
  }

  const [inputArtifact, outputArtifact] = await Promise.all([
    loadModelInputArtifact(client, modelRunId),
    loadModelOutputArtifact(client, modelRunId),
  ]);

  return {
    modelRun,
    inputArtifact,
    outputArtifact,
  };
}

export async function listControlTowerProposals({ snapshotKey, user, storeId = null }) {
  await ensureInitialized();
  const client = getPool();
  const targetSnapshot = snapshotKey ?? (await loadSnapshots(client)).at(-1);
  if (!targetSnapshot) {
    return [];
  }
  const effectiveStoreId = user?.role === "admin" ? storeId : user?.storeId ?? storeId;
  const proposals = await loadProposals(client, targetSnapshot, effectiveStoreId);
  const guardrails = await loadGuardrailEvaluations(client, targetSnapshot, effectiveStoreId);
  const approvals = await loadApprovalRequests(client, targetSnapshot, effectiveStoreId);
  const tasks = await loadExecutionTasks(client, targetSnapshot, effectiveStoreId);
  return summarizeProposalState(proposals, guardrails, approvals, tasks);
}

export async function reviewControlTowerProposal({
  proposalId,
  decision,
  reviewNotes = "",
  user,
}) {
  const result = await withTransaction(async (client) => {
    const proposal = await loadProposalById(client, proposalId);
    if (!proposal) {
      const error = new Error("NOT_FOUND");
      error.code = "NOT_FOUND";
      throw error;
    }

    const currentApprovalResult = await client.query(
      `
        SELECT id, proposal_id, store_id, status, matched_rule, requested_by, reviewed_by, review_notes, created_at, reviewed_at
        FROM approval_requests
        WHERE proposal_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [proposalId]
    );
    const approvalRequest = currentApprovalResult.rows.length
      ? mapApprovalRequestRow(currentApprovalResult.rows[0])
      : null;

    if (!approvalRequest) {
      const error = new Error("NOT_FOUND");
      error.code = "NOT_FOUND";
      throw error;
    }

    const reviewedAt = now();
    await client.query(
      `
        UPDATE approval_requests
           SET status = $2,
               reviewed_by = $3,
               review_notes = $4,
               reviewed_at = $5
         WHERE id = $1
      `,
      [approvalRequest.id, decision, user.id, reviewNotes, reviewedAt]
    );

    await client.query(`UPDATE action_proposals SET status = $2 WHERE id = $1`, [
      proposalId,
      decision === "approved" ? PROPOSAL_STATUSES.APPROVED : PROPOSAL_STATUSES.REJECTED,
    ]);

    let executionTask = null;
    if (decision === "approved") {
      const handoff = buildApprovalDispatchResult({ proposal, approvalStatus: "approved" });
      if (handoff.status === TASK_STATUSES.READY) {
        executionTask = await persistExecutionTask(client, {
          ...buildLabelExecution({ proposal }),
          status: TASK_STATUSES.READY,
        });
      }
    }

    await insertAuditEvent(client, {
      type: AUDIT_TYPES.APPROVAL,
      storeId: proposal.storeId,
      actor: user.name,
      actorUserId: user.id,
      message: `Proposal ${decision}`,
      details: reviewNotes || `Proposal ${proposalId} was ${decision}.`,
      createdAt: reviewedAt,
    });

    return {
      proposal: { ...proposal, status: decision === "approved" ? PROPOSAL_STATUSES.APPROVED : PROPOSAL_STATUSES.REJECTED },
      approvalRequest: {
        ...approvalRequest,
        status: decision,
        reviewedBy: user.id,
        reviewNotes,
        reviewedAt,
      },
      executionTask,
    };
  });

  publishApprovalUpdated({
    proposalId,
    decision,
  });

  return result;
}

export async function dispatchControlTowerTask({ taskId, user }) {
  const result = await withTransaction(async (client) => {
    const task = await loadExecutionTaskById(client, taskId);
    if (!task) {
      const error = new Error("NOT_FOUND");
      error.code = "NOT_FOUND";
      throw error;
    }

    const dispatchedAt = now();
    await client.query(
      `
        UPDATE execution_tasks
           SET status = $2,
               dispatched_at = $3
         WHERE id = $1
      `,
      [taskId, TASK_STATUSES.DISPATCHED, dispatchedAt]
    );

    if (task.route === EXECUTION_ROUTES.LOGISTICS) {
      await client.query(
        `UPDATE logistics_routes SET status = $2 WHERE execution_task_id = $1`,
        [taskId, TASK_STATUSES.DISPATCHED]
      );
    }

    if (task.route === EXECUTION_ROUTES.PROCUREMENT) {
      await client.query(
        `UPDATE procurement_orders SET status = $2 WHERE execution_task_id = $1`,
        [taskId, TASK_STATUSES.DISPATCHED]
      );
    }

    if (task.route === EXECUTION_ROUTES.LABEL && task.details?.labelUpdate) {
      await upsertLabels(client, {
        [task.details.labelUpdate.lotId]: {
          currentPrice: task.details.labelUpdate.currentPrice,
          previousPrice: task.details.labelUpdate.previousPrice,
          status: "published",
          recommendationId: task.proposalId,
          updatedAt: dispatchedAt,
        },
      });
    }

    await insertAuditEvent(client, {
      type: AUDIT_TYPES.EXECUTION,
      storeId: task.storeId,
      actor: user.name,
      actorUserId: user.id,
      message: `${task.route} task dispatched`,
      details: `Execution task ${task.id} dispatched by ${user.role}.`,
      createdAt: dispatchedAt,
    });

    return { ...task, status: TASK_STATUSES.DISPATCHED, dispatchedAt };
  });

  publishExecutionUpdated({
    taskId,
    route: result.route,
  });
  if (result.route === EXECUTION_ROUTES.LOGISTICS) {
    publishLogisticsUpdated({ taskId });
  }
  if (result.route === EXECUTION_ROUTES.PROCUREMENT) {
    publishProcurementUpdated({ taskId });
  }

  return result;
}

export async function listLogisticsWorkbench({ snapshotKey, user }) {
  await ensureInitialized();
  const client = getPool();
  const targetSnapshot = snapshotKey ?? (await loadSnapshots(client)).at(-1);
  if (!targetSnapshot) {
    return [];
  }
  return loadLogisticsRoutes(client, targetSnapshot, user?.role === "admin" ? null : user?.storeId);
}

export async function listProcurementWorkbench({ snapshotKey, user }) {
  await ensureInitialized();
  const client = getPool();
  const targetSnapshot = snapshotKey ?? (await loadSnapshots(client)).at(-1);
  if (!targetSnapshot) {
    return [];
  }
  return loadProcurementOrders(client, targetSnapshot, user?.role === "admin" ? null : user?.storeId);
}
