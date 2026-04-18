import { createRequire } from "node:module";
import { TASK_STATUSES } from "@/lib/server/control-tower/constants";

const require = createRequire(import.meta.url);
const { emitPriceUpdate } = require("../server-events.js");

function inferDiscountPct(currentPrice, originalPrice, fallback = null) {
  const current = Number(currentPrice ?? 0);
  const original = Number(originalPrice ?? 0);

  if (Number.isFinite(fallback) && fallback > 0) {
    return Math.round(fallback);
  }

  if (!original || current >= original) {
    return null;
  }

  return Math.round(((original - current) / original) * 100);
}

export function buildPriceUpdatePayload({ storeId, labelUpdate }) {
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
    discount_pct: inferDiscountPct(currentPrice, originalPrice, labelUpdate.discountPct),
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

export function emitLabelPriceUpdate({ storeId, labelUpdate }) {
  const payload = buildPriceUpdatePayload({ storeId, labelUpdate });
  if (!payload) {
    return null;
  }

  emitPriceUpdate(storeId, payload);
  return payload;
}

export function buildLabelExecution({ proposal }) {
  const originalPrice = proposal.metadata.basePrice ?? proposal.proposedPrice;

  return {
    taskType: "label_publish",
    storeId: proposal.storeId,
    proposalId: proposal.id,
    route: "label",
    status: TASK_STATUSES.DISPATCHED,
    labelUpdate: {
      lotId: proposal.lotId,
      skuId: proposal.lotId,
      productName: proposal.skuName,
      currentPrice: proposal.proposedPrice,
      previousPrice: originalPrice,
      originalPrice,
      discountPct: proposal.recommendedDiscountPct ?? null,
      expiryIso: proposal.metadata.expiryIso ?? null,
      unit: proposal.metadata.unit ?? "lot",
    },
  };
}
