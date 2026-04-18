import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

const DEFAULT_IMPORT_SOURCE = "baseline_csv";
const DEFAULT_POSTGRES_CONFIG = {
  host: "localhost",
  port: "5432",
  database: "synaptos_v2",
  user: "synaptos",
  password: "synaptos",
};
const BATCH_SIZE = 250;
const LIVE_MOCK_SETTINGS_KEY = "liveMockCatalog";
const REALTIME_OUTBOX_SETTINGS_KEY = "realtimeOutbox";
const LIVE_MOCK_TTL_MS = 5 * 60 * 1000;
const CANONICAL_EXPORT_DIR = path.join(process.cwd(), "data", "normalized");
const CANONICAL_EXPORT_FILENAME = "synaptos-canonical-normalized.csv";
const globalScope = globalThis;
const BASELINE_CSV_CANDIDATES = [
  path.join(process.env.USERPROFILE ?? process.cwd(), "Downloads", "SynaptOS_Data - SynaptOS_Baseline_Final_v4.csv"),
  path.join(process.cwd(), "SynaptOS_Data - SynaptOS_Baseline_Final_v4.csv"),
  path.join(process.cwd(), "SynaptOS_Data - SynaptOS_Final_Master_V12.csv"),
  path.join(process.env.USERPROFILE ?? process.cwd(), "Downloads", "SynaptOS_Data - SynaptOS_Final_Master_V12.csv"),
  process.env.SYNAPTOS_BASELINE_CSV_PATH,
].filter(Boolean);

function now() {
  return new Date().toISOString();
}

function inferRealtimeDiscountPct(currentPrice, originalPrice, fallback = null) {
  const current = Number(currentPrice ?? 0);
  const original = Number(originalPrice ?? 0);
  const fallbackDiscount = Number(fallback);

  if (Number.isFinite(fallbackDiscount) && fallbackDiscount > 0) {
    return Math.round(fallbackDiscount);
  }

  if (!original || current >= original) {
    return null;
  }

  return Math.round(((original - current) / original) * 100);
}

function buildRealtimePriceUpdatePayload({ storeId, labelUpdate }) {
  if (!storeId || !labelUpdate?.lotId) {
    return null;
  }

  const originalPrice =
    Number(labelUpdate.originalPrice ?? labelUpdate.previousPrice ?? labelUpdate.currentPrice ?? 0) || 0;
  const currentPrice = Number(labelUpdate.currentPrice ?? originalPrice);

  return {
    type: "price-update",
    sku_id: labelUpdate.skuId ?? labelUpdate.lotId,
    product_name: labelUpdate.productName ?? labelUpdate.lotId,
    current_price: currentPrice,
    original_price: originalPrice || currentPrice,
    discount_pct: inferRealtimeDiscountPct(currentPrice, originalPrice, labelUpdate.discountPct),
    expiry_iso: labelUpdate.expiryIso ?? null,
    unit: labelUpdate.unit ?? "lot",
    quantity: labelUpdate.quantity ?? null,
    category: labelUpdate.category ?? null,
    item_traffic: labelUpdate.itemTraffic ?? null,
    recent_velocity: labelUpdate.recentVelocity ?? null,
    sell_through_probability: labelUpdate.sellThroughProbability ?? null,
    stockout_risk: labelUpdate.stockoutRisk ?? null,
    spoilage_risk: labelUpdate.spoilageRisk ?? null,
    status_tone: labelUpdate.statusTone ?? null,
    snapshot_key: labelUpdate.snapshotKey ?? null,
  };
}

function buildRealtimeOutboxEntry({ storeId, labelUpdate }) {
  const payload = buildRealtimePriceUpdatePayload({ storeId, labelUpdate });
  if (!payload) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    channel: "price-update",
    storeId,
    payload,
    createdAt: now(),
  };
}

function buildProductLabelUpdate(product, snapshotKey = null) {
  if (!product?.lotId) {
    return null;
  }

  return {
    lotId: product.lotId,
    skuId: product.skuId,
    productName: product.productName,
    currentPrice: product.currentPrice,
    previousPrice: product.originalPrice,
    originalPrice: product.originalPrice,
    discountPct: product.discountPct,
    expiryIso: product.expiryIso,
    unit: product.unit,
    quantity: product.quantity,
    category: product.category,
    itemTraffic: product.itemTraffic,
    recentVelocity: product.recentVelocity,
    sellThroughProbability: product.sellThroughProbability,
    stockoutRisk: product.stockoutRisk,
    spoilageRisk: product.spoilageRisk,
    statusTone: product.statusTone,
    snapshotKey: snapshotKey ?? product.snapshotKey ?? null,
  };
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

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      name TEXT,
      type TEXT NOT NULL,
      target_category TEXT,
      target_sku_id TEXT,
      discount_pct NUMERIC,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      status TEXT DEFAULT 'scheduled',
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pos_transactions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      cashier TEXT,
      items JSONB NOT NULL,
      total NUMERIC NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

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

    ALTER TABLE model_runs ADD COLUMN IF NOT EXISTS stage_name TEXT;

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

function getBaselineSourcePriority(csvPath) {
  const baseName = path.basename(csvPath).toLowerCase();

  if (baseName.includes("baseline_final_v4")) {
    return 10;
  }

  if (baseName.includes("final_master_v12")) {
    return 20;
  }

  return 30;
}

function resolveBaselineCsvPaths() {
  const resolvedPaths = [...new Set(BASELINE_CSV_CANDIDATES.filter((candidate) => existsSync(candidate)))].sort(
    (left, right) => getBaselineSourcePriority(left) - getBaselineSourcePriority(right)
  );

  if (!resolvedPaths.length) {
    const error = new Error("Baseline CSV file could not be found");
    error.code = "BASELINE_CSV_NOT_FOUND";
    throw error;
  }

  return resolvedPaths;
}

function buildCanonicalInventoryRowKey(row) {
  return [
    row.storeId,
    row.date,
    row.timeSlot,
    row.skuName,
    row.category,
    row.expiryDate,
  ].join("::");
}

function csvEscape(value) {
  if (value == null) {
    return "";
  }

  const text = String(value);
  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, "\"\"")}"`;
}

function writeCanonicalNormalizedCsv(rows = []) {
  const exportPath = path.join(CANONICAL_EXPORT_DIR, CANONICAL_EXPORT_FILENAME);
  const headers = [
    "snapshot_key",
    "date",
    "time_slot",
    "timestamp_ms",
    "store_id",
    "store_name",
    "store_type",
    "archetype",
    "district",
    "sku_name",
    "category",
    "lot_id",
    "expiry_date",
    "expiry_at_ms",
    "temp_c",
    "item_traffic",
    "imported_qty",
    "sold_qty",
    "waste_qty",
    "ending_qty",
    "unit_cost",
    "unit_price",
    "revenue",
    "op_cost",
    "waste_loss",
    "net_profit",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.timestampKey,
        row.date,
        row.timeSlot,
        row.timestampMs,
        row.storeId,
        row.storeName,
        row.storeType,
        row.archetype,
        row.district,
        row.skuName,
        row.category,
        row.lotId,
        row.expiryDate,
        row.expiryAtMs,
        row.temp,
        row.itemTraffic,
        row.imported,
        row.sold,
        row.waste,
        row.endingQuantity,
        row.cost,
        row.price,
        row.revenue,
        row.opCost,
        row.wasteLoss,
        row.netProfit,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ];

  mkdirSync(CANONICAL_EXPORT_DIR, { recursive: true });
  writeFileSync(exportPath, `${lines.join("\n")}\n`, "utf8");
  return exportPath;
}

function readBaselineRows() {
  const csvPaths = resolveBaselineCsvPaths();
  const rowMap = new Map();
  const sourceStats = [];

  for (const csvPath of csvPaths) {
    const normalizedRows = parseCsv(readFileSync(csvPath, "utf8"))
      .map(normalizeRow)
      .filter(Boolean);
    let replacedRows = 0;

    for (const row of normalizedRows) {
      const dedupeKey = buildCanonicalInventoryRowKey(row);
      if (rowMap.has(dedupeKey)) {
        replacedRows += 1;
      }
      rowMap.set(dedupeKey, row);
    }

    sourceStats.push({
      csvPath,
      fileName: path.basename(csvPath),
      rows: normalizedRows.length,
      replacedRows,
      priority: getBaselineSourcePriority(csvPath),
    });
  }

  const rows = [...rowMap.values()].sort((left, right) => {
    if (left.timestampMs !== right.timestampMs) {
      return left.timestampMs - right.timestampMs;
    }
    return String(left.lotId ?? "").localeCompare(String(right.lotId ?? ""));
  });

  return {
    csvPath: csvPaths.at(-1),
    csvPaths,
    sourceStats,
    rows,
  };
}

function resolveOperationalSnapshotsFromRows(rows = [], snapshots = []) {
  const rowsWithInventory = rows.filter(
    (row) =>
      Number.isFinite(Number(row.endingQuantity)) &&
      Number(row.endingQuantity) > 0 &&
      Number.isFinite(Number(row.expiryAtMs)) &&
      Number(row.expiryAtMs) > Number(row.timestampMs)
  );
  const storeIds = [...new Set(rows.map((row) => row.storeId))];
  const byStore = Object.fromEntries(
    storeIds.map((storeId) => {
      const snapshotKey =
        rowsWithInventory
          .filter((row) => row.storeId === storeId)
          .sort((left, right) => right.timestampMs - left.timestampMs)[0]?.timestampKey ??
        snapshots.at(-1) ??
        null;

      return [storeId, snapshotKey];
    })
  );
  const snapshotKey = Object.values(byStore)
    .filter(Boolean)
    .sort()
    .at(-1) ?? snapshots.at(-1) ?? null;

  return {
    snapshotKey,
    byStore,
  };
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
      pos_transactions,
      settings,
      campaigns,
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
  globalScope.__synaptosOperationalSnapshotCache = null;
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

function summarizeStoreMetrics(activeLots = [], inventoryLots = []) {
  const totalImported = activeLots.reduce((sum, lot) => sum + Number(lot.totalImported ?? 0), 0);
  const totalWaste = activeLots.reduce((sum, lot) => sum + Number(lot.totalWaste ?? 0), 0);
  const totalQuantity = inventoryLots.reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0);
  const atRiskLots = inventoryLots.filter((lot) => Number(lot.spoilageRisk ?? 0) >= 0.6).length;

  return {
    activeLots: inventoryLots.length,
    atRiskLots,
    onSaleLots: inventoryLots.filter((lot) => lot.discountPct != null && lot.discountPct > 0).length,
    totalQuantity,
    totalImported,
    totalWaste,
    wasteRate: totalImported > 0 ? totalWaste / totalImported : 0,
  };
}

function decorateInventoryLots(activeLots = [], recommendations = [], labels = {}, aggregatedSnapshot = null) {
  const recommendationByLotId = new Map(
    recommendations.map((recommendation) => [recommendation.lotId, recommendation])
  );
  const riskByLotId = new Map(
    (aggregatedSnapshot?.payload?.lots ?? aggregatedSnapshot?.lots ?? []).map((lot) => [lot.lot_id, lot])
  );

  return activeLots
    .map((lot) => {
      const recommendation = recommendationByLotId.get(lot.lotId) ?? null;
      const risk = riskByLotId.get(lot.lotId) ?? null;
      const label = labels[lot.lotId] ?? null;
      const basePrice = Number(lot.basePrice ?? lot.currentPrice ?? 0);
      const originalPrice =
        label?.status === "campaign_active"
          ? Number(label?.previousPrice ?? basePrice)
          : Number(Math.max(Number(label?.previousPrice ?? 0), basePrice));
      const currentPrice = Number(
        label?.currentPrice ??
          recommendation?.activePrice ??
          recommendation?.recommendedPrice ??
          lot.currentPrice ??
          originalPrice
      );
      const discountPct =
        currentPrice < originalPrice && originalPrice > 0
          ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
          : null;

      return {
        skuId: lot.lotId,
        lotId: lot.lotId,
        productName: lot.skuName,
        category: lot.category,
        quantity: Number(lot.quantityOnHand ?? 0),
        expiryIso: lot.expiryAtMs ? new Date(lot.expiryAtMs).toISOString() : null,
        hoursToExpiry: Number(lot.hoursToExpiry ?? 0),
        currentPrice,
        originalPrice,
        discountPct,
        recentVelocity: Number(lot.recentVelocity ?? 0),
        itemTraffic: Number(lot.itemTraffic ?? 0),
        confidenceScore: Number(lot.confidenceScore ?? 0),
        spoilageRisk:
          risk?.spoilage_risk ??
          (recommendation?.riskScore != null ? Number(recommendation.riskScore) / 100 : null),
        sellThroughProbability: risk?.sell_through_probability ?? null,
        stockoutRisk: risk?.stockout_risk ?? null,
        riskScore: recommendation?.riskScore ?? null,
        unit: "lot",
        statusTone:
          Number(lot.hoursToExpiry ?? 999) < 4
            ? "critical"
            : Number(lot.hoursToExpiry ?? 999) < 12
              ? "watch"
              : "normal",
      };
    })
    .sort((left, right) => Number(left.hoursToExpiry ?? 0) - Number(right.hoursToExpiry ?? 0));
}

const ANALYTICS_HOURS = Array.from({ length: 16 }, (_, index) => index + 6);

function averageNumbers(values = []) {
  const numeric = values.filter((value) => Number.isFinite(Number(value)));
  if (!numeric.length) {
    return 0;
  }
  return numeric.reduce((sum, value) => sum + Number(value), 0) / numeric.length;
}

function roundNumber(value, digits = 2) {
  const next = Number(value ?? 0);
  if (!Number.isFinite(next)) {
    return 0;
  }
  const factor = 10 ** digits;
  return Math.round(next * factor) / factor;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hourLabel(hour) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function hourWindow(hour) {
  return `${hourLabel(hour)}-${hourLabel((hour + 1) % 24)}`;
}

function hourFromRow(row) {
  return new Date(Number(row.timestampMs ?? 0)).getHours();
}

function aggregateRowsByHour(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const hour = hourFromRow(row);
    if (!ANALYTICS_HOURS.includes(hour)) {
      continue;
    }

    const current = map.get(hour) ?? {
      hour,
      count: 0,
      trafficSum: 0,
      soldSum: 0,
      revenueSum: 0,
      importedSum: 0,
      wasteSum: 0,
      profitSum: 0,
    };

    current.count += 1;
    current.trafficSum += Number(row.itemTraffic ?? 0);
    current.soldSum += Number(row.sold ?? 0);
    current.revenueSum += Number(row.revenue ?? 0);
    current.importedSum += Number(row.imported ?? 0);
    current.wasteSum += Number(row.waste ?? 0);
    current.profitSum += Number(row.netProfit ?? 0);
    map.set(hour, current);
  }

  return map;
}

function aggregateRowsByCategoryAndHour(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const hour = hourFromRow(row);
    if (!ANALYTICS_HOURS.includes(hour)) {
      continue;
    }

    const key = `${row.category}:${hour}`;
    const current = map.get(key) ?? {
      category: row.category,
      hour,
      count: 0,
      soldSum: 0,
      trafficSum: 0,
      revenueSum: 0,
    };

    current.count += 1;
    current.soldSum += Number(row.sold ?? 0);
    current.trafficSum += Number(row.itemTraffic ?? 0);
    current.revenueSum += Number(row.revenue ?? 0);
    map.set(key, current);
  }

  return map;
}

function buildTrafficSeriesFromMap(hourMap, metricKey = "traffic") {
  return ANALYTICS_HOURS.map((hour) => {
    const entry = hourMap.get(hour) ?? null;
    const value =
      metricKey === "traffic"
        ? roundNumber(entry ? entry.trafficSum / Math.max(1, entry.count) : 0, 2)
        : metricKey === "sold"
          ? roundNumber(entry?.soldSum ?? 0, 2)
          : metricKey === "revenue"
            ? roundNumber(entry?.revenueSum ?? 0, 0)
            : 0;

    return {
      hour,
      label: hourLabel(hour),
      value,
    };
  });
}

