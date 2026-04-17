const crypto = require("node:crypto");
const { Pool } = require("pg");
const { emitPriceUpdate } = require("./server-events.js");

const globalScope = globalThis;
const DEFAULT_POSTGRES_CONFIG = {
  host: "localhost",
  port: "5432",
  database: "synaptos_v2",
  user: "synaptos",
  password: "synaptos",
};

function nowIso() {
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
  if (!globalScope.__synaptosCampaignSchedulerPool) {
    globalScope.__synaptosCampaignSchedulerPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 4,
    });
  }

  return globalScope.__synaptosCampaignSchedulerPool;
}

async function withTransaction(work) {
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

function normalizeProduct(row) {
  const basePrice = Number(row.base_price ?? 0);
  const labelCurrent = row.label_current_price == null ? null : Number(row.label_current_price);
  const labelPrevious = row.label_previous_price == null ? null : Number(row.label_previous_price);

  return {
    lotId: row.lot_id,
    skuId: row.lot_id,
    productName: row.sku_name,
    category: row.category,
    quantity: Number(row.quantity_on_hand ?? 0),
    expiryIso: row.expiry_at_ms ? new Date(Number(row.expiry_at_ms)).toISOString() : null,
    unit: "lot",
    basePrice,
    currentPrice: labelCurrent ?? basePrice,
    originalPrice: labelPrevious ?? basePrice,
  };
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

function buildPriceUpdatePayload(update) {
  const currentPrice = Number(update.currentPrice ?? 0);
  const originalPrice = Number(update.originalPrice ?? update.previousPrice ?? currentPrice);

  return {
    type: "price-update",
    sku_id: update.skuId ?? update.lotId,
    product_name: update.productName ?? update.lotId,
    current_price: currentPrice,
    original_price: originalPrice || currentPrice,
    discount_pct:
      Number.isFinite(Number(update.discountPct)) && Number(update.discountPct) > 0
        ? Math.round(Number(update.discountPct))
        : originalPrice > currentPrice && originalPrice > 0
          ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
          : null,
    expiry_iso: update.expiryIso ?? null,
    unit: update.unit ?? "lot",
  };
}

async function loadCampaignRows(client, status) {
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
      WHERE status = $1
      ORDER BY starts_at ASC, created_at ASC
    `,
    [status]
  );

  return result.rows.map(mapCampaignRow);
}

async function loadOperationalSnapshotKey(client, storeId) {
  const snapshots = await client.query(
    `
      SELECT snapshot_key
      FROM snapshots
      ORDER BY snapshot_key DESC
    `
  );

  for (const row of snapshots.rows) {
    const countResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM inventory_rows
        WHERE timestamp_key = $1
          AND store_id = $2
          AND GREATEST(imported - sold - waste, 0) > 0
      `,
      [row.snapshot_key, storeId]
    );

    if (Number(countResult.rows[0]?.count ?? 0) > 0) {
      return row.snapshot_key;
    }
  }

  return snapshots.rows[0]?.snapshot_key ?? null;
}

async function loadStoreProducts(client, storeId) {
  const snapshotKey = await loadOperationalSnapshotKey(client, storeId);
  if (!snapshotKey) {
    return [];
  }

  const result = await client.query(
    `
      SELECT
        inventory_rows.lot_id,
        inventory_rows.sku_name,
        inventory_rows.category,
        inventory_rows.expiry_at_ms,
        inventory_rows.price AS base_price,
        GREATEST(inventory_rows.imported - inventory_rows.sold - inventory_rows.waste, 0) AS quantity_on_hand,
        shelf_labels.current_price AS label_current_price,
        shelf_labels.previous_price AS label_previous_price
      FROM inventory_rows
      LEFT JOIN shelf_labels ON shelf_labels.lot_id = inventory_rows.lot_id
      WHERE inventory_rows.timestamp_key = $1
        AND inventory_rows.store_id = $2
        AND GREATEST(inventory_rows.imported - inventory_rows.sold - inventory_rows.waste, 0) > 0
      ORDER BY inventory_rows.expiry_at_ms ASC, inventory_rows.lot_id ASC
    `,
    [snapshotKey, storeId]
  );

  return result.rows.map(normalizeProduct);
}

async function upsertLabel(client, { lotId, currentPrice, previousPrice, status, recommendationId }) {
  await client.query(
    `
      INSERT INTO shelf_labels (lot_id, current_price, previous_price, status, recommendation_id, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (lot_id) DO UPDATE
      SET current_price = EXCLUDED.current_price,
          previous_price = EXCLUDED.previous_price,
          status = EXCLUDED.status,
          recommendation_id = EXCLUDED.recommendation_id,
          updated_at = EXCLUDED.updated_at
    `,
    [lotId, currentPrice, previousPrice, status, recommendationId, nowIso()]
  );
}

