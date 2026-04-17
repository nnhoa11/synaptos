import {
  clamp,
  runGeminiStage,
  schemaError,
  toNullableNumber,
  toNullableString,
} from "@/lib/server/agent/agents/utils";

const SYSTEM_PROMPT = `You receive structured source records from multiple feeds.
Merge them into the aggregated snapshot schema.
Mark any source as stale if its timestamp is older than the threshold in the input.
Flag fields where two sources conflict; do not resolve conflicts automatically.
Do not add fields that are not in the output schema.
Output valid JSON only. No prose.`;

const SCHEMA = {
  type: "object",
  properties: {
    store_id: { type: "string" },
    store_name: { type: "string" },
    district: { type: "string" },
    archetype: { type: "string" },
    source_health: { type: "string" },
    weather: { type: ["object", "null"] },
    commodity: { type: ["object", "null"] },
    demographic: { type: ["object", "null"] },
    pos_summary: { type: "object" },
    signal_freshness: { type: "array" },
    conflicts: { type: "array" },
    lots: { type: "array" },
  },
};

function summarizeSourceHealth(signalFreshness) {
  if (signalFreshness.some((entry) => entry.freshness_status === "stale")) {
    return "attention";
  }
  if (signalFreshness.some((entry) => entry.freshness_status === "degraded")) {
    return "watch";
  }
  return "healthy";
}

function normalizeSignal(signal) {
  if (!signal || signal.status === "insufficient_data") {
    return null;
  }

  return signal.fields;
}

function validateLot(lot) {
  if (!lot || typeof lot !== "object" || Array.isArray(lot)) {
    throw schemaError("aggregated lots must be objects");
  }

  return {
    lot_id: toNullableString(lot.lot_id),
    sku_name: toNullableString(lot.sku_name),
    category: toNullableString(lot.category),
    quantity: toNullableNumber(lot.quantity),
    expiry_iso: toNullableString(lot.expiry_iso),
    hours_to_expiry: toNullableNumber(lot.hours_to_expiry),
    current_price: toNullableNumber(lot.current_price),
    original_price: toNullableNumber(lot.original_price),
    recent_velocity: toNullableNumber(lot.recent_velocity),
    item_traffic: toNullableNumber(lot.item_traffic),
    temperature_c: toNullableNumber(lot.temperature_c),
    confidence_score: toNullableNumber(lot.confidence_score),
    baseline_recommended_discount_pct: toNullableNumber(lot.baseline_recommended_discount_pct),
    baseline_recommended_price: toNullableNumber(lot.baseline_recommended_price),
    candidate_type: toNullableString(lot.candidate_type),
  };
}

function validatePayload(payload, input) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw schemaError("aggregation output must be an object");
  }

  return {
    store_id: toNullableString(payload.store_id) ?? input.store.id,
    store_name: toNullableString(payload.store_name) ?? input.store.name,
    district: toNullableString(payload.district) ?? input.store.district,
    archetype: toNullableString(payload.archetype) ?? input.store.archetype,
    generated_at: new Date().toISOString(),
    source_health: toNullableString(payload.source_health) ?? summarizeSourceHealth(input.signal_freshness),
    weather: payload.weather && typeof payload.weather === "object" ? payload.weather : null,
    commodity: payload.commodity && typeof payload.commodity === "object" ? payload.commodity : null,
    demographic: payload.demographic && typeof payload.demographic === "object" ? payload.demographic : null,
    pos_summary: payload.pos_summary && typeof payload.pos_summary === "object" ? payload.pos_summary : input.pos_summary,
    signal_freshness: Array.isArray(payload.signal_freshness) ? payload.signal_freshness : input.signal_freshness,
    conflicts: Array.isArray(payload.conflicts) ? payload.conflicts : [],
    lots: Array.isArray(payload.lots) ? payload.lots.map(validateLot) : input.lots.map(validateLot),
    confidence: clamp(toNullableNumber(payload.confidence) ?? 0.82, 0, 1),
  };
}

function buildFallback(input) {
  return {
    store_id: input.store.id,
    store_name: input.store.name,
    district: input.store.district,
    archetype: input.store.archetype,
    generated_at: new Date().toISOString(),
    source_health: summarizeSourceHealth(input.signal_freshness),
    weather: normalizeSignal(input.structured_signals.weather),
    commodity: normalizeSignal(input.structured_signals.commodity),
    demographic: normalizeSignal(input.structured_signals.demographic),
    pos_summary: input.pos_summary,
    signal_freshness: input.signal_freshness,
    conflicts: [],
    lots: input.lots,
    confidence: 0.78,
  };
}

export async function runAggregationAgent(input) {
  return runGeminiStage({
    stageName: "aggregation",
    tier: "low",
    systemPrompt: SYSTEM_PROMPT,
    input,
    schema: SCHEMA,
    validate: validatePayload,
    fallback: buildFallback,
  });
}