function findPeakPoint(series = []) {
  return series.reduce(
    (best, point) => (Number(point.value ?? 0) > Number(best?.value ?? -1) ? point : best),
    null
  );
}

function buildDistrictPatternCard({ store, storeRows, snapshotDate, snapshotHour }) {
  const historyByHour = aggregateRowsByHour(storeRows);
  const historySeries = buildTrafficSeriesFromMap(historyByHour, "traffic");
  const todayRows = storeRows.filter((row) => row.date === snapshotDate);
  const todayByHour = aggregateRowsByHour(todayRows);
  const actualSeries = ANALYTICS_HOURS.map((hour) => {
    const entry = todayByHour.get(hour);
    return {
      hour,
      label: hourLabel(hour),
      value:
        hour <= snapshotHour && entry
          ? roundNumber(entry.trafficSum / Math.max(1, entry.count), 2)
          : null,
    };
  });

  const recentActualValues = actualSeries.filter((point) => point.value != null).map((point) => point.value);
  const recentBaselineValues = historySeries
    .filter((point) => point.hour <= snapshotHour)
    .map((point) => point.value);
  const momentumFactor =
    averageNumbers(recentBaselineValues) > 0
      ? clampNumber(averageNumbers(recentActualValues) / averageNumbers(recentBaselineValues), 0.84, 1.28)
      : 1;
  const forecastSeries = historySeries.map((point) => ({
    ...point,
    value: roundNumber(
      point.value *
        momentumFactor *
        (point.hour >= snapshotHour && point.hour <= snapshotHour + 2 ? 1.03 : 1),
      2
    ),
  }));
  const peakPoint = findPeakPoint(historySeries);
  const nextPeakPoint =
    findPeakPoint(forecastSeries.filter((point) => point.hour >= snapshotHour)) ?? peakPoint;
  const primeCategory = Object.entries(
    storeRows.reduce((summary, row) => {
      summary[row.category] = (summary[row.category] ?? 0) + Number(row.sold ?? 0);
      return summary;
    }, {})
  ).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Mixed";

  return {
    storeId: store.id,
    district: store.district,
    name: store.name,
    displayType: store.displayType,
    archetype: store.archetype,
    series: historySeries,
    actualSeries,
    forecastSeries,
    peakHour: peakPoint?.hour ?? snapshotHour,
    peakWindow: hourWindow(peakPoint?.hour ?? snapshotHour),
    nextPeakWindow: hourWindow(nextPeakPoint?.hour ?? snapshotHour),
    momentumPct: roundNumber((momentumFactor - 1) * 100, 1),
    avgTraffic: roundNumber(averageNumbers(historySeries.map((point) => point.value)), 2),
    avgRevenue: roundNumber(
      averageNumbers(buildTrafficSeriesFromMap(historyByHour, "revenue").map((point) => point.value)),
      0
    ),
    primeCategory,
  };
}

function buildForecastWindowHours(snapshotHour) {
  const hours = [];

  for (let offset = 1; offset <= 4; offset += 1) {
    const nextHour = snapshotHour + offset;
    hours.push(nextHour > 21 ? 6 + (nextHour - 22) : nextHour);
  }

  return hours;
}

function buildDemandForecast({ activeLots = [], districtPattern, storeRows = [], snapshotHour }) {
  const categoryHourMetrics = aggregateRowsByCategoryAndHour(storeRows);
  const forecastHours = buildForecastWindowHours(snapshotHour);
  const categories = new Map();

  for (const lot of activeLots) {
    const current = categories.get(lot.category) ?? {
      category: lot.category,
      quantity: 0,
      recentVelocity: 0,
      trafficSignal: 0,
      lotCount: 0,
      minHoursToExpiry: Infinity,
      maxSpoilageRisk: 0,
      avgPrice: 0,
    };

    current.quantity += Number(lot.quantityOnHand ?? 0);
    current.recentVelocity += Number(lot.recentVelocity ?? 0);
    current.trafficSignal += Number(lot.itemTraffic ?? 0);
    current.lotCount += 1;
    current.minHoursToExpiry = Math.min(current.minHoursToExpiry, Number(lot.hoursToExpiry ?? 999));
    current.maxSpoilageRisk = Math.max(current.maxSpoilageRisk, Number(lot.spoilageRisk ?? 0));
    current.avgPrice += Number(lot.basePrice ?? lot.currentPrice ?? 0);
    categories.set(lot.category, current);
  }

  const demandRows = [...categories.values()].map((entry) => {
    const historicalFutureUnits = forecastHours.reduce((sum, hour) => {
      const metric = categoryHourMetrics.get(`${entry.category}:${hour}`);
      return sum + Number(metric ? metric.soldSum / Math.max(1, metric.count) : 0);
    }, 0);
    const trafficLift = 1 + Math.max(0, Number(districtPattern?.momentumPct ?? 0)) / 200;
    const velocityDriven = entry.recentVelocity * 3.2;
    const forecastUnits = Math.min(
      entry.quantity,
      Math.max(
        1,
        Math.round(
          Math.max(velocityDriven, historicalFutureUnits * trafficLift + entry.quantity * 0.08)
        )
      )
    );
    const pullThroughPct = entry.quantity > 0 ? clampNumber(forecastUnits / entry.quantity, 0, 1) : 0;
    const avgPrice = entry.avgPrice / Math.max(1, entry.lotCount);

    return {
      category: entry.category,
      quantity: roundNumber(entry.quantity, 0),
      forecastUnits,
      forecastRevenue: roundNumber(forecastUnits * avgPrice, 0),
      pullThroughPct: roundNumber(pullThroughPct, 2),
      expiryPressure: roundNumber(Math.max(0, 1 - entry.minHoursToExpiry / 24), 2),
      minHoursToExpiry: roundNumber(entry.minHoursToExpiry, 1),
      tone:
        entry.minHoursToExpiry <= 10
          ? "red"
          : pullThroughPct >= 0.72
            ? "blue"
            : pullThroughPct >= 0.45
              ? "amber"
              : "gray",
      summary:
        entry.minHoursToExpiry <= 10
          ? "Expiry pressure is overtaking demand."
          : pullThroughPct >= 0.72
            ? "Projected to clear into the next peak."
            : "Stable demand with moderate pull-through.",
    };
  });

  const totalForecastUnits = Math.max(
    1,
    demandRows.reduce((sum, row) => sum + Number(row.forecastUnits ?? 0), 0)
  );

  return demandRows
    .map((row) => ({
      ...row,
      sharePct: roundNumber(row.forecastUnits / totalForecastUnits, 2),
    }))
    .sort((left, right) => right.forecastUnits - left.forecastUnits)
    .slice(0, 6);
}

function buildHeatmapRows(districtPatterns = []) {
  const maxValue = Math.max(
    1,
    ...districtPatterns.flatMap((pattern) => pattern.series.map((point) => Number(point.value ?? 0)))
  );

  return {
    hours: ANALYTICS_HOURS.map((hour) => ({ hour, label: hourLabel(hour), window: hourWindow(hour) })),
    rows: districtPatterns.map((pattern) => ({
      storeId: pattern.storeId,
      district: pattern.district,
      label: pattern.displayType,
      peakWindow: pattern.peakWindow,
      values: pattern.series.map((point) => ({
        hour: point.hour,
        intensity: roundNumber(clampNumber(point.value / maxValue, 0, 1), 2),
        rawValue: point.value,
        isPeak: point.hour === pattern.peakHour,
      })),
    })),
  };
}

function getObservationValue(observation, candidatePaths = []) {
  for (const path of candidatePaths) {
    const segments = path.split(".");
    let current = observation?.payload ?? observation ?? null;

    for (const segment of segments) {
      current = current?.[segment];
    }

    if (current != null && current !== "") {
      return current;
    }
  }

  return null;
}

function buildSignalSummary(observation) {
  if (observation.sourceType.includes("weather")) {
    const temperature =
      getObservationValue(observation, ["temperatureC", "extracted.temperature_c", "extracted.temperature"]) ?? "—";
    return `${temperature}°C thermal reading`;
  }

  if (observation.sourceType.includes("commodity")) {
    const seafood =
      getObservationValue(observation, ["seafoodIndex", "extracted.seafood_index"]) ?? null;
    const meat =
      getObservationValue(observation, ["meatIndex", "extracted.meat_index"]) ?? null;
    return seafood != null || meat != null
      ? `Seafood ${seafood ?? "—"} · Meat ${meat ?? "—"}`
      : "Wholesale price watch";
  }

  if (observation.sourceType.includes("demographic")) {
    const mix =
      getObservationValue(observation, ["footfallMix", "profile_type", "extracted.profile_type"]) ?? "district mix";
    return `${mix} footfall mix`;
  }

  if (observation.sourceType.includes("pos")) {
    const soldUnits = getObservationValue(observation, ["soldUnits", "sold_units_last_window"]) ?? "—";
    return `${soldUnits} units in the last window`;
  }

  if (observation.sourceType.includes("inventory")) {
    const onHand = getObservationValue(observation, ["quantityOnHand", "quantity_on_hand"]) ?? "—";
    return `${onHand} units currently on hand`;
  }

  return "Source observation";
}

function buildSignalWire({
  approvals = [],
  demandForecast = [],
  districtPattern,
  districtPatterns = [],
  inventoryLots = [],
  sourceObservations = [],
  storeRecord,
}) {
  const weatherObservation = sourceObservations.find((observation) =>
    observation.sourceType.includes("weather")
  );
  const commodityObservation = sourceObservations.find((observation) =>
    observation.sourceType.includes("commodity")
  );
  const demographicObservation = sourceObservations.find((observation) =>
    observation.sourceType.includes("demographic")
  );
  const hottestDistrict =
    [...districtPatterns].sort((left, right) => right.avgTraffic - left.avgTraffic)[0] ?? districtPattern;
  const topDemand = demandForecast[0] ?? null;
  const nearestExpiry = inventoryLots[0] ?? null;

  const weatherTemp = Number(
    getObservationValue(weatherObservation, ["temperatureC", "extracted.temperature_c", "extracted.temperature"]) ?? 0
  );
  const seafoodIndex = Number(
    getObservationValue(commodityObservation, ["seafoodIndex", "extracted.seafood_index"]) ?? 1
  );

  const recent = [
    {
      id: "recent-weather",
      tone: weatherTemp >= 33 ? "amber" : "blue",
      kicker: "Recent Signal",
      title:
        weatherTemp >= 33
          ? `${storeRecord?.district ?? "Store"} thermal load is running hot`
          : `${storeRecord?.district ?? "Store"} thermal load is stable`,
      detail: `${weatherTemp || "—"}°C on the weather feed keeps chilled categories under active watch.`,
      meta: buildSignalSummary(weatherObservation),
    },
    {
      id: "recent-commodity",
      tone: seafoodIndex >= 1.05 ? "amber" : "green",
      kicker: "Recent Signal",
      title:
        seafoodIndex >= 1.05
          ? "Protein cost pressure remains elevated"
          : "Commodity basket is holding near baseline",
      detail: `Wholesale signals are still leaning into margin sensitivity for premium proteins and chilled lines.`,
      meta: buildSignalSummary(commodityObservation),
    },
    {
      id: "recent-demographic",
      tone: "blue",
      kicker: "Recent Signal",
      title: `${storeRecord?.district ?? "Store"} shopper mix is reinforcing its archetype`,
      detail: `District behavior continues to track the ${districtPattern?.displayType ?? storeRecord?.archetype ?? "current"} operating pattern.`,
      meta: buildSignalSummary(demographicObservation),
    },
  ];

  const upcoming = [
    {
      id: "upcoming-peak",
      tone: "blue",
      kicker: "Forward Watch",
      title: `${districtPattern?.displayType ?? "Store"} should re-accelerate at ${districtPattern?.nextPeakWindow ?? "the next peak window"}`,
      detail: `Forecast traffic is leaning toward ${districtPattern?.nextPeakWindow ?? "the next wave"}, with ${hottestDistrict?.district ?? storeRecord?.district ?? "the chain"} still setting the chain pace.`,
      meta: `Chain leader: ${hottestDistrict?.district ?? "n/a"} · ${hottestDistrict?.peakWindow ?? "n/a"}`,
    },
    {
      id: "upcoming-demand",
      tone: topDemand?.tone ?? "amber",
      kicker: "Forward Watch",
      title: topDemand ? `${topDemand.category} is projected to lead the next pull-through` : "Demand is flattening into the next window",
      detail: topDemand
        ? `${topDemand.forecastUnits} units are projected across the next four operating hours, with ${Math.round(
            (topDemand.sharePct ?? 0) * 100
          )}% of category demand concentrated there.`
        : "Demand concentration is currently shallow across the assortment.",
      meta: topDemand ? topDemand.summary : "No dominant category forecast available",
    },
    {
      id: "upcoming-expiry",
      tone: nearestExpiry?.statusTone === "critical" ? "red" : "amber",
      kicker: "Forward Watch",
      title: nearestExpiry
        ? `${nearestExpiry.productName} is the nearest expiry watch item`
        : "No acute expiry event is queued",
      detail: nearestExpiry
        ? `${nearestExpiry.productName} hits a ${roundNumber(nearestExpiry.hoursToExpiry, 1)}h expiry window, while ${
            approvals.filter((item) => item.status === "pending").length
          } approvals remain pending.`
        : `No acute expiry event is pending, and ${approvals.filter((item) => item.status === "pending").length} approvals remain open.`,
      meta: nearestExpiry ? `${nearestExpiry.category} · ${nearestExpiry.quantity} units on hand` : "Queue remains stable",
    },
  ];

  return { recent, upcoming };
}

function buildFreshnessBoard(sourceObservations = []) {
  return sourceObservations.map((observation) => ({
    id: observation.id ?? `${observation.sourceType}-${observation.observedAt}`,
    sourceType: observation.sourceType,
    label: observation.sourceType.replaceAll("_", " "),
    freshnessStatus: observation.freshnessStatus,
    freshnessMinutes: Number(observation.freshnessMinutes ?? 0),
    provenance: observation.provenance,
    observedAt: observation.observedAt,
    summary: buildSignalSummary(observation),
  }));
}

function buildEmptyStoreAnalytics() {
  return {
    generatedAt: now(),
    overview: {
      liveSources: 0,
      forecastUnits: 0,
      chainTrafficRank: null,
      criticalLots: 0,
      activeMarkdowns: 0,
      pendingApprovals: 0,
    },
    trafficPulse: {
      hours: ANALYTICS_HOURS.map((hour) => ({ hour, label: hourLabel(hour) })),
      actualSeries: [],
      forecastSeries: [],
      peakWindow: null,
      nextPeakWindow: null,
      momentumPct: 0,
      avgTraffic: 0,
      avgRevenue: 0,
      snapshotHour: null,
    },
    districtPatterns: [],
    heatmap: {
      hours: ANALYTICS_HOURS.map((hour) => ({ hour, label: hourLabel(hour), window: hourWindow(hour) })),
      rows: [],
    },
    demandForecast: [],
    signalWire: {
      recent: [],
      upcoming: [],
    },
    freshnessBoard: [],
    assortmentMix: [],
  };
}