async function updateCampaignStatus(client, campaignId, status) {
  await client.query(`UPDATE campaigns SET status = $2 WHERE id = $1`, [campaignId, status]);
}

async function applyCampaignPrices(client, campaign) {
  const products = (await loadStoreProducts(client, campaign.storeId)).filter((product) =>
    campaignTargetsProduct(campaign, product)
  );

  const updates = [];
  for (const product of products) {
    const baseCurrentPrice = Number(product.currentPrice ?? product.basePrice ?? 0);
    const nextPrice = Number(
      Math.max(0, Math.round(baseCurrentPrice * (1 - Number(campaign.discountPct ?? 0) / 100)))
    );

    await upsertLabel(client, {
      lotId: product.lotId,
      currentPrice: nextPrice,
      previousPrice: baseCurrentPrice,
      status: "campaign_active",
      recommendationId: `campaign:${campaign.id}`,
    });

    updates.push({
      storeId: campaign.storeId,
      skuId: product.skuId,
      lotId: product.lotId,
      productName: product.productName,
      currentPrice: nextPrice,
      previousPrice: baseCurrentPrice,
      originalPrice: baseCurrentPrice,
      discountPct: Number(campaign.discountPct ?? 0),
      expiryIso: product.expiryIso,
      unit: product.unit,
    });
  }

  return updates;
}

async function revertCampaignPrices(client, campaign) {
  const products = (await loadStoreProducts(client, campaign.storeId)).filter((product) =>
    campaignTargetsProduct(campaign, product)
  );

  const updates = [];
  for (const product of products) {
    const revertedPrice = Number(product.originalPrice ?? product.basePrice ?? product.currentPrice ?? 0);
    const basePrice = Number(product.basePrice ?? revertedPrice);

    await upsertLabel(client, {
      lotId: product.lotId,
      currentPrice: revertedPrice,
      previousPrice: revertedPrice,
      status: revertedPrice < basePrice ? "published" : "hold",
      recommendationId: `campaign:${campaign.id}:${crypto.randomUUID()}`,
    });

    updates.push({
      storeId: campaign.storeId,
      skuId: product.skuId,
      lotId: product.lotId,
      productName: product.productName,
      currentPrice: revertedPrice,
      previousPrice: revertedPrice,
      originalPrice: revertedPrice,
      discountPct: null,
      expiryIso: product.expiryIso,
      unit: product.unit,
    });
  }

  return updates;
}

function emitCampaignPriceUpdates(updates) {
  for (const update of updates) {
    emitPriceUpdate(update.storeId, buildPriceUpdatePayload(update));
  }
}

async function runCampaignTick() {
  const updates = [];

  await withTransaction(async (client) => {
    const toExpire = await loadCampaignRows(client, "active");
    for (const campaign of toExpire.filter((entry) => new Date(entry.endsAt).getTime() <= Date.now())) {
      const expiredUpdates = await revertCampaignPrices(client, campaign);
      await updateCampaignStatus(client, campaign.id, "expired");
      updates.push(...expiredUpdates);
    }

    const toActivate = await loadCampaignRows(client, "scheduled");
    for (const campaign of toActivate.filter((entry) => new Date(entry.startsAt).getTime() <= Date.now())) {
      const activatedUpdates = await applyCampaignPrices(client, campaign);
      await updateCampaignStatus(client, campaign.id, "active");
      updates.push(...activatedUpdates);
    }
  });

  emitCampaignPriceUpdates(updates);
}

function startCampaignScheduler() {
  if (globalScope.__synaptosCampaignSchedulerStarted) {
    return globalScope.__synaptosCampaignSchedulerTimer;
  }

  globalScope.__synaptosCampaignSchedulerStarted = true;
  runCampaignTick().catch((error) => {
    if (error?.code === "42P01") {
      return;
    }
    console.error("[campaign-scheduler]", error);
  });
  const timer = setInterval(() => {
    runCampaignTick().catch((error) => {
      if (error?.code === "42P01") {
        return;
      }
      console.error("[campaign-scheduler]", error);
    });
  }, 60_000);

  globalScope.__synaptosCampaignSchedulerTimer = timer;
  return timer;
}

exports.startCampaignScheduler = startCampaignScheduler;