function buildStoreAnalytics({
  activeLots = [],
  approvals = [],
  inventoryLots = [],
  sourceObservations = [],
  rows = [],
  snapshotKey,
  storeRecord,
  stores = [],
}) {
  if (!snapshotKey || !storeRecord) {
    return buildEmptyStoreAnalytics();
  }

  const snapshotDate = String(snapshotKey ?? "").slice(0, 10);
  const snapshotHour = new Date(snapshotKey).getHours();
  const districtPatterns = stores.map((store) =>
    buildDistrictPatternCard({
      store,
      storeRows: rows.filter((row) => row.storeId === store.id),
      snapshotDate,
      snapshotHour,
    })
  );
  const districtPattern =
    districtPatterns.find((pattern) => pattern.storeId === storeRecord?.id) ?? districtPatterns[0] ?? null;
  const selectedStoreRows = rows.filter((row) => row.storeId === storeRecord?.id);
  const demandForecast = buildDemandForecast({
    activeLots,
    districtPattern,
    storeRows: selectedStoreRows,
    snapshotHour,
  });
  const signalWire = buildSignalWire({
    approvals,
    demandForecast,
    districtPattern,
    districtPatterns,
    inventoryLots,
    sourceObservations,
    storeRecord,
  });
  const rankedPatterns = [...districtPatterns].sort((left, right) => right.avgTraffic - left.avgTraffic);
  const chainTrafficRank = rankedPatterns.findIndex((pattern) => pattern.storeId === storeRecord.id) + 1;
  const criticalLots = inventoryLots.filter((lot) => lot.statusTone === "critical").length;
  const activeMarkdowns = inventoryLots.filter((lot) => Number(lot.discountPct ?? 0) > 0).length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length;
  const forecastUnits = demandForecast.reduce((sum, row) => sum + Number(row.forecastUnits ?? 0), 0);
  const liveSources = sourceObservations.filter((observation) =>
    ["live", "live_mock"].includes(observation.provenance)
  ).length;

  return {
    generatedAt: now(),
    overview: {
      liveSources,
      forecastUnits,
      chainTrafficRank: chainTrafficRank || null,
      criticalLots,
      activeMarkdowns,
      pendingApprovals,
    },
    trafficPulse: {
      hours: ANALYTICS_HOURS.map((hour) => ({ hour, label: hourLabel(hour) })),
      actualSeries: districtPattern?.actualSeries ?? [],
      forecastSeries: districtPattern?.forecastSeries ?? [],
      peakWindow: districtPattern?.peakWindow ?? null,
      nextPeakWindow: districtPattern?.nextPeakWindow ?? null,
      momentumPct: districtPattern?.momentumPct ?? 0,
      avgTraffic: districtPattern?.avgTraffic ?? 0,
      avgRevenue: districtPattern?.avgRevenue ?? 0,
      snapshotHour,
    },
    districtPatterns,
    heatmap: buildHeatmapRows(districtPatterns),
    demandForecast,
    signalWire,
    freshnessBoard: buildFreshnessBoard(sourceObservations),
    assortmentMix: buildAssortmentMix(inventoryLots),
  };
}

function hashString(value = "") {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash >>> 0;
}

function seededUnit(seed, salt = 0) {
  const value = Math.sin((seed + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function slugifyLiveValue(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function roundMoney(value) {
  return Math.max(0, Math.round(Number(value ?? 0)));
}

function hourWindowLabel(hour) {
  return `${hourLabel(hour)}-${hourLabel((hour + 1) % 24)}`;
}

function liveUnitLabel(category) {
  switch (String(category ?? "").toLowerCase()) {
    case "drink":
      return "bottle";
    case "fruit":
      return "cup";
    case "meat":
    case "seafood":
      return "tray";
    case "rte":
      return "box";
    case "snack":
      return "pack";
    default:
      return "lot";
  }
}

function categoryShelfLifeHours(category) {
  switch (String(category ?? "").toLowerCase()) {
    case "veg":
      return 18;
    case "fruit":
      return 20;
    case "meat":
    case "seafood":
      return 16;
    case "dairy":
      return 42;
    case "rte":
      return 14;
    case "drink":
      return 60;
    case "snack":
      return 96;
    default:
      return 36;
  }
}

function archetypeTrafficMultiplier(archetype, hour) {
  if (archetype === "premium") {
    if (hour >= 11 && hour <= 14) {
      return 1.34;
    }
    if (hour >= 18 && hour <= 20) {
      return 1.12;
    }
    return 0.94;
  }

  if (archetype === "transit") {
    if (hour >= 7 && hour <= 9) {
      return 1.24;
    }
    if (hour >= 17 && hour <= 21) {
      return 1.4;
    }
    return 0.88;
  }

  if (hour >= 16 && hour <= 19) {
    return 1.42;
  }
  if (hour >= 10 && hour <= 12) {
    return 1.08;
  }
  return 0.92;
}

function archetypeForecastMultiplier(archetype, hour, currentHour) {
  const base = archetypeTrafficMultiplier(archetype, hour);
  const distance = Math.max(0, hour - currentHour);
  return base * (distance <= 2 ? 1.06 : 1.02);
}

function buildLiveMockSeeds(rows = []) {
  const seeds = new Map();

  for (const row of rows) {
    const key = `${row.storeId}::${row.skuName}`;
    const current = seeds.get(key) ?? {
      storeId: row.storeId,
      storeName: row.storeName,
      category: row.category,
      skuName: row.skuName,
      rowCount: 0,
      priceSum: 0,
      costSum: 0,
      soldSum: 0,
      importedSum: 0,
      revenueSum: 0,
      wasteSum: 0,
      trafficSum: 0,
      profitSum: 0,
    };

    current.rowCount += 1;
    current.priceSum += Number(row.price ?? 0);
    current.costSum += Number(row.cost ?? 0);
    current.soldSum += Number(row.sold ?? 0);
    current.importedSum += Number(row.imported ?? 0);
    current.revenueSum += Number(row.revenue ?? 0);
    current.wasteSum += Number(row.waste ?? 0);
    current.trafficSum += Number(row.itemTraffic ?? 0);
    current.profitSum += Number(row.netProfit ?? 0);
    seeds.set(key, current);
  }

  return [...seeds.values()].reduce((summary, seed) => {
    const record = {
      storeId: seed.storeId,
      storeName: seed.storeName,
      category: seed.category,
      skuName: seed.skuName,
      avgPrice: seed.priceSum / Math.max(1, seed.rowCount),
      avgCost: seed.costSum / Math.max(1, seed.rowCount),
      avgSold: seed.soldSum / Math.max(1, seed.rowCount),
      avgImported: seed.importedSum / Math.max(1, seed.rowCount),
      avgRevenue: seed.revenueSum / Math.max(1, seed.rowCount),
      avgWaste: seed.wasteSum / Math.max(1, seed.rowCount),
      avgTraffic: seed.trafficSum / Math.max(1, seed.rowCount),
      avgProfit: seed.profitSum / Math.max(1, seed.rowCount),
    };

    summary[record.storeId] ||= [];
    summary[record.storeId].push(record);
    return summary;
  }, {});
}

function buildLiveProduct({
  seed,
  snapshotKey,
  store,
  currentHour,
  dayOfWeek,
}) {
  const baseSeed = hashString(`${store.id}:${seed.skuName}:${snapshotKey.slice(0, 13)}`);
  const trafficMultiplier = archetypeTrafficMultiplier(store.archetype, currentHour);
  const dayBias = dayOfWeek >= 5 ? 1.08 : 1;
  const currentTraffic = roundNumber(
    Math.max(0.45, seed.avgTraffic * trafficMultiplier * dayBias * (0.9 + seededUnit(baseSeed, 1) * 0.24)),
    2
  );
  const recentVelocity = roundNumber(
    Math.max(1, seed.avgSold * (0.9 + seededUnit(baseSeed, 2) * 0.55) * trafficMultiplier),
    1
  );
  const imported = Math.max(
    8,
    Math.round(seed.avgImported * (0.78 + seededUnit(baseSeed, 3) * 0.8) + recentVelocity * 4)
  );
  const quantity = Math.max(
    3,
    Math.round(imported * (0.45 + seededUnit(baseSeed, 4) * 0.52))
  );
  const shelfHours = categoryShelfLifeHours(seed.category);
  const hoursToExpiry = roundNumber(
    Math.max(6, shelfHours * (0.55 + seededUnit(baseSeed, 5) * 1.3)),
    1
  );
  const spoilageRisk = roundNumber(
    clampNumber(1 - hoursToExpiry / Math.max(18, shelfHours * 1.8) + quantity / Math.max(40, imported * 1.4) - currentTraffic / 5, 0.08, 0.98),
    2
  );
  const sellThroughProbability = roundNumber(
    clampNumber((recentVelocity * 4 * currentTraffic) / Math.max(10, quantity * 4.4), 0.12, 0.96),
    2
  );
  const stockoutRisk = roundNumber(
    clampNumber((recentVelocity * 3.2) / Math.max(8, quantity) - 0.12, 0.05, 0.94),
    2
  );
  const priceBias = store.archetype === "premium" ? 1.08 : store.archetype === "transit" ? 0.97 : 1;
  const originalPrice = roundMoney(seed.avgPrice * priceBias * (0.96 + seededUnit(baseSeed, 6) * 0.14));
  const discountPct =
    spoilageRisk >= 0.84
      ? 30
      : spoilageRisk >= 0.72
        ? 20
        : sellThroughProbability >= 0.74 && currentTraffic >= 1.4
          ? 10
          : null;
  const currentPrice = roundMoney(originalPrice * (1 - Number(discountPct ?? 0) / 100));
  const sold = Math.max(1, Math.round(recentVelocity * (0.78 + seededUnit(baseSeed, 7) * 0.35)));
  const waste = Math.max(0, Math.round(spoilageRisk >= 0.76 ? quantity * 0.06 : quantity * 0.01));
  const cost = roundMoney(seed.avgCost * Math.max(1, sold));
  const revenue = roundMoney(currentPrice * sold);
  const opCost = roundMoney(Math.max(1600, revenue * 0.12));
  const wasteLoss = roundMoney(seed.avgCost * waste);
  const netProfit = roundMoney(revenue - cost - opCost - wasteLoss);
  const forecastUnits = Math.max(1, Math.round(recentVelocity * 4 * Math.max(0.85, currentTraffic / 1.18)));
  const expiryIso = new Date(new Date(snapshotKey).getTime() + hoursToExpiry * 3.6e6).toISOString();
  const lotId = `live-${store.id}-${slugifyLiveValue(seed.skuName)}`;
  const statusTone = spoilageRisk >= 0.8 ? "critical" : spoilageRisk >= 0.62 ? "watch" : "normal";

  return {
    skuId: lotId,
    lotId,
    productName: seed.skuName,
    category: seed.category,
    quantity,
    imported,
    sold,
    waste,
    cost,
    price: originalPrice,
    currentPrice,
    originalPrice,
    revenue,
    opCost,
    wasteLoss,
    netProfit,
    itemTraffic: currentTraffic,
    recentVelocity,
    forecastUnits,
    forecastRevenue: roundMoney(forecastUnits * currentPrice),
    confidenceScore: roundNumber(clampNumber(0.72 + seededUnit(baseSeed, 8) * 0.22, 0.72, 0.96), 2),
    spoilageRisk,
    sellThroughProbability,
    stockoutRisk,
    hoursToExpiry,
    expiryIso,
    expiryDate: expiryIso.slice(0, 10),
    unit: liveUnitLabel(seed.category),
    discountPct,
    statusTone,
    snapshotKey,
  };
}

function applyTransactionsToLiveProducts(products = [], transactions = []) {
  const bySku = new Map(products.map((product) => [product.skuId, { ...product }]));

  for (const transaction of transactions) {
    for (const item of transaction.items ?? []) {
      const skuId = item.sku_id ?? item.skuId ?? item.lot_id ?? item.lotId;
      const quantitySold = Number(item.qty ?? item.quantity ?? 0);
      const product = bySku.get(skuId);
      if (!product || quantitySold <= 0) {
        continue;
      }

      product.quantity = Math.max(0, Number(product.quantity ?? 0) - quantitySold);
      product.sold = Number(product.sold ?? 0) + quantitySold;
      product.recentVelocity = roundNumber(Number(product.recentVelocity ?? 0) + quantitySold * 0.2, 1);
      product.forecastUnits = Math.max(1, Math.round(Number(product.forecastUnits ?? 0) + quantitySold * 0.4));
      product.revenue = roundMoney(Number(product.revenue ?? 0) + Number(item.unit_price ?? item.unitPrice ?? product.currentPrice) * quantitySold);
      product.stockoutRisk = roundNumber(
        clampNumber(Number(product.stockoutRisk ?? 0) + quantitySold / Math.max(8, Number(product.imported ?? 1)), 0.05, 0.98),
        2
      );
      product.statusTone =
        product.quantity <= 4
          ? "critical"
          : Number(product.spoilageRisk ?? 0) >= 0.62 || product.quantity <= 8
            ? "watch"
            : "normal";
    }
  }

  return [...bySku.values()].filter((product) => Number(product.quantity ?? 0) > 0);
}

function applyLabelsToLiveProducts(products = [], labels = {}) {
  return products.map((product) => {
    const label = labels[product.lotId] ?? null;
    if (!label) {
      return {
        ...product,
        quantityOnHand: Number(product.quantity ?? 0),
      };
    }

    const originalPrice = Number(
      label.status === "campaign_active"
        ? label.previousPrice ?? product.originalPrice ?? product.currentPrice
        : Math.max(Number(label.previousPrice ?? 0), Number(product.originalPrice ?? product.currentPrice ?? 0))
    );
    const currentPrice = Number(label.currentPrice ?? product.currentPrice ?? originalPrice);
    const discountPct =
      currentPrice < originalPrice && originalPrice > 0
        ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
        : null;

    return {
      ...product,
      currentPrice,
      originalPrice,
      discountPct,
      quantityOnHand: Number(product.quantity ?? 0),
    };
  });
}

function buildLiveSourceObservations({ products = [], snapshotKey, store }) {
  const avgTraffic = roundNumber(averageNumbers(products.map((product) => product.itemTraffic)), 2);
  const avgTemp = roundNumber(
    store.archetype === "premium" ? 25.8 : store.archetype === "transit" ? 31.1 : 29.4,
    1
  );
  const soldUnits = products.reduce((sum, product) => sum + Number(product.sold ?? 0), 0);
  const quantityOnHand = products.reduce((sum, product) => sum + Number(product.quantity ?? 0), 0);
  const weatherObservedAt = new Date(new Date(snapshotKey).getTime() - 12 * 60000).toISOString();
  const commodityObservedAt = new Date(new Date(snapshotKey).getTime() - 36 * 60000).toISOString();
  const demographicObservedAt = new Date(new Date(snapshotKey).getTime() - 75 * 60000).toISOString();
  const posObservedAt = new Date(new Date(snapshotKey).getTime() - 6 * 60000).toISOString();
  const inventoryObservedAt = new Date(new Date(snapshotKey).getTime() - 3 * 60000).toISOString();

  return [
    {
      id: `${store.id}:weather:${snapshotKey}`,
      sourceType: "weather_api",
      sourceFamily: "external",
      observedAt: weatherObservedAt,
      freshnessWindowMs: 5_400_000,
      payload: {
        district: store.district,
        temperatureC: avgTemp,
        humidityPct: Math.round(67 + averageNumbers(products.map((product) => product.spoilageRisk)) * 18),
      },
      storeId: store.id,
      snapshotKey,
      provenance: "live_mock",
      freshnessStatus: "fresh",
      freshnessMinutes: 12,
    },
    {
      id: `${store.id}:commodity:${snapshotKey}`,
      sourceType: "commodity_prices",
      sourceFamily: "external",
      observedAt: commodityObservedAt,
      freshnessWindowMs: 28_800_000,
      payload: {
        seafoodIndex: roundNumber(store.archetype === "premium" ? 1.08 : 1.02, 2),
        meatIndex: roundNumber(store.archetype === "residential" ? 1.01 : 1.05, 2),
        dairyIndex: roundNumber(store.archetype === "transit" ? 0.97 : 0.99, 2),
      },
      storeId: store.id,
      snapshotKey,
      provenance: "live_mock",
      freshnessStatus: "fresh",
      freshnessMinutes: 36,
    },
    {
      id: `${store.id}:demographic:${snapshotKey}`,
      sourceType: "demographic_data",
      sourceFamily: "external",
      observedAt: demographicObservedAt,
      freshnessWindowMs: 86_400_000,
      payload: {
        district: store.district,
        footfallMix: store.archetype,
        trafficIndex: avgTraffic,
      },
      storeId: store.id,
      snapshotKey,
      provenance: "live_mock",
      freshnessStatus: "fresh",
      freshnessMinutes: 75,
    },
    {
      id: `${store.id}:pos:${snapshotKey}`,
      sourceType: "pos_transactions",
      sourceFamily: "internal",
      observedAt: posObservedAt,
      freshnessWindowMs: 3_600_000,
      payload: {
        soldUnits,
        activeRecommendations: products.filter((product) => Number(product.discountPct ?? 0) > 0).length,
      },
      storeId: store.id,
      snapshotKey,
      provenance: "live_mock",
      freshnessStatus: "fresh",
      freshnessMinutes: 6,
    },
    {
      id: `${store.id}:inventory:${snapshotKey}`,
      sourceType: "inventory_ledger",
      sourceFamily: "internal",
      observedAt: inventoryObservedAt,
      freshnessWindowMs: 2_700_000,
      payload: {
        quantityOnHand,
        lowConfidenceLots: products.filter((product) => Number(product.confidenceScore ?? 0) < 0.8).length,
      },
      storeId: store.id,
      snapshotKey,
      provenance: "live_mock",
      freshnessStatus: "fresh",
      freshnessMinutes: 3,
    },
  ];
}

function buildLiveDistrictPatternCard({ products = [], snapshotHour, store, storeRows = [] }) {
  const historyByHour = aggregateRowsByHour(storeRows);
  const historyTrafficSeries = buildTrafficSeriesFromMap(historyByHour, "traffic");
  const historyRevenueSeries = buildTrafficSeriesFromMap(historyByHour, "revenue");
  const liveTraffic = roundNumber(averageNumbers(products.map((product) => product.itemTraffic)), 2);
  const baselineTraffic = roundNumber(
    averageNumbers(
      historyTrafficSeries.filter((point) => point.hour <= snapshotHour).map((point) => point.value)
    ),
    2
  );
  const momentumFactor =
    baselineTraffic > 0
      ? clampNumber(liveTraffic / baselineTraffic, 0.8, 1.45)
      : clampNumber(0.94 + liveTraffic / 3.2, 0.86, 1.28);
  const actualSeries = historyTrafficSeries.map((point) => ({
    ...point,
    value:
      point.hour <= snapshotHour
        ? roundNumber(point.value * momentumFactor * (point.hour === snapshotHour ? 1.04 : 1), 2)
        : null,
  }));
  const forecastSeries = historyTrafficSeries.map((point) => ({
    ...point,
    value: roundNumber(
      point.value * archetypeForecastMultiplier(store.archetype, point.hour, snapshotHour) * momentumFactor,
      2
    ),
  }));
  const combinedSeries = historyTrafficSeries.map((point, index) => ({
    ...point,
    value:
      actualSeries[index]?.value != null
        ? actualSeries[index].value
        : forecastSeries[index]?.value ?? point.value,
  }));
  const peakPoint = findPeakPoint(combinedSeries) ?? findPeakPoint(forecastSeries);
  const nextPeakPoint =
    findPeakPoint(forecastSeries.filter((point) => point.hour >= snapshotHour)) ?? peakPoint;
  const avgRevenue = roundNumber(
    averageNumbers(historyRevenueSeries.map((point) => point.value)) || averageNumbers(products.map((product) => product.revenue)),
    0
  );
  const primeCategory =
    Object.entries(
      products.reduce((summary, product) => {
        summary[product.category] = (summary[product.category] ?? 0) + Number(product.forecastUnits ?? 0);
        return summary;
      }, {})
    ).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "Mixed";

  return {
    storeId: store.id,
    district: store.district,
    name: store.name,
    displayType: store.displayType,
    archetype: store.archetype,
    series: combinedSeries,
    actualSeries,
    forecastSeries,
    peakHour: peakPoint?.hour ?? snapshotHour,
    peakWindow: hourWindowLabel(peakPoint?.hour ?? snapshotHour),
    nextPeakWindow: hourWindowLabel(nextPeakPoint?.hour ?? snapshotHour),
    momentumPct: roundNumber((momentumFactor - 1) * 100, 1),
    avgTraffic: roundNumber(averageNumbers(combinedSeries.map((point) => point.value)), 2),
    avgRevenue,
    primeCategory,
  };
}

function buildLiveMockRecommendations(products = [], store) {
  return products
    .filter(
      (product) =>
        Number(product.discountPct ?? 0) > 0 ||
        Number(product.spoilageRisk ?? 0) >= 0.72 ||
        Number(product.stockoutRisk ?? 0) >= 0.7
    )
    .map((product) => {
      const recommendedDiscountPct =
        Number(product.discountPct ?? 0) > 0
          ? Number(product.discountPct)
          : Number(product.spoilageRisk ?? 0) >= 0.84
            ? 30
            : 15;
      const requiresApproval = recommendedDiscountPct > Number(store.approvalThresholdPct ?? 50);

      return {
        id: `live-rec-${product.lotId}-${product.snapshotKey}`,
        lotId: product.lotId,
        storeId: store.id,
        skuName: product.productName,
        category: product.category,
        lot: {
          lotId: product.lotId,
          storeId: store.id,
          storeName: store.name,
          storeType: store.type,
          archetype: store.archetype,
          district: store.district,
          skuName: product.productName,
          category: product.category,
          quantityOnHand: product.quantity,
          totalImported: product.imported,
          totalSold: product.sold,
          totalWaste: product.waste,
          confidenceScore: product.confidenceScore,
          recentVelocity: product.recentVelocity,
          hoursToExpiry: product.hoursToExpiry,
          temp: store.archetype === "premium" ? 25.8 : store.archetype === "transit" ? 31.1 : 29.4,
          itemTraffic: product.itemTraffic,
          basePrice: product.originalPrice,
          currentPrice: product.currentPrice,
          unitCost: product.cost,
          revenue: product.revenue,
          netProfit: product.netProfit,
        },
        riskScore: Math.round(Math.max(product.spoilageRisk ?? 0, product.stockoutRisk ?? 0) * 100),
        recommendedDiscountPct,
        recommendedPrice: product.currentPrice,
        approvalThresholdPct: Number(store.approvalThresholdPct ?? 50),
        requiresApproval,
        reasonSummary:
          Number(product.spoilageRisk ?? 0) >= 0.72
            ? `${recommendedDiscountPct}% markdown because expiry pressure and quantity density are rising.`
            : `Monitor ${product.productName} because turnover is accelerating against on-hand quantity.`,
        expectedRescueUnits: Math.max(1, Math.round(Number(product.forecastUnits ?? 1) * 0.6)),
        expectedRescueGmv: roundMoney(Number(product.forecastRevenue ?? 0) * 0.6),
        status: requiresApproval ? "pending_review" : "auto_applied",
        activePrice: product.currentPrice,
      };
    });
}

function buildAssortmentMix(products = []) {
  const categories = new Map();

  for (const product of products) {
    const current = categories.get(product.category) ?? {
      category: product.category,
      quantity: 0,
      revenue: 0,
      markdownUnits: 0,
      skuCount: 0,
    };

    current.quantity += Number(product.quantity ?? 0);
    current.revenue += Number(product.revenue ?? 0);
    current.markdownUnits += Number(product.discountPct ?? 0) > 0 ? Number(product.quantity ?? 0) : 0;
    current.skuCount += 1;
    categories.set(product.category, current);
  }

  const totalQuantity = Math.max(1, [...categories.values()].reduce((sum, entry) => sum + entry.quantity, 0));

  return [...categories.values()]
    .map((entry) => ({
      ...entry,
      sharePct: roundNumber(entry.quantity / totalQuantity, 2),
      markdownSharePct: roundNumber(entry.markdownUnits / Math.max(1, entry.quantity), 2),
    }))
    .sort((left, right) => right.quantity - left.quantity);
}

function buildLiveStoreAnalytics({
  approvals = [],
  districtPatterns = [],
  products = [],
  sourceObservations = [],
  store,
  snapshotKey,
}) {
  const districtPattern =
    districtPatterns.find((pattern) => pattern.storeId === store.id) ?? districtPatterns[0] ?? null;
  const assortmentMix = buildAssortmentMix(products);
  const demandForecast = assortmentMix.slice(0, 6).map((entry) => ({
    category: entry.category,
    quantity: entry.quantity,
    forecastUnits: Math.max(1, Math.round(entry.quantity * (0.16 + entry.sharePct * 0.9))),
    forecastRevenue: roundMoney(entry.revenue * Math.max(0.2, entry.sharePct)),
    pullThroughPct: roundNumber(clampNumber(0.24 + entry.sharePct * 1.1, 0.18, 0.92), 2),
    expiryPressure: roundNumber(
      Math.max(0, 1 - averageNumbers(products.filter((product) => product.category === entry.category).map((product) => product.hoursToExpiry)) / 36),
      2
    ),
    minHoursToExpiry: roundNumber(
      Math.min(
        ...products
          .filter((product) => product.category === entry.category)
          .map((product) => Number(product.hoursToExpiry ?? 999))
      ),
      1
    ),
    tone:
      entry.markdownSharePct >= 0.45
        ? "red"
        : entry.sharePct >= 0.24
          ? "blue"
          : entry.sharePct >= 0.15
            ? "amber"
            : "gray",
    summary:
      entry.markdownSharePct >= 0.45
        ? "Markdown density is high and should be watched closely."
        : entry.sharePct >= 0.24
          ? "This category is carrying the next traffic window."
          : "Assortment is balanced with moderate next-window pull.",
    sharePct: entry.sharePct,
  }));
  const signalWire = buildSignalWire({
    approvals,
    demandForecast,
    districtPattern,
    districtPatterns,
    inventoryLots: products,
    sourceObservations,
    storeRecord: store,
  });

  return {
    generatedAt: now(),
    overview: {
      liveSources: sourceObservations.length,
      forecastUnits: demandForecast.reduce((sum, row) => sum + Number(row.forecastUnits ?? 0), 0),
      chainTrafficRank:
        [...districtPatterns]
          .sort((left, right) => right.avgTraffic - left.avgTraffic)
          .findIndex((pattern) => pattern.storeId === store.id) + 1,
      criticalLots: products.filter((product) => product.statusTone === "critical").length,
      activeMarkdowns: products.filter((product) => Number(product.discountPct ?? 0) > 0).length,
      pendingApprovals: approvals.filter((approval) => approval.status === "pending").length,
    },
    trafficPulse: {
      hours: ANALYTICS_HOURS.map((hour) => ({ hour, label: hourLabel(hour) })),
      actualSeries: districtPattern?.actualSeries ?? [],
      forecastSeries: districtPattern?.forecastSeries ?? [],
      peakWindow: districtPattern?.peakWindow ?? null,
      nextPeakWindow: districtPattern?.nextPeakWindow ?? null,
      momentumPct: districtPattern?.momentumPct ?? 0,
      avgTraffic: districtPattern?.avgTraffic ?? 0,
      avgRevenue: districtPattern?.avgRevenue ?? 0,
      snapshotHour: new Date(snapshotKey).getHours(),
    },
    districtPatterns,
    heatmap: buildHeatmapRows(districtPatterns),
    demandForecast,
    signalWire,
    freshnessBoard: buildFreshnessBoard(sourceObservations),
    assortmentMix,
  };
}

function buildLiveMockAggregatedSnapshot({ products = [], recommendations = [], sourceObservations = [], store }) {
  return {
    storeId: store.id,
    storeName: store.name,
    district: store.district,
    sourceHealth: "healthy",
    observationCount: sourceObservations.length,
    recommendations,
    routeCounts: {
      markdown: recommendations.length,
      unsaleable: 0,
      stockout_risk: recommendations.filter((item) => Number(item.lot?.stockoutRisk ?? 0) >= 0.72).length,
    },
    sourceFreshness: sourceObservations.map((observation) => ({
      sourceType: observation.sourceType,
      freshnessStatus: observation.freshnessStatus,
      freshnessMinutes: observation.freshnessMinutes,
      provenance: observation.provenance,
    })),
    candidateLots: {
      lowRiskMarkdowns: recommendations.filter((item) => Number(item.riskScore ?? 0) < 80).map((item) => item.id),
      highRiskMarkdowns: recommendations.filter((item) => Number(item.riskScore ?? 0) >= 80).map((item) => item.id),
      unsaleable: [],
      stockoutRisk: products.filter((product) => Number(product.stockoutRisk ?? 0) >= 0.72).map((product) => product.lotId),
    },
    metrics: {
      activeLots: products.length,
      atRiskLots: products.filter((product) => Number(product.spoilageRisk ?? 0) >= 0.62).length,
      blockedForFreshness: 0,
    },
  };
}

async function buildLiveMockCatalog(client) {
  const [rows, stores, transactions] = await Promise.all([
    loadInventoryRows(client),
    loadStores(client),
    loadPosTransactions(client),
  ]);
  const snapshotKey = now();
  const currentDate = snapshotKey.slice(0, 10);
  const currentHour = new Date(snapshotKey).getHours();
  const dayOfWeek = new Date(snapshotKey).getDay();
  const recentTransactions = transactions.filter(
    (transaction) => Date.now() - new Date(transaction.createdAt).getTime() < 24 * 60 * 60 * 1000
  );
  const seedsByStore = buildLiveMockSeeds(rows);
  const storeSamples = Object.fromEntries(
    stores.map((store) => {
      const seeds = seedsByStore[store.id] ?? [];
      const products = applyTransactionsToLiveProducts(
        seeds.map((seed) =>
          buildLiveProduct({
            seed,
            snapshotKey,
            store,
            currentHour,
            dayOfWeek,
          })
        ),
        recentTransactions.filter((transaction) => transaction.storeId === store.id)
      );
      const sourceObservations = buildLiveSourceObservations({ products, snapshotKey, store });
      const recommendations = buildLiveMockRecommendations(products, store);

      return [
        store.id,
        {
          storeId: store.id,
          storeName: store.name,
          storeType: store.type,
          archetype: store.archetype,
          displayType: store.displayType,
          district: store.district,
          approvalThresholdPct: store.approvalThresholdPct,
          products,
          sourceObservations,
          recommendations,
        },
      ];
    })
  );
  const districtPatterns = stores.map((store) =>
    buildLiveDistrictPatternCard({
      products: storeSamples[store.id]?.products ?? [],
      snapshotHour: currentHour,
      store,
      storeRows: rows.filter((row) => row.storeId === store.id),
    })
  );

  for (const store of stores) {
    storeSamples[store.id].aggregatedSnapshot = buildLiveMockAggregatedSnapshot({
      products: storeSamples[store.id].products,
      recommendations: storeSamples[store.id].recommendations,
      sourceObservations: storeSamples[store.id].sourceObservations,
      store,
    });
    storeSamples[store.id].analytics = buildLiveStoreAnalytics({
      approvals: [],
      districtPatterns,
      products: storeSamples[store.id].products,
      sourceObservations: storeSamples[store.id].sourceObservations,
      store,
      snapshotKey,
    });
  }

  return {
    version: 1,
    generatedAt: now(),
    snapshotKey,
    currentDate,
    stores: storeSamples,
    districtPatterns,
  };
}

function isLiveMockCatalogFresh(catalog) {
  if (!catalog?.generatedAt) {
    return false;
  }

  return Date.now() - new Date(catalog.generatedAt).getTime() < LIVE_MOCK_TTL_MS;
}

function buildLiveCatalogOutboxEntries(catalog) {
  if (!catalog?.stores) {
    return [];
  }

  return Object.values(catalog.stores).flatMap((storeSample) =>
    (storeSample.products ?? [])
      .map((product) =>
        buildRealtimeOutboxEntry({
          storeId: storeSample.storeId,
          labelUpdate: buildProductLabelUpdate(product, product.snapshotKey),
        })
      )
      .filter(Boolean)
  );
}

async function ensureLiveMockCatalog(client, { force = false, emitUpdates = false } = {}) {
  const existing = await loadSettingValue(client, LIVE_MOCK_SETTINGS_KEY, null);
  if (!force && isLiveMockCatalogFresh(existing)) {
    return existing;
  }

  const catalog = await buildLiveMockCatalog(client);
  await upsertSetting(client, LIVE_MOCK_SETTINGS_KEY, catalog);

  if (emitUpdates) {
    await appendRealtimeOutbox(client, buildLiveCatalogOutboxEntries(catalog));
  }

  return catalog;
}

function applyPosTransactionToLiveCatalog(catalog, record) {
  if (!catalog?.stores?.[record.storeId]) {
    return catalog;
  }

  const nextCatalog = structuredClone(catalog);
  const storeSample = nextCatalog.stores[record.storeId];
  const productsBySkuId = new Map((storeSample.products ?? []).map((product) => [product.skuId, { ...product }]));

  for (const item of record.items ?? []) {
    const skuId = item.sku_id ?? item.skuId ?? item.lot_id ?? item.lotId;
    const quantitySold = Number(item.qty ?? item.quantity ?? 0);
    const product = productsBySkuId.get(skuId);
    if (!product || quantitySold <= 0) {
      continue;
    }

    product.quantity = Math.max(0, Number(product.quantity ?? 0) - quantitySold);
    product.sold = Number(product.sold ?? 0) + quantitySold;
    product.recentVelocity = roundNumber(Number(product.recentVelocity ?? 0) + quantitySold * 0.25, 1);
    product.forecastUnits = Math.max(1, Math.round(Number(product.forecastUnits ?? 0) + quantitySold * 0.5));
    product.revenue = roundMoney(Number(product.revenue ?? 0) + Number(item.unit_price ?? item.unitPrice ?? 0) * quantitySold);
    product.stockoutRisk = roundNumber(
      clampNumber(Number(product.stockoutRisk ?? 0) + quantitySold / Math.max(10, Number(product.imported ?? 1)), 0.05, 0.99),
      2
    );
    product.statusTone =
      product.quantity <= 4
        ? "critical"
        : product.quantity <= 8 || Number(product.spoilageRisk ?? 0) >= 0.62
          ? "watch"
          : "normal";
    productsBySkuId.set(skuId, product);
  }

  storeSample.products = [...productsBySkuId.values()].filter((product) => Number(product.quantity ?? 0) > 0);
  const storeRecord = {
    id: storeSample.storeId,
    name: storeSample.storeName,
    type: storeSample.storeType,
    archetype: storeSample.archetype,
    displayType: storeSample.displayType,
    district: storeSample.district,
    approvalThresholdPct: storeSample.approvalThresholdPct,
  };
  storeSample.sourceObservations = buildLiveSourceObservations({
    products: storeSample.products,
    snapshotKey: nextCatalog.snapshotKey,
    store: storeRecord,
  });
  storeSample.recommendations = buildLiveMockRecommendations(storeSample.products, {
    id: storeSample.storeId,
    approvalThresholdPct: storeSample.approvalThresholdPct ?? 50,
  });
  nextCatalog.districtPatterns = Object.values(nextCatalog.stores).map((entry) => ({
    ...(entry.analytics?.districtPatterns?.find((pattern) => pattern.storeId === entry.storeId) ?? {
      storeId: entry.storeId,
      district: entry.district,
      displayType: entry.displayType,
      actualSeries: [],
      forecastSeries: [],
      series: [],
      peakWindow: "n/a",
      nextPeakWindow: "n/a",
      momentumPct: 0,
      avgTraffic: roundNumber(averageNumbers(entry.products.map((product) => product.itemTraffic)), 2),
      avgRevenue: roundNumber(averageNumbers(entry.products.map((product) => product.revenue)), 0),
      primeCategory: entry.products[0]?.category ?? "Mixed",
    }),
  }));
  storeSample.aggregatedSnapshot = buildLiveMockAggregatedSnapshot({
    products: storeSample.products,
    recommendations: storeSample.recommendations,
    sourceObservations: storeSample.sourceObservations,
    store: storeRecord,
  });
  storeSample.analytics = buildLiveStoreAnalytics({
    approvals: [],
    districtPatterns: nextCatalog.districtPatterns,
    products: storeSample.products,
    sourceObservations: storeSample.sourceObservations,
    store: storeRecord,
    snapshotKey: nextCatalog.snapshotKey,
  });
  return nextCatalog;
}

async function loadOperationalSnapshotKey(client, storeId = null) {
  const snapshots = await loadSnapshots(client);
  const cached = globalScope.__synaptosOperationalSnapshotCache;

  if (
    cached?.snapshotKey &&
    cached.snapshotCount === snapshots.length &&
    snapshots.includes(cached.snapshotKey)
  ) {
    if (storeId && cached.byStore?.[storeId] && snapshots.includes(cached.byStore[storeId])) {
      return cached.byStore[storeId];
    }
    return cached.snapshotKey;
  }

  const storedSnapshotResult = await client.query(
    `SELECT value FROM settings WHERE key = 'operationalSnapshot' LIMIT 1`
  );
  const storedSnapshot = parseJson(storedSnapshotResult.rows[0]?.value, null) ?? null;
  const storedSnapshotKey =
    (storeId ? storedSnapshot?.byStore?.[storeId] : null) ??
    storedSnapshot?.snapshotKey ??
    null;

  if (storedSnapshotKey && snapshots.includes(storedSnapshotKey)) {
    globalScope.__synaptosOperationalSnapshotCache = {
      snapshotCount: snapshots.length,
      snapshotKey: storedSnapshot?.snapshotKey ?? storedSnapshotKey,
      byStore: storedSnapshot?.byStore ?? {},
    };
    return storedSnapshotKey;
  }

  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshotKey = snapshots[index];
    const payload = await computePayload(client, snapshotKey);
    if (payload.latestRun.activeLots.length || payload.latestRun.recommendations.length) {
      globalScope.__synaptosOperationalSnapshotCache = {
        snapshotCount: snapshots.length,
        snapshotKey,
      };
      return snapshotKey;
    }
  }

  const fallback = snapshots.at(-1) ?? null;
  globalScope.__synaptosOperationalSnapshotCache = {
    snapshotCount: snapshots.length,
    snapshotKey: fallback,
  };
  return fallback;
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

  const { csvPath, csvPaths, rows, sourceStats } = readBaselineRows();
  const canonicalCsvPath = writeCanonicalNormalizedCsv(rows);
  const stores = buildStores(rows);
  const snapshots = buildSnapshots(rows);
  const users = buildSeedUsers(stores);
  const skuCount = new Set(rows.map((row) => row.skuName)).size;
  const categoryCount = new Set(rows.map((row) => row.category)).size;
  const operationalSnapshot = resolveOperationalSnapshotsFromRows(rows, snapshots);

  await insertStores(client, stores);
  await insertInventoryRows(client, rows);
  await insertSnapshots(client, snapshots);
  await upsertUsers(client, users);
  if (operationalSnapshot.snapshotKey) {
    await upsertSetting(client, "operationalSnapshot", {
      snapshotKey: operationalSnapshot.snapshotKey,
      byStore: operationalSnapshot.byStore,
      source: path.basename(csvPath),
      sourceFiles: csvPaths.map((entry) => path.basename(entry)),
      updatedAt: now(),
    });
  }
  globalScope.__synaptosOperationalSnapshotCache = null;
  if (operationalSnapshot.snapshotKey) {
    globalScope.__synaptosOperationalSnapshotCache = {
      snapshotCount: snapshots.length,
      snapshotKey: operationalSnapshot.snapshotKey,
      byStore: operationalSnapshot.byStore,
    };
  }

  const summary = {
    rows: rows.length,
    stores: stores.length,
    snapshots: snapshots.length,
    skuCount,
    categoryCount,
    csvPath,
    csvFileName: path.basename(csvPath),
    csvPaths,
    csvFileNames: csvPaths.map((entry) => path.basename(entry)),
    canonicalCsvPath,
    canonicalCsvFileName: path.basename(canonicalCsvPath),
    sourceStats,
    operationalSnapshotKey: operationalSnapshot.snapshotKey,
    operationalSnapshotByStore: operationalSnapshot.byStore,
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
    details: `${rows.length} canonical rows seeded from ${csvPaths.map((entry) => path.basename(entry)).join(", ")} across ${stores.length} stores and ${snapshots.length} snapshots.`,
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
  const liveCatalog = await ensureLiveMockCatalog(pool, { emitUpdates: false });
  const defaultSnapshot = liveCatalog?.snapshotKey ?? (await loadOperationalSnapshotKey(pool));

  return {
    stores,
    snapshots,
    defaultSnapshot,
    latestSnapshot: liveCatalog?.snapshotKey ?? snapshots.at(-1) ?? null,
  };
}

export async function getOperationalSnapshotKey(storeId = null) {
  await ensureInitialized();
  const client = getPool();
  const liveCatalog = await ensureLiveMockCatalog(client, { emitUpdates: false });
  if (liveCatalog?.snapshotKey) {
    return liveCatalog.snapshotKey;
  }
  return loadOperationalSnapshotKey(client, storeId);
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

async function loadSettingValue(client, key, fallback = null) {
  const result = await client.query(`SELECT value FROM settings WHERE key = $1 LIMIT 1`, [key]);
  return result.rows.length ? parseJson(result.rows[0].value, fallback) : fallback;
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
  const payload = parseJson(row.payload_json, {});
  return {
    id: row.id,
    aggregationRunId: row.aggregation_run_id,
    snapshotKey: row.snapshot_key,
    storeId: row.store_id,
    status: row.status,
    sourceHealth: row.source_health,
    payload,
    weather: payload.weather ?? null,
    commodity: payload.commodity ?? null,
    demographic: payload.demographic ?? null,
    posSummary: payload.posSummary ?? payload.pos_summary ?? null,
    conflicts: payload.conflicts ?? [],
    lots: payload.lots ?? [],
    metrics: payload.metrics ?? null,
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
          stageName: row.model_run_stage_name ?? null,
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
    stageName: row.stage_name ?? null,
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

async function loadAggregationRunHistory(client, storeId = null, limit = 8) {
  const result = await client.query(
    `
      SELECT
        ar.id,
        ar.snapshot_key,
        ar.actor_user_id,
        ar.status,
        ar.summary_json,
        ar.created_at,
        ars.store_id,
        ars.source_health
      FROM aggregation_runs ar
      JOIN aggregated_snapshots ars ON ars.aggregation_run_id = ar.id
      WHERE ($1::text IS NULL OR ars.store_id = $1)
      ORDER BY ar.created_at DESC
      LIMIT $2
    `,
    [storeId, limit]
  );

  return result.rows.map((row) => ({
    ...mapAggregationRunRow(row),
    storeId: row.store_id,
    sourceHealth: row.source_health,
  }));
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
        stage_name,
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
        stage_name,
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
      ORDER BY
        store_id ASC,
        CASE
          WHEN stage_name = 'recommendation' THEN 0
          WHEN stage_name IS NULL THEN 1
          ELSE 2
        END,
        created_at DESC
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
        stage_name,
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
        mr.stage_name AS model_run_stage_name,
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

function formatTeamEmail(storeId, team) {
  const safeStoreId = String(storeId ?? "hq").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const safeTeam = String(team ?? "ops").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${safeStoreId}.${safeTeam}@synaptos.local`;
}

function formatSupplierEmail(supplier) {
  const localPart = String(supplier ?? "preferred-supplier")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${localPart || "preferred-supplier"}@partners.synaptos.local`;
}

function formatLabel(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function inferOpsUrgency({ destination = null, hoursToExpiry = null, stockoutRisk = null }) {
  if (destination === "eol" || (hoursToExpiry != null && Number(hoursToExpiry) <= 2)) {
    return "immediate";
  }
  if ((hoursToExpiry != null && Number(hoursToExpiry) <= 6) || Number(stockoutRisk ?? 0) >= 0.78) {
    return "high";
  }
  if (Number(stockoutRisk ?? 0) >= 0.62) {
    return "watch";
  }
  return "normal";
}

function inferPickupWindow(createdAt, urgency) {
  const base = new Date(createdAt ?? now());
  const start = new Date(base);
  const end = new Date(base);
  const offsetHours =
    urgency === "immediate"
      ? 1
      : urgency === "high"
        ? 3
        : urgency === "watch"
          ? 6
          : 8;
  end.setHours(end.getHours() + offsetHours);
  return `${start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}-${end.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function buildLogisticsMessage({
  destinationLabel,
  hoursToExpiry,
  quantity,
  skuName,
  storeName,
  district,
  writeoffValue,
}) {
  const expiryFragment =
    hoursToExpiry != null
      ? `${roundNumber(hoursToExpiry, 1)}h to expiry`
      : "expiry threshold reached";
  return `${storeName} (${district}) should route ${quantity} units of ${skuName} to ${destinationLabel}. ${expiryFragment}. Estimated write-off value ${writeoffValue.toLocaleString()} VND.`;
}

function buildProcurementReason({
  quantity,
  stockoutRisk,
  forecastUnits,
  recentVelocity,
  skuName,
}) {
  return `${skuName} is running at ${roundNumber(recentVelocity ?? 0, 1)} units/hour against a next-window forecast of ${Math.round(forecastUnits ?? 0)} units. Suggested inbound quantity is ${quantity} with stockout risk ${Math.round(Number(stockoutRisk ?? 0) * 100)}%.`;
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
        lr.created_at,
        et.route,
        et.task_type,
        et.dispatched_at,
        et.details_json,
        ap.id AS proposal_id,
        ap.sku_name,
        ap.proposal_type,
        ap.proposed_price,
        ap.recommended_discount_pct,
        ap.metadata_json AS proposal_metadata_json,
        ap.created_at AS proposal_created_at,
        s.name AS store_name,
        s.district,
        s.archetype
      FROM logistics_routes lr
      JOIN execution_tasks et ON et.id = lr.execution_task_id
      JOIN action_proposals ap ON ap.id = et.proposal_id
      JOIN stores s ON s.id = lr.store_id
      WHERE ap.snapshot_key = $1
        AND ($2::text IS NULL OR lr.store_id = $2)
      ORDER BY lr.created_at DESC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map((row) => {
    const metadata = parseJson(row.proposal_metadata_json, {});
    const details = parseJson(row.details_json, {});
    const quantityCandidate = Number(metadata.quantity ?? details?.quantity ?? 1);
    const quantity = Number.isFinite(quantityCandidate) && quantityCandidate > 0 ? quantityCandidate : 1;
    const hoursToExpiryCandidate = Number(metadata.hoursToExpiry);
    const hoursToExpiry = Number.isFinite(hoursToExpiryCandidate) ? hoursToExpiryCandidate : null;
    const destinationLabel = row.destination === "eol" ? "tax write-off hold" : "cross-dock rebalancing";
    const coordinatorEmail = formatTeamEmail(row.store_id, "logistics");
    const managerEmail = formatTeamEmail(row.store_id, "manager");
    const urgency = inferOpsUrgency({ destination: row.destination, hoursToExpiry });
    const originalValue = roundMoney(Number(metadata.basePrice ?? row.proposed_price ?? 0) * quantity);
    const writeoffValue = roundMoney(
      Number(metadata.unitCost ?? metadata.basePrice ?? row.proposed_price ?? 0) * quantity * 0.35
    );
    const pickupWindow = inferPickupWindow(row.created_at, urgency);
    const handoffMessage = buildLogisticsMessage({
      destinationLabel,
      hoursToExpiry,
      quantity,
      skuName: row.sku_name,
      storeName: row.store_name,
      district: row.district,
      writeoffValue,
    });

    return {
      id: row.id,
      executionTaskId: row.execution_task_id,
      proposalId: row.proposal_id,
      storeId: row.store_id,
      storeName: row.store_name,
      district: row.district,
      archetype: row.archetype,
      route: row.route,
      taskType: row.task_type,
      routeType: row.route_type,
      destination: row.destination,
      destinationLabel,
      status: row.status,
      createdAt: row.created_at,
      dispatchedAt: row.dispatched_at,
      skuName: row.sku_name,
      proposalType: row.proposal_type,
      proposedPrice: Number(row.proposed_price ?? 0),
      recommendedDiscountPct:
        row.recommended_discount_pct == null ? null : Number(row.recommended_discount_pct),
      quantity,
      category: metadata.category ?? "unknown",
      hoursToExpiry,
      unitCost: Number(metadata.unitCost ?? 0),
      basePrice: Number(metadata.basePrice ?? row.proposed_price ?? 0),
      originalValue,
      writeoffValue,
      urgency,
      pickupWindow,
      coordinatorName: `${row.district} Logistics`,
      coordinatorEmail,
      managerEmail,
      handoffMessage,
      emailSubject: `[SynaptOS][${row.store_name}] ${formatLabel(row.destination)} routing for ${row.sku_name}`,
      emailBody: [
        `Coordinator: ${row.district} Logistics <${coordinatorEmail}>`,
        `CC: ${managerEmail}`,
        "",
        `Store: ${row.store_name} (${row.store_id})`,
        `District archetype: ${formatLabel(row.archetype)}`,
        `SKU: ${row.sku_name}`,
        `Category: ${metadata.category ?? "unknown"}`,
        `Quantity: ${quantity}`,
        `Route: ${destinationLabel}`,
        `Pickup window: ${pickupWindow}`,
        `Estimated write-off value: ${writeoffValue.toLocaleString()} VND`,
        "",
        handoffMessage,
        "Checklist:",
        "1. Pull units from sale floor and isolate by lot.",
        "2. Confirm counts against SynaptOS ledger before vehicle release.",
        "3. Attach finance note for Decision 222/QD-TTg write-off packet.",
      ].join("\n"),
      callScript: `Call ${row.district} Logistics. Confirm ${quantity} units of ${row.sku_name} are staged for ${destinationLabel} within ${pickupWindow}.`,
      checklist: [
        "Pull stock from the sale floor.",
        "Verify physical quantity against the control tower lot count.",
        "Stage cartons with store ID and timestamp.",
        "Hand finance the tax write-off reference and route receipt.",
      ],
    };
  });
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
        po.created_at,
        et.route,
        et.task_type,
        et.dispatched_at,
        et.details_json,
        ap.id AS proposal_id,
        ap.sku_name,
        ap.proposal_type,
        ap.proposed_price,
        ap.metadata_json AS proposal_metadata_json,
        s.name AS store_name,
        s.district,
        s.archetype
      FROM procurement_orders po
      JOIN execution_tasks et ON et.id = po.execution_task_id
      JOIN action_proposals ap ON ap.id = et.proposal_id
      JOIN stores s ON s.id = po.store_id
      WHERE ap.snapshot_key = $1
        AND ($2::text IS NULL OR po.store_id = $2)
      ORDER BY po.created_at DESC
    `,
    [snapshotKey, storeId]
  );
  return result.rows.map((row) => {
    const metadata = parseJson(row.proposal_metadata_json, {});
    const details = parseJson(row.details_json, {});
    const quantity = Number(row.quantity);
    const estimatedCost = Number(row.estimated_cost);
    const rawStockoutRisk = Number(metadata.stockoutRisk ?? metadata.riskScore ?? 0);
    const stockoutRisk = Number.isFinite(rawStockoutRisk)
      ? rawStockoutRisk > 1
        ? rawStockoutRisk / 100
        : rawStockoutRisk
      : 0;
    const forecastUnits = Number(metadata.forecastUnits ?? quantity * 1.4);
    const recentVelocity = Number(metadata.recentVelocity ?? metadata.velocity ?? 0);
    const supplierEmail = formatSupplierEmail(row.supplier);
    const buyerEmail = formatTeamEmail(row.store_id, "procurement");
    const managerEmail = formatTeamEmail(row.store_id, "manager");
    const urgency = inferOpsUrgency({ stockoutRisk });
    const unitCost = quantity > 0 ? estimatedCost / quantity : Number(metadata.unitCost ?? 0);
    const reasonSummary = buildProcurementReason({
      quantity,
      stockoutRisk,
      forecastUnits,
      recentVelocity,
      skuName: row.sku_name,
    });

    return {
      id: row.id,
      executionTaskId: row.execution_task_id,
      proposalId: row.proposal_id,
      storeId: row.store_id,
      storeName: row.store_name,
      district: row.district,
      archetype: row.archetype,
      route: row.route,
      taskType: row.task_type,
      supplier: row.supplier,
      supplierEmail,
      buyerEmail,
      managerEmail,
      quantity,
      estimatedCost,
      unitCost: roundMoney(unitCost),
      status: row.status,
      createdAt: row.created_at,
      dispatchedAt: row.dispatched_at,
      skuName: row.sku_name,
      proposalType: row.proposal_type,
      category: metadata.category ?? details?.category ?? "unknown",
      proposedPrice: Number(row.proposed_price ?? 0),
      stockoutRisk: roundNumber(clampNumber(stockoutRisk, 0, 1), 2),
      forecastUnits,
      recentVelocity: roundNumber(recentVelocity, 1),
      itemTraffic: roundNumber(Number(metadata.itemTraffic ?? 0), 2),
      confidence: roundNumber(Number(metadata.confidence ?? metadata.confidenceScore ?? 0), 2),
      urgency,
      supplierLeadTime: urgency === "immediate" ? "within 2 hours" : urgency === "high" ? "same shift" : "next delivery wave",
      reasonSummary,
      emailSubject: `[SynaptOS][PO Draft] ${row.store_name} requests ${quantity} units of ${row.sku_name}`,
      emailBody: [
        `To: ${row.supplier} <${supplierEmail}>`,
        `CC: ${row.district} Procurement <${buyerEmail}>, ${managerEmail}`,
        "",
        `Store: ${row.store_name} (${row.store_id})`,
        `District archetype: ${formatLabel(row.archetype)}`,
        `SKU: ${row.sku_name}`,
        `Category: ${metadata.category ?? "unknown"}`,
        `Requested quantity: ${quantity}`,
        `Estimated cost: ${estimatedCost.toLocaleString()} VND`,
        `Required arrival: ${urgency === "immediate" ? "Within 2 hours" : urgency === "high" ? "Before next peak window" : "Next scheduled delivery"}`,
        "",
        reasonSummary,
        "Please confirm fulfillment quantity, ETA, and substitution options if inventory is constrained.",
      ].join("\n"),
      markdownReductionNote: `Hold deeper markdowns on ${row.sku_name} once replenishment is confirmed; route store floor to tactical price defense only.`,
    };
  });
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

  return {
    ...executionTaskDraft,
    id: taskId,
    createdAt,
    dispatchedAt: executionTaskDraft.status === TASK_STATUSES.DISPATCHED ? createdAt : null,
  };
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

function summarizePipelineStages(stageRuns) {
  return stageRuns.reduce(
    (summary, stageRun) => {
      summary.stageCount += 1;
      summary.stageStatuses[stageRun.stageName] = stageRun.status;
      summary.stageConfidences[stageRun.stageName] = stageRun.confidence ?? null;
      if (stageRun.status === "failed") {
        summary.failedStages += 1;
      }
      if (stageRun.status === "partial") {
        summary.partialStages += 1;
      }
      return summary;
    },
    {
      stageCount: 0,
      failedStages: 0,
      partialStages: 0,
      stageStatuses: {},
      stageConfidences: {},
    }
  );
}

function applyLowConfidenceOverride(guardrail, proposal) {
  const confidence = Number(proposal.metadata?.confidence ?? 1);
  if (Number.isFinite(confidence) && confidence < 0.6) {
    return {
      outcome: GUARDRAIL_OUTCOMES.REQUIRES_APPROVAL,
      matchedRule: "low_confidence_requires_human_review",
      executionRoute: EXECUTION_ROUTES.APPROVAL,
      executionStatus: TASK_STATUSES.WAITING_APPROVAL,
      reason: `Proposal confidence ${confidence.toFixed(2)} is below 0.60.`,
    };
  }

  return guardrail;
}

async function persistMultiAgentPipelineArtifacts(client, {
  actorUserId,
  aggregatedSnapshot,
  proposals,
  signalObservations,
  snapshotKey,
  stageRuns,
  storeId,
}) {
  const storePolicies = await loadStores(client);
  const storePolicy = storePolicies.find((store) => store.id === storeId);
  if (!storePolicy) {
    const error = new Error("NOT_FOUND");
    error.code = "NOT_FOUND";
    throw error;
  }

  const createdAt = now();
  const aggregationRunId = crypto.randomUUID();
  const aggregationSummary = {
    snapshotKey,
    storeId,
    observedSourceCount: signalObservations.length,
    storeCount: 1,
    degradedStores: aggregatedSnapshot.sourceHealth !== "healthy" ? 1 : 0,
  };

  await client.query(
    `
      INSERT INTO aggregation_runs (id, snapshot_key, actor_user_id, status, summary_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [aggregationRunId, snapshotKey, actorUserId, "completed", JSON.stringify(aggregationSummary), createdAt]
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
      snapshotKey,
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

  await client.query(
    `
      INSERT INTO aggregated_snapshots
        (id, aggregation_run_id, snapshot_key, store_id, status, source_health, payload_json, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      crypto.randomUUID(),
      aggregationRunId,
      snapshotKey,
      storeId,
      "ready",
      aggregatedSnapshot.sourceHealth,
      JSON.stringify(aggregatedSnapshot),
      createdAt,
    ]
  );

  const stageSummary = summarizePipelineStages(stageRuns);
  const agentRunId = crypto.randomUUID();
  const agentSummary = {
    ...stageSummary,
    storeId,
    sourceHealth: aggregatedSnapshot.sourceHealth,
    proposalCount: proposals.length,
    campaignWindowCount:
      stageRuns.find((stageRun) => stageRun.stageName === "campaign")?.output?.windows?.length ?? 0,
  };

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
      stageSummary.failedStages === stageSummary.stageCount ? "failed" : "completed",
      JSON.stringify(agentSummary),
      createdAt,
    ]
  );

  const actor =
    (await loadUserById(client, actorUserId))?.name ??
    (await loadDefaultSessionUser(client))?.name ??
    "SynaptOS";

  const modelRuns = [];
  for (const stageRun of stageRuns) {
    const modelRunId = crypto.randomUUID();
    await client.query(
      `
        INSERT INTO model_runs
          (id, agent_run_id, aggregation_run_id, snapshot_key, store_id, actor_user_id, provider, model,
           stage_name, rollout_mode, prompt_template_name, prompt_template_version, status, parse_status, retry_count,
           latency_ms, estimated_cost, usage_json, failure_code, failure_reason, created_at, completed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      `,
      [
        modelRunId,
        agentRunId,
        aggregationRunId,
        snapshotKey,
        storeId,
        actorUserId,
        stageRun.provider,
        stageRun.model,
        stageRun.stageName,
        storePolicy.llmMode ?? LLM_ROLLOUT_MODES.SHADOW,
        stageRun.stageName,
        "1.0.0",
        stageRun.status,
        stageRun.parseStatus,
        stageRun.retryCount ?? 0,
        stageRun.latencyMs,
        0,
        JSON.stringify(stageRun.usage ?? {}),
        stageRun.failureCode,
        stageRun.failureReason,
        stageRun.createdAt,
        stageRun.completedAt,
      ]
    );

    await client.query(
      `
        INSERT INTO model_input_artifacts (id, model_run_id, prompt_context_json, request_json, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [
        crypto.randomUUID(),
        modelRunId,
        JSON.stringify(stageRun.inputArtifact?.promptContext ?? {}),
        JSON.stringify(stageRun.inputArtifact?.request ?? {}),
        stageRun.createdAt,
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
        modelRunId,
        stageRun.outputArtifact?.rawText ?? "",
        stageRun.outputArtifact?.rawJson == null ? null : JSON.stringify(stageRun.outputArtifact.rawJson),
        stageRun.outputArtifact?.parsedOutput == null
          ? null
          : JSON.stringify(stageRun.outputArtifact.parsedOutput),
        stageRun.outputArtifact?.parseStatus ?? stageRun.parseStatus,
        stageRun.outputArtifact?.errorCode ?? stageRun.failureCode,
        stageRun.outputArtifact?.errorMessage ?? stageRun.failureReason,
        stageRun.createdAt,
      ]
    );

    const persistedRun = {
      ...stageRun,
      id: modelRunId,
      agentRunId,
      aggregationRunId,
      snapshotKey,
      storeId,
      mode: storePolicy.llmMode ?? LLM_ROLLOUT_MODES.SHADOW,
      promptTemplateName: stageRun.stageName,
      promptTemplateVersion: "1.0.0",
      estimatedCost: 0,
    };
    modelRuns.push(persistedRun);

    await insertAuditEvent(client, {
      type: AUDIT_TYPES.MODEL_RUN,
      storeId,
      actor,
      actorUserId,
      message: `${stageRun.stageName} agent ${stageRun.status}`,
      details:
        stageRun.status === "failed"
          ? `${stageRun.failureCode ?? "PIPELINE_STAGE_FAILED"}: ${stageRun.failureReason ?? "unknown failure"}`
          : `${stageRun.provider}/${stageRun.model} finished with ${stageRun.parseStatus}.`,
      createdAt: stageRun.createdAt,
    });
  }

  await clearControlTowerSnapshotState(client, snapshotKey, [storeId]);

  const recommendationModelRun =
    modelRuns.find((modelRun) => modelRun.stageName === "recommendation") ??
    modelRuns[modelRuns.length - 1] ??
    null;

  const persistedProposals = [];
  const guardrailEvaluations = [];
  const approvalRequests = [];
  const executionTasks = [];

  for (const draft of proposals) {
    const proposalId = crypto.randomUUID();
    const evaluatedGuardrail = evaluateProposal({
      proposal: { ...draft, id: proposalId },
      storePolicy,
      sourceHealth: aggregatedSnapshot.sourceHealth,
    });
    const guardrail = applyLowConfidenceOverride(evaluatedGuardrail, draft);

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
      modelRunId: recommendationModelRun?.id ?? null,
      aggregationRunId,
      snapshotKey,
      storeId,
      executionRoute: guardrail.executionRoute,
      status,
      metadata: {
        ...(draft.metadata ?? {}),
        provider: recommendationModelRun?.provider ?? null,
        model: recommendationModelRun?.model ?? null,
        mode: recommendationModelRun?.mode ?? null,
        parseStatus: recommendationModelRun?.parseStatus ?? null,
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
        proposal.modelRunId,
        aggregationRunId,
        snapshotKey,
        storeId,
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
    persistedProposals.push(proposal);

    const guardrailRecord = {
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      storeId,
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

  await insertAuditEvent(client, {
    type: AUDIT_TYPES.AGGREGATION,
    storeId,
    actor,
    actorUserId,
    message: "Multi-agent aggregation completed",
    details: `${signalObservations.length} signal observations persisted for ${storePolicy.name}.`,
    createdAt,
  });

  await insertAuditEvent(client, {
    type: AUDIT_TYPES.PROPOSAL_GENERATION,
    storeId,
    actor,
    actorUserId,
    message: "Multi-agent proposal generation completed",
    details: `${persistedProposals.length} proposals generated and ${executionTasks.length} tasks dispatched.`,
    createdAt,
  });

  for (const evaluation of guardrailEvaluations) {
    await insertAuditEvent(client, {
      type: AUDIT_TYPES.GUARDRAIL,
      storeId,
      actor,
      actorUserId,
      message: `Guardrail ${evaluation.outcome} for proposal ${evaluation.proposalId}`,
      details: `${evaluation.matchedRule}: ${evaluation.reason}`,
      createdAt: evaluation.createdAt,
    });
  }

  for (const task of executionTasks) {
    await insertAuditEvent(client, {
      type: AUDIT_TYPES.EXECUTION,
      storeId,
      actor,
      actorUserId,
      message: `${task.route} task dispatched`,
      details: `Execution task ${task.id} was auto-dispatched in the pipeline.`,
      createdAt: task.createdAt,
    });
  }

  return {
    aggregationRun: {
      id: aggregationRunId,
      snapshotKey,
      actorUserId,
      status: "completed",
      summary: aggregationSummary,
      createdAt,
    },
    agentRun: {
      id: agentRunId,
      aggregationRunId,
      snapshotKey,
      actorUserId,
      status: stageSummary.failedStages === stageSummary.stageCount ? "failed" : "completed",
      summary: {
        ...agentSummary,
        routeSummary: {
          autoDispatched: executionTasks.length,
          pendingApproval: approvalRequests.length,
          blocked: guardrailEvaluations.filter((evaluation) => evaluation.outcome === GUARDRAIL_OUTCOMES.BLOCKED).length,
        },
      },
      createdAt,
    },
    modelRuns,
    proposals: persistedProposals,
    guardrailEvaluations,
    approvalRequests,
    executionTasks,
    signalObservations,
    aggregatedSnapshots: [
      {
        id: aggregationRunId,
        aggregationRunId,
        snapshotKey,
        storeId,
        status: "ready",
        sourceHealth: aggregatedSnapshot.sourceHealth,
        payload: aggregatedSnapshot,
        createdAt,
      },
    ],
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

export async function persistMultiAgentPipelineRun({
  actorUserId,
  aggregatedSnapshot,
  proposals,
  signalObservations,
  snapshotKey,
  stageRuns,
  storeId,
  user = null,
}) {
  const result = await withTransaction((client) =>
    persistMultiAgentPipelineArtifacts(client, {
      actorUserId,
      aggregatedSnapshot,
      proposals,
      signalObservations,
      snapshotKey,
      stageRuns,
      storeId,
    })
  );

  await appendRealtimeOutbox(
    getPool(),
    result.executionTasks
      .map((task) => {
        const labelUpdate = task.labelUpdate ?? task.details?.labelUpdate ?? null;
        if (task.route !== EXECUTION_ROUTES.LABEL || !labelUpdate) {
          return null;
        }

        return buildRealtimeOutboxEntry({
          storeId: task.storeId,
          labelUpdate,
        });
      })
      .filter(Boolean)
  );

  return {
    ...result,
    modelRuns: filterByUserStore(result.modelRuns, user),
    proposals: filterByUserStore(result.proposals, user),
    guardrailEvaluations: filterByUserStore(result.guardrailEvaluations, user),
    approvalRequests: filterByUserStore(result.approvalRequests, user),
    executionTasks: filterByUserStore(result.executionTasks, user),
    signalObservations: filterByUserStore(result.signalObservations, user),
    aggregatedSnapshots: filterByUserStore(result.aggregatedSnapshots, user),
  };
}

export async function listControlTowerStores(user) {
  await ensureInitialized();
  const client = getPool();
  const stores = await getAccessibleStores(user);
  const latestSnapshot = await loadOperationalSnapshotKey(client);
  const currentPayload = latestSnapshot ? await computePayload(client, latestSnapshot) : null;
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
    ...summarizeStoreMetrics(
      currentPayload?.latestRun.activeLots.filter((lot) => lot.storeId === store.id) ?? [],
      decorateInventoryLots(
        currentPayload?.latestRun.activeLots.filter((lot) => lot.storeId === store.id) ?? [],
        currentPayload?.latestRun.recommendations.filter(
          (recommendation) => recommendation.storeId === store.id
        ) ?? [],
        currentPayload?.labels ?? {}
      )
    ),
    id: store.id,
    district: store.district,
    archetype: store.archetype,
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

function buildDerivedAggregationDetail({ payload, snapshotKey, stores, storeId }) {
  const signalObservations = buildSignalObservations({ snapshotKey, stores, payload });
  const aggregatedSnapshots = buildAggregatedSnapshots({
    stores,
    payload,
    signalObservations,
  });
  const storeSnapshot =
    aggregatedSnapshots.find((snapshot) => snapshot.storeId === storeId) ?? null;
  const summary = buildAggregationRunSummary({
    snapshotKey,
    signalObservations,
    aggregatedSnapshots,
  });
  const createdAt = payload.latestRun.generatedAt ?? now();

  return {
    aggregationRun: {
      id: `derived:${snapshotKey}`,
      snapshotKey,
      actorUserId: null,
      status: "derived",
      summary,
      createdAt,
      derived: true,
    },
    sourceObservations: signalObservations.filter((observation) => observation.storeId === storeId),
    aggregatedSnapshot: storeSnapshot,
    aggregationHistory: storeSnapshot
      ? [
          {
            id: `derived:${storeId}:${snapshotKey}`,
            snapshotKey,
            actorUserId: null,
            status: "derived",
            summary,
            createdAt,
            storeId,
            sourceHealth: storeSnapshot.sourceHealth,
            derived: true,
          },
        ]
      : [],
  };
}

export async function getStoreControlTowerDetail({ storeId, snapshotKey, user }) {
  await ensureInitialized();
  const client = getPool();
  const runtime = await getRuntimeSelection(storeId, user);
  const stores = await loadStores(client);
  const storeRecord = stores.find((store) => store.id === storeId) ?? null;
  const liveCatalog = await ensureLiveMockCatalog(client, { emitUpdates: false });
  const liveStore = liveCatalog?.stores?.[storeId] ?? null;
  const requestedSnapshotKey = snapshotKey ?? (await loadOperationalSnapshotKey(client)) ?? null;
  const storeSnapshotKey = await loadOperationalSnapshotKey(client, storeId);
  let targetSnapshotKey = requestedSnapshotKey ?? storeSnapshotKey ?? null;

  if (!targetSnapshotKey) {
    return {
      storeId,
      store: storeRecord,
      mode: runtime.mode,
      llmMode: runtime.llmMode,
      snapshotKey: null,
      aggregationRun: null,
      aggregationHistory: [],
      latestModelRun: null,
      modelRunHistory: [],
      sourceObservations: [],
      aggregatedSnapshot: null,
      inventoryLots: [],
      currentRecommendations: [],
      storeMetrics: summarizeStoreMetrics([], []),
      proposals: [],
      approvals: [],
      logisticsTasks: [],
      procurementOrders: [],
      labels: {},
      audit: [],
      analytics: buildEmptyStoreAnalytics(),
    };
  }

  if (liveStore?.products?.length && storeRecord) {
    const persistedLabels = await loadLabels(client);
    const liveProducts = applyLabelsToLiveProducts(liveStore.products, persistedLabels);
    const persistedAggregationRun = await loadLatestAggregationRun(client, liveCatalog.snapshotKey);
    const persistedAggregatedSnapshot = persistedAggregationRun
      ? (await loadAggregatedSnapshotsForRun(client, persistedAggregationRun.id)).find(
          (snapshot) => snapshot.storeId === storeId
        ) ?? null
      : null;
    const persistedSourceObservations = persistedAggregationRun
      ? await loadSignalObservationsForRun(client, persistedAggregationRun.id, storeId)
      : [];
    const aggregationHistory = await loadAggregationRunHistory(client, storeId);
    const modelRunHistory = await loadModelRunHistory(client, liveCatalog.snapshotKey, storeId);
    const approvals = await loadApprovalRequests(client, liveCatalog.snapshotKey, storeId);
    const logisticsTasks = await loadLogisticsRoutes(client, liveCatalog.snapshotKey, storeId);
    const procurementOrders = await loadProcurementOrders(client, liveCatalog.snapshotKey, storeId);
    const executionTasks = await loadExecutionTasks(client, liveCatalog.snapshotKey, storeId);
    const guardrailEvaluations = await loadGuardrailEvaluations(client, liveCatalog.snapshotKey, storeId);
    const proposals = await loadProposals(client, liveCatalog.snapshotKey, storeId);
    const audit = await listAuditEvents(storeId);
    const labels = Object.fromEntries(
      liveProducts.map((product) => [
        product.lotId,
        {
          currentPrice: product.currentPrice,
          previousPrice: product.originalPrice,
          status: Number(product.discountPct ?? 0) > 0 ? "published" : "hold",
          recommendationId: liveStore.recommendations.find((item) => item.lotId === product.lotId)?.id ?? null,
          updatedAt: liveCatalog.generatedAt,
        },
      ])
    );

    return {
      storeId,
      store: storeRecord,
      mode: runtime.mode,
      llmMode: runtime.llmMode,
      snapshotKey: liveCatalog.snapshotKey,
      aggregationRun:
        persistedAggregationRun ?? {
          id: `live-mock:${storeId}:${liveCatalog.snapshotKey}`,
          snapshotKey: liveCatalog.snapshotKey,
          actorUserId: null,
          status: "live_mock",
          summary: {
            snapshotKey: liveCatalog.snapshotKey,
            observedSourceCount: liveStore.sourceObservations.length,
            storeCount: Object.keys(liveCatalog.stores ?? {}).length,
            degradedStores: 0,
          },
          createdAt: liveCatalog.generatedAt,
          derived: true,
        },
      aggregationHistory: aggregationHistory.length
        ? aggregationHistory
        : [
            {
              id: `live-mock:${storeId}:${liveCatalog.snapshotKey}`,
              snapshotKey: liveCatalog.snapshotKey,
              actorUserId: null,
              status: "live_mock",
              summary: {
                observedSourceCount: liveStore.sourceObservations.length,
                storeCount: Object.keys(liveCatalog.stores ?? {}).length,
                degradedStores: 0,
              },
              createdAt: liveCatalog.generatedAt,
              storeId,
              sourceHealth: "healthy",
              derived: true,
            },
          ],
      latestModelRun: modelRunHistory[0] ?? null,
      modelRunHistory,
      sourceObservations: persistedSourceObservations.length ? persistedSourceObservations : liveStore.sourceObservations,
      aggregatedSnapshot: persistedAggregatedSnapshot ?? liveStore.aggregatedSnapshot,
      inventoryLots: liveProducts,
      currentRecommendations: liveStore.recommendations,
      storeMetrics: summarizeStoreMetrics(
        liveProducts.map((product) => ({
          lotId: product.lotId,
          totalImported: product.imported,
          totalWaste: product.waste,
          quantityOnHand: product.quantity,
        })),
        liveProducts
      ),
      proposals: summarizeProposalState(proposals, guardrailEvaluations, approvals, executionTasks),
      approvals,
      logisticsTasks,
      procurementOrders,
      executionTasks,
      labels,
      audit,
      analytics: {
        ...(liveStore.analytics ?? buildEmptyStoreAnalytics()),
        assortmentMix: buildAssortmentMix(liveProducts),
      },
      simulated: true,
    };
  }

  let currentPayload = await computePayload(client, targetSnapshotKey);
  let activeLotsForSnapshot = currentPayload.latestRun.activeLots.filter((lot) => lot.storeId === storeId);
  let currentRecommendationsForSnapshot = currentPayload.latestRun.recommendations.filter(
    (recommendation) => recommendation.storeId === storeId
  );

  if (
    storeSnapshotKey &&
    targetSnapshotKey !== storeSnapshotKey &&
    !activeLotsForSnapshot.length &&
    !currentRecommendationsForSnapshot.length
  ) {
    targetSnapshotKey = storeSnapshotKey;
    currentPayload = await computePayload(client, targetSnapshotKey);
    activeLotsForSnapshot = currentPayload.latestRun.activeLots.filter((lot) => lot.storeId === storeId);
    currentRecommendationsForSnapshot = currentPayload.latestRun.recommendations.filter(
      (recommendation) => recommendation.storeId === storeId
    );
  }
  const derivedAggregation = buildDerivedAggregationDetail({
    payload: currentPayload,
    snapshotKey: targetSnapshotKey,
    stores,
    storeId,
  });
  const persistedAggregationRun = await loadLatestAggregationRun(client, targetSnapshotKey);
  const persistedAggregatedSnapshot = persistedAggregationRun
    ? (await loadAggregatedSnapshotsForRun(client, persistedAggregationRun.id)).find(
        (snapshot) => snapshot.storeId === storeId
      ) ?? null
    : null;
  const persistedSourceObservations = persistedAggregationRun
    ? await loadSignalObservationsForRun(client, persistedAggregationRun.id, storeId)
    : [];
  const aggregationHistory = await loadAggregationRunHistory(client, storeId);
  const aggregationRun = persistedAggregationRun ?? derivedAggregation.aggregationRun;
  const aggregatedSnapshot = persistedAggregatedSnapshot ?? derivedAggregation.aggregatedSnapshot;
  const sourceObservations =
    persistedSourceObservations.length
      ? persistedSourceObservations
      : derivedAggregation.sourceObservations;
  const modelRunHistory = await loadModelRunHistory(client, targetSnapshotKey, storeId);
  const latestModelRun =
    modelRunHistory.find((modelRun) => modelRun.stageName === "recommendation") ??
    modelRunHistory[0] ??
    null;
  const proposals = await loadProposals(client, targetSnapshotKey, storeId);
  const guardrailEvaluations = await loadGuardrailEvaluations(client, targetSnapshotKey, storeId);
  const approvals = await loadApprovalRequests(client, targetSnapshotKey, storeId);
  const executionTasks = await loadExecutionTasks(client, targetSnapshotKey, storeId);
  const logisticsTasks = await loadLogisticsRoutes(client, targetSnapshotKey, storeId);
  const procurementOrders = await loadProcurementOrders(client, targetSnapshotKey, storeId);
  const labels = await listLabels(storeId);
  const audit = await listAuditEvents(storeId);
  const activeLots = activeLotsForSnapshot;
  const currentRecommendations = currentRecommendationsForSnapshot;
  const inventoryLots = decorateInventoryLots(
    activeLots,
    currentRecommendations,
    labels,
    aggregatedSnapshot
  );
  const analyticsRows = await loadInventoryRows(client);
  const analytics = buildStoreAnalytics({
    activeLots,
    approvals,
    inventoryLots,
    sourceObservations,
    rows: analyticsRows,
    snapshotKey: targetSnapshotKey,
    storeRecord,
    stores,
  });

  return {
    storeId,
    store: storeRecord,
    mode: runtime.mode,
    llmMode: runtime.llmMode,
    snapshotKey: targetSnapshotKey,
    aggregationRun,
    aggregationHistory: aggregationHistory.length ? aggregationHistory : derivedAggregation.aggregationHistory,
    latestModelRun,
    modelRunHistory,
    sourceObservations,
    aggregatedSnapshot,
    inventoryLots,
    currentRecommendations,
    storeMetrics: summarizeStoreMetrics(activeLots, inventoryLots),
    proposals: summarizeProposalState(proposals, guardrailEvaluations, approvals, executionTasks),
    approvals,
    logisticsTasks,
    procurementOrders,
    executionTasks,
    labels,
    audit,
    analytics,
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
  const targetSnapshot = snapshotKey ?? (await loadOperationalSnapshotKey(client));
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
        executionTask = await persistExecutionTask(client, buildLabelExecution({ proposal }));
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
  if (result.executionTask) {
    publishExecutionUpdated({
      taskId: result.executionTask.id,
      route: result.executionTask.route,
    });
    if (result.executionTask.route === EXECUTION_ROUTES.LABEL && result.executionTask.labelUpdate) {
      await appendRealtimeOutbox(getPool(), [
        buildRealtimeOutboxEntry({
          storeId: result.executionTask.storeId,
          labelUpdate: result.executionTask.labelUpdate,
        }),
      ]);
    }
  }

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
  if (result.route === EXECUTION_ROUTES.LABEL && result.details?.labelUpdate) {
    await appendRealtimeOutbox(getPool(), [
      buildRealtimeOutboxEntry({
        storeId: result.storeId,
        labelUpdate: result.details.labelUpdate,
      }),
    ]);
  }

  return result;
}

export async function listLogisticsWorkbench({ snapshotKey, user }) {
  await ensureInitialized();
  const client = getPool();
  const targetSnapshot = snapshotKey ?? (await loadOperationalSnapshotKey(client));
  if (!targetSnapshot) {
    return [];
  }
  return loadLogisticsRoutes(client, targetSnapshot, user?.role === "admin" ? null : user?.storeId);
}

export async function listProcurementWorkbench({ snapshotKey, user }) {
  await ensureInitialized();
  const client = getPool();
  const targetSnapshot = snapshotKey ?? (await loadOperationalSnapshotKey(client));
  if (!targetSnapshot) {
    return [];
  }
  return loadProcurementOrders(client, targetSnapshot, user?.role === "admin" ? null : user?.storeId);
}

function mapCampaignRow(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    type: row.type,
    targetCategory: row.target_category,
    targetSkuId: row.target_sku_id,
    discountPct: row.discount_pct == null ? null : Number(row.discount_pct),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapPosTransactionRow(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    cashier: row.cashier,
    items: parseJson(row.items, []),
    total: Number(row.total),
    createdAt: row.created_at,
  };
}

async function loadCampaignRows(client, { storeId = null, status = null } = {}) {
  const result = await client.query(
    `
      SELECT
        id,
        store_id,
        name,
        type,
        target_category,
        target_sku_id,
        discount_pct,
        starts_at,
        ends_at,
        status,
        created_by,
        created_at
      FROM campaigns
      WHERE ($1::text IS NULL OR store_id = $1)
        AND ($2::text IS NULL OR status = $2)
      ORDER BY starts_at DESC, created_at DESC
    `,
    [storeId, status]
  );

  return result.rows.map(mapCampaignRow);
}

async function loadCampaignById(client, campaignId) {
  const rows = await loadCampaignRows(client);
  return rows.find((campaign) => campaign.id === campaignId) ?? null;
}

async function loadPosTransactions(client, storeId = null) {
  const result = await client.query(
    `
      SELECT id, store_id, cashier, items, total, created_at
      FROM pos_transactions
      WHERE ($1::text IS NULL OR store_id = $1)
      ORDER BY created_at DESC
    `,
    [storeId]
  );

  return result.rows.map((row) =>
    mapPosTransactionRow({
      ...row,
      items: row.items,
    })
  );
}

function overlayPosTransactions(products, transactions) {
  const soldBySkuId = new Map();

  for (const transaction of transactions) {
    for (const item of transaction.items ?? []) {
      const skuId = item.sku_id ?? item.skuId ?? item.lot_id ?? item.lotId;
      if (!skuId) {
        continue;
      }
      soldBySkuId.set(skuId, (soldBySkuId.get(skuId) ?? 0) + Number(item.qty ?? item.quantity ?? 0));
    }
  }

  return products
    .map((product) => ({
      ...product,
      quantity: Math.max(0, Number(product.quantity ?? 0) - Number(soldBySkuId.get(product.skuId) ?? 0)),
    }))
    .filter((product) => product.quantity > 0);
}

function campaignTargetsProduct(campaign, product) {
  if (campaign.targetSkuId) {
    return product.skuId === campaign.targetSkuId;
  }

  if (campaign.targetCategory) {
    return String(product.category ?? "").toLowerCase() === String(campaign.targetCategory).toLowerCase();
  }

  return true;
}

async function buildStorefrontProducts(client, storeId, { emitLiveUpdates = false } = {}) {
  const store = (await loadStores(client)).find((entry) => entry.id === storeId) ?? null;
  const liveCatalog = await ensureLiveMockCatalog(client, { emitUpdates: emitLiveUpdates });
  const liveStore = liveCatalog?.stores?.[storeId] ?? null;
  const persistedLabels = await loadLabels(client);

  if (store && liveStore?.products?.length) {
    return {
      snapshotKey: liveCatalog.snapshotKey,
      store,
      products: applyLabelsToLiveProducts(liveStore.products, persistedLabels),
      liveSample: true,
    };
  }

  const snapshotKey = await loadOperationalSnapshotKey(client);
  const payload = snapshotKey ? await computePayload(client, snapshotKey) : null;

  if (!store || !payload) {
    return { snapshotKey, store, products: [] };
  }

  const activeLots = payload.latestRun.activeLots.filter((lot) => lot.storeId === storeId);
  const currentRecommendations = payload.latestRun.recommendations.filter(
    (recommendation) => recommendation.storeId === storeId
  );
  const products = decorateInventoryLots(activeLots, currentRecommendations, persistedLabels);

  return {
    snapshotKey,
    store,
    products,
    liveSample: false,
  };
}

async function upsertSetting(client, key, value) {
  await client.query(
    `
      INSERT INTO settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = NOW()
    `,
    [key, JSON.stringify(value)]
  );
}

async function appendRealtimeOutbox(client, entries) {
  const nextEntries = (entries ?? []).filter(Boolean);
  if (!nextEntries.length) {
    return;
  }

  const existing = await loadSettingValue(client, REALTIME_OUTBOX_SETTINGS_KEY, {
    version: 1,
    events: [],
  });
  const merged = [...(existing?.events ?? []), ...nextEntries].slice(-2500);

  await upsertSetting(client, REALTIME_OUTBOX_SETTINGS_KEY, {
    version: 1,
    events: merged,
  });
}

export async function getStoreRecord(storeId) {
  await ensureInitialized();
  const stores = await loadStores(getPool());
  return stores.find((store) => store.id === storeId) ?? null;
}

export async function updateStoreRecord(storeId, updates = {}) {
  await ensureInitialized();

  return withTransaction(async (client) => {
    const assignments = [];
    const values = [storeId];

    const fieldMap = {
      name: "name",
      district: "district",
      archetype: "archetype",
      displayType: "display_type",
      llmMode: "llm_mode",
      controlTowerEnabled: "control_tower_enabled",
      approvalThresholdPct: "approval_threshold_pct",
      markdownMaxAutoDiscountPct: "markdown_max_auto_discount_pct",
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (updates[key] === undefined) {
        continue;
      }
      values.push(updates[key]);
      assignments.push(`${column} = $${values.length}`);
    }

    if (assignments.length) {
      await client.query(`UPDATE stores SET ${assignments.join(", ")} WHERE id = $1`, values);
    }

    return (await loadStores(client)).find((store) => store.id === storeId) ?? null;
  });
}

export async function listCampaigns({ storeId = null, status = null } = {}) {
  await ensureInitialized();
  return loadCampaignRows(getPool(), { storeId, status });
}

export async function createCampaign({
  storeId,
  name,
  type,
  targetCategory = null,
  targetSkuId = null,
  discountPct,
  startsAt,
  endsAt,
  createdBy = null,
}) {
  await ensureInitialized();

  return withTransaction(async (client) => {
    const record = {
      id: crypto.randomUUID(),
      storeId,
      name: name ?? null,
      type,
      targetCategory,
      targetSkuId,
      discountPct: Number(discountPct),
      startsAt,
      endsAt,
      status: "scheduled",
      createdBy,
      createdAt: now(),
    };

    await client.query(
      `
        INSERT INTO campaigns
          (id, store_id, name, type, target_category, target_sku_id, discount_pct, starts_at, ends_at, status, created_by, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        record.id,
        record.storeId,
        record.name,
        record.type,
        record.targetCategory,
        record.targetSkuId,
        record.discountPct,
        record.startsAt,
        record.endsAt,
        record.status,
        record.createdBy,
        record.createdAt,
      ]
    );

    return record;
  });
}

export async function updateCampaignStatus(campaignId, status) {
  await ensureInitialized();
  await getPool().query(`UPDATE campaigns SET status = $2 WHERE id = $1`, [campaignId, status]);
}

export async function deleteCampaign(campaignId) {
  await ensureInitialized();
  const result = await getPool().query(
    `
      DELETE FROM campaigns
      WHERE id = $1
      RETURNING id, store_id, name, type, target_category, target_sku_id, discount_pct, starts_at, ends_at, status, created_by, created_at
    `,
    [campaignId]
  );

  return result.rows.length ? mapCampaignRow(result.rows[0]) : null;
}

export async function getCampaignsToActivate() {
  await ensureInitialized();
  return loadCampaignRows(getPool(), { status: "scheduled" }).then((campaigns) =>
    campaigns.filter((campaign) => new Date(campaign.startsAt).getTime() <= Date.now())
  );
}

export async function getCampaignsToExpire() {
  await ensureInitialized();
  return loadCampaignRows(getPool(), { status: "active" }).then((campaigns) =>
    campaigns.filter((campaign) => new Date(campaign.endsAt).getTime() <= Date.now())
  );
}

export async function getActiveCampaigns(storeId = null) {
  await ensureInitialized();
  return loadCampaignRows(getPool(), { storeId, status: "active" });
}

export async function applyCampaignPrices(campaignOrId) {
  await ensureInitialized();

  return withTransaction(async (client) => {
    const campaign =
      typeof campaignOrId === "string" ? await loadCampaignById(client, campaignOrId) : campaignOrId;

    if (!campaign) {
      return [];
    }

    const { products } = await buildStorefrontProducts(client, campaign.storeId);
    const targets = products.filter((product) => campaignTargetsProduct(campaign, product));

    await upsertLabels(
      client,
      Object.fromEntries(
        targets.map((product) => {
          const currentPrice = Number(
            Math.max(0, Math.round(product.currentPrice * (1 - Number(campaign.discountPct ?? 0) / 100)))
          );

          return [
            product.lotId,
            {
              currentPrice,
              previousPrice: product.currentPrice,
              status: "campaign_active",
              recommendationId: `campaign:${campaign.id}`,
              updatedAt: now(),
            },
          ];
        })
      )
    );

    return targets.map((product) => ({
      storeId: campaign.storeId,
      labelUpdate: {
        lotId: product.lotId,
        skuId: product.skuId,
        productName: product.productName,
        currentPrice: Number(
          Math.max(0, Math.round(product.currentPrice * (1 - Number(campaign.discountPct ?? 0) / 100)))
        ),
        previousPrice: product.currentPrice,
        originalPrice: product.currentPrice,
        discountPct: Number(campaign.discountPct ?? 0),
        expiryIso: product.expiryIso,
        unit: product.unit,
      },
    }));
  });
}

export async function revertCampaignPrices(campaignOrId) {
  await ensureInitialized();

  return withTransaction(async (client) => {
    const campaign =
      typeof campaignOrId === "string" ? await loadCampaignById(client, campaignOrId) : campaignOrId;

    if (!campaign) {
      return [];
    }

    const labels = await loadLabels(client);
    const { products } = await buildStorefrontProducts(client, campaign.storeId);
    const targets = products.filter((product) => campaignTargetsProduct(campaign, product));

    await upsertLabels(
      client,
      Object.fromEntries(
        targets.map((product) => {
          const existing = labels[product.lotId] ?? null;
          const revertedPrice = Number(existing?.previousPrice ?? product.originalPrice ?? product.currentPrice);

          return [
            product.lotId,
            {
              currentPrice: revertedPrice,
              previousPrice: revertedPrice,
              status: revertedPrice < Number(product.originalPrice ?? revertedPrice) ? "published" : "hold",
              recommendationId: `campaign:${campaign.id}`,
              updatedAt: now(),
            },
          ];
        })
      )
    );

    return targets.map((product) => {
      const existing = labels[product.lotId] ?? null;
      const revertedPrice = Number(existing?.previousPrice ?? product.originalPrice ?? product.currentPrice);

      return {
        storeId: campaign.storeId,
        labelUpdate: {
          lotId: product.lotId,
          skuId: product.skuId,
          productName: product.productName,
          currentPrice: revertedPrice,
          previousPrice: revertedPrice,
          originalPrice: revertedPrice,
          discountPct: null,
          expiryIso: product.expiryIso,
          unit: product.unit,
        },
      };
    });
  });
}

export async function getSettingsBundle() {
  await ensureInitialized();
  const client = getPool();
  const stores = await loadStores(client);
  const result = await client.query(`SELECT key, value FROM settings`);
  const entries = Object.fromEntries(result.rows.map((row) => [row.key, parseJson(row.value, null)]));

  return {
    thresholds: entries.thresholds ?? {
      autoMarkdownMaxPct: AUTO_MARKDOWN_THRESHOLD_PCT,
      approvalThresholdPct: 50,
      lowConfidenceThreshold: 0.6,
      signalStalenessMinutes: {
        fresh: 60,
        degraded: 240,
      },
    },
    storeProfiles:
      entries.storeProfiles ??
      stores.map((store) => ({
        storeId: store.id,
        name: store.name,
        archetype: store.archetype,
        district: store.district,
        displayType: store.displayType,
        llmMode: store.llmMode,
      })),
    pipeline: entries.pipeline ?? {
      defaultRolloutModes: Object.fromEntries(stores.map((store) => [store.id, store.llmMode])),
      exaCacheTtlMinutes: 60,
      managerPin: process.env.MANAGER_PIN ?? "1234",
    },
  };
}

export async function setSettingsBundle(payload = {}) {
  await ensureInitialized();

  await withTransaction(async (client) => {
    if (payload.thresholds) {
      await upsertSetting(client, "thresholds", payload.thresholds);
    }
    if (payload.storeProfiles) {
      await upsertSetting(client, "storeProfiles", payload.storeProfiles);
      for (const profile of payload.storeProfiles) {
        await client.query(
          `
            UPDATE stores
               SET name = $2,
                   district = $3,
                   archetype = $4,
                   display_type = $5,
                   llm_mode = $6
             WHERE id = $1
          `,
          [
            profile.storeId,
            profile.name,
            profile.district,
            profile.archetype,
            profile.displayType,
            profile.llmMode ?? payload.pipeline?.defaultRolloutModes?.[profile.storeId] ?? "shadow",
          ]
        );
      }
    }
    if (payload.pipeline) {
      await upsertSetting(client, "pipeline", payload.pipeline);
      for (const [storeId, llmMode] of Object.entries(payload.pipeline.defaultRolloutModes ?? {})) {
        await client.query(`UPDATE stores SET llm_mode = $2 WHERE id = $1`, [storeId, llmMode]);
      }
    }
  });

  return getSettingsBundle();
}

export async function createPosTransaction({
  storeId,
  cashier = null,
  items = [],
  total = 0,
  actorUserId = null,
}) {
  await ensureInitialized();

  const record = await withTransaction(async (client) => {
    const record = {
      id: crypto.randomUUID(),
      storeId,
      cashier,
      items,
      total: Number(total),
      createdAt: now(),
    };

    await client.query(
      `
        INSERT INTO pos_transactions (id, store_id, cashier, items, total, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [record.id, record.storeId, record.cashier, JSON.stringify(record.items), record.total, record.createdAt]
    );

    const actor =
      cashier ??
      (actorUserId ? (await loadUserById(client, actorUserId))?.name : null) ??
      "SynaptOS POS";

    await insertAuditEvent(client, {
      type: AUDIT_TYPES.EXECUTION,
      storeId,
      actor,
      actorUserId,
      message: "POS checkout completed",
      details: `${items.length} line items recorded with total ${record.total}.`,
      createdAt: record.createdAt,
    });

    const liveCatalog = await loadSettingValue(client, LIVE_MOCK_SETTINGS_KEY, null);
    if (liveCatalog?.stores?.[storeId]) {
      const nextCatalog = applyPosTransactionToLiveCatalog(liveCatalog, record);
      await upsertSetting(client, LIVE_MOCK_SETTINGS_KEY, nextCatalog);
      record.liveProducts = nextCatalog.stores?.[storeId]?.products ?? [];
      record.snapshotKey = nextCatalog.snapshotKey;
      await appendRealtimeOutbox(
        client,
        record.liveProducts
          .map((product) =>
            buildRealtimeOutboxEntry({
              storeId,
              labelUpdate: buildProductLabelUpdate(product, nextCatalog.snapshotKey),
            })
          )
          .filter(Boolean)
      );
    }

    return record;
  });

  return record;
}

export async function listPosTransactions(storeId = null) {
  await ensureInitialized();
  return loadPosTransactions(getPool(), storeId);
}

export async function refreshLiveMockCatalog({ force = false, emitUpdates = true } = {}) {
  await ensureInitialized();
  return ensureLiveMockCatalog(getPool(), { force, emitUpdates });
}

export async function getStorefrontData({ storeId }) {
  await ensureInitialized();
  const client = getPool();
  const { snapshotKey, store, products, liveSample } = await buildStorefrontProducts(client, storeId);
  const transactions = await loadPosTransactions(client, storeId);
  const activeCampaigns = await loadCampaignRows(client, { storeId, status: "active" });

  return {
    store,
    snapshotKey,
    activeCampaigns,
    products: liveSample ? products : overlayPosTransactions(products, transactions),
    wsRoom: `store:${storeId}`,
  };
}
