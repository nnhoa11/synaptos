/**
 * Seeded replay scenarios for model-run regression testing.
 *
 * Each scenario provides a self-contained store snapshot, recommendation set,
 * candidate lot classification, and store policy — enough to exercise the
 * full pipeline from prompt building through guardrail evaluation.
 */

// ─── Shared Seed Data ────────────────────────────────────────────────────────

const SEED_STORE = {
  id: "store_fixture_01",
  name: "Fixture Store Alpha",
  district: "District 7",
  archetype: "premium",
  location: "Ho Chi Minh City, Vietnam",
};

const SEED_STORE_POLICY = {
  id: "store_fixture_01",
  approvalThresholdPct: 50,
  markdownMaxAutoDiscountPct: 50,
  procurementSpendCap: 250,
  preferredSupplierId: "Fixture Supplier Co.",
  llmMode: "shadow",
};

const SEED_SNAPSHOT_KEY = "2026-04-17T06:00:00.000Z";

function makeRecommendation(overrides) {
  return {
    id: `rec_fixture_${overrides.suffix ?? "01"}`,
    storeId: SEED_STORE.id,
    skuName: overrides.skuName ?? "Fixture SKU",
    category: overrides.category ?? "produce",
    lotId: `lot_fixture_${overrides.suffix ?? "01"}`,
    riskScore: overrides.riskScore ?? 55,
    recommendedDiscountPct: overrides.recommendedDiscountPct ?? 20,
    recommendedPrice: overrides.recommendedPrice ?? 42000,
    activePrice: overrides.activePrice ?? 55000,
    approvalThresholdPct: overrides.approvalThresholdPct ?? 50,
    reasonSummary: overrides.reasonSummary ?? "Fixture-generated recommendation",
    status: "active",
    lot: {
      hoursToExpiry: overrides.hoursToExpiry ?? 18,
      confidenceScore: overrides.confidenceScore ?? 0.88,
      cost: overrides.unitCost ?? 25000,
      unitCost: overrides.unitCost ?? 25000,
      quantityOnHand: overrides.quantityOnHand ?? 40,
      recentVelocity: overrides.recentVelocity ?? 5.2,
      temp: overrides.temp ?? 31,
      itemTraffic: overrides.itemTraffic ?? 1.1,
    },
    ...overrides,
  };
}

// ─── Source Freshness Seed ────────────────────────────────────────────────────

const SEED_SOURCE_FRESHNESS_HEALTHY = [
  { sourceType: "weather_api", sourceFamily: "external", freshnessStatus: "fresh", freshnessMinutes: 15, provenance: "simulated" },
  { sourceType: "demographic_data", sourceFamily: "external", freshnessStatus: "fresh", freshnessMinutes: 120, provenance: "simulated" },
  { sourceType: "commodity_prices", sourceFamily: "external", freshnessStatus: "fresh", freshnessMinutes: 45, provenance: "simulated" },
  { sourceType: "pos_transactions", sourceFamily: "internal", freshnessStatus: "fresh", freshnessMinutes: 10, provenance: "simulated" },
  { sourceType: "inventory_ledger", sourceFamily: "internal", freshnessStatus: "fresh", freshnessMinutes: 8, provenance: "simulated" },
];

const SEED_SOURCE_FRESHNESS_STALE = [
  { sourceType: "weather_api", sourceFamily: "external", freshnessStatus: "stale", freshnessMinutes: 999, provenance: "simulated" },
  { sourceType: "demographic_data", sourceFamily: "external", freshnessStatus: "stale", freshnessMinutes: 999, provenance: "simulated" },
  { sourceType: "commodity_prices", sourceFamily: "external", freshnessStatus: "stale", freshnessMinutes: 999, provenance: "simulated" },
  { sourceType: "pos_transactions", sourceFamily: "internal", freshnessStatus: "fresh", freshnessMinutes: 10, provenance: "simulated" },
  { sourceType: "inventory_ledger", sourceFamily: "internal", freshnessStatus: "fresh", freshnessMinutes: 8, provenance: "simulated" },
];

// ─── Scenario Definitions ────────────────────────────────────────────────────

/**
 * US2: Low-risk markdown — discount <= 50%, should auto-route to label.
 */
export const SCENARIO_LOW_RISK_MARKDOWN = {
  id: "low_risk_markdown",
  story: "US2",
  description: "Low-risk markdown at 20% discount auto-routes to label execution",
  expectedGuardrailOutcome: "approved",
  expectedExecutionRoute: "label",
  store: SEED_STORE,
  storePolicy: SEED_STORE_POLICY,
  snapshotKey: SEED_SNAPSHOT_KEY,
  recommendations: [
    makeRecommendation({
      suffix: "lowrisk_01",
      skuName: "Organic Chicken Breast 500g",
      category: "poultry",
      riskScore: 62,
      recommendedDiscountPct: 20,
      recommendedPrice: 44000,
      activePrice: 55000,
      hoursToExpiry: 14,
      confidenceScore: 0.91,
    }),
  ],
  candidateLots: {
    unsaleable: [],
    stockoutRisk: [],
  },
  sourceHealth: "healthy",
  sourceFreshness: SEED_SOURCE_FRESHNESS_HEALTHY,
};

/**
 * US3: High-risk markdown — discount > 50%, must route to approval queue.
 */
export const SCENARIO_HIGH_RISK_MARKDOWN = {
  id: "high_risk_markdown",
  story: "US3",
  description: "High-risk markdown at 65% discount requires human approval",
  expectedGuardrailOutcome: "requires_approval",
  expectedExecutionRoute: "approval",
  store: SEED_STORE,
  storePolicy: SEED_STORE_POLICY,
  snapshotKey: SEED_SNAPSHOT_KEY,
  recommendations: [
    makeRecommendation({
      suffix: "highrisk_01",
      skuName: "Premium Wagyu Steak 300g",
      category: "beef",
      riskScore: 85,
      recommendedDiscountPct: 65,
      recommendedPrice: 122500,
      activePrice: 350000,
      hoursToExpiry: 6,
      confidenceScore: 0.72,
      approvalThresholdPct: 50,
    }),
  ],
  candidateLots: {
    unsaleable: [],
    stockoutRisk: [],
  },
  sourceHealth: "healthy",
  sourceFreshness: SEED_SOURCE_FRESHNESS_HEALTHY,
};

/**
 * US4: Unsaleable inventory — lot is past sellable window, routes to logistics.
 */
export const SCENARIO_UNSALEABLE = {
  id: "unsaleable_routing",
  story: "US4",
  description: "Expired lot routes to logistics workbench for cross-dock or EOL",
  expectedGuardrailOutcome: "approved",
  expectedExecutionRoute: "logistics",
  store: SEED_STORE,
  storePolicy: SEED_STORE_POLICY,
  snapshotKey: SEED_SNAPSHOT_KEY,
  recommendations: [
    makeRecommendation({
      suffix: "unsaleable_01",
      skuName: "Fresh Milk 1L",
      category: "dairy",
      riskScore: 95,
      recommendedDiscountPct: 0,
      recommendedPrice: 32000,
      activePrice: 32000,
      hoursToExpiry: 0.5,
      confidenceScore: 0.98,
      quantityOnHand: 12,
      recentVelocity: 0.3,
    }),
  ],
  candidateLots: {
    unsaleable: ["rec_fixture_unsaleable_01"],
    stockoutRisk: [],
  },
  sourceHealth: "healthy",
  sourceFreshness: SEED_SOURCE_FRESHNESS_HEALTHY,
};

/**
 * US5: Stockout risk — demand outpaces on-hand, routes to procurement.
 */
export const SCENARIO_STOCKOUT_RISK = {
  id: "stockout_risk_procurement",
  story: "US5",
  description: "High-demand item routes to procurement console for bounded replenishment",
  expectedGuardrailOutcome: "approved",
  expectedExecutionRoute: "procurement",
  store: SEED_STORE,
  storePolicy: SEED_STORE_POLICY,
  snapshotKey: SEED_SNAPSHOT_KEY,
  recommendations: [
    makeRecommendation({
      suffix: "stockout_01",
      skuName: "Jasmine Rice 5kg",
      category: "staples",
      riskScore: 70,
      recommendedDiscountPct: 0,
      recommendedPrice: 89000,
      activePrice: 89000,
      hoursToExpiry: 720,
      confidenceScore: 0.95,
      quantityOnHand: 3,
      recentVelocity: 18.5,
    }),
  ],
  candidateLots: {
    unsaleable: [],
    stockoutRisk: ["rec_fixture_stockout_01"],
  },
  sourceHealth: "healthy",
  sourceFreshness: SEED_SOURCE_FRESHNESS_HEALTHY,
};

/**
 * Edge case: Stale sources — guardrails should block all proposals.
 */
export const SCENARIO_STALE_SOURCES = {
  id: "stale_sources_blocked",
  story: "Edge",
  description: "Stale external sources cause guardrails to block all proposals",
  expectedGuardrailOutcome: "blocked",
  expectedExecutionRoute: "label",
  store: SEED_STORE,
  storePolicy: SEED_STORE_POLICY,
  snapshotKey: SEED_SNAPSHOT_KEY,
  recommendations: [
    makeRecommendation({
      suffix: "stale_01",
      skuName: "Dragon Fruit 500g",
      category: "fruit",
      riskScore: 58,
      recommendedDiscountPct: 15,
      recommendedPrice: 34000,
      activePrice: 40000,
      hoursToExpiry: 20,
      confidenceScore: 0.85,
    }),
  ],
  candidateLots: {
    unsaleable: [],
    stockoutRisk: [],
  },
  sourceHealth: "attention",
  sourceFreshness: SEED_SOURCE_FRESHNESS_STALE,
};

/**
 * Mixed scenario: Multiple proposal types in a single store snapshot.
 */
export const SCENARIO_MIXED = {
  id: "mixed_proposals",
  story: "All",
  description: "Single snapshot produces markdown, unsaleable, and stockout-risk proposals",
  expectedGuardrailOutcome: "mixed",
  expectedExecutionRoute: "mixed",
  store: SEED_STORE,
  storePolicy: SEED_STORE_POLICY,
  snapshotKey: SEED_SNAPSHOT_KEY,
  recommendations: [
    makeRecommendation({
      suffix: "mixed_md",
      skuName: "Imported Cheese 200g",
      category: "dairy",
      riskScore: 60,
      recommendedDiscountPct: 30,
      recommendedPrice: 56000,
      activePrice: 80000,
      hoursToExpiry: 12,
      confidenceScore: 0.87,
    }),
    makeRecommendation({
      suffix: "mixed_unsale",
      skuName: "yogurt Cup 150g",
      category: "dairy",
      riskScore: 92,
      recommendedDiscountPct: 0,
      recommendedPrice: 15000,
      activePrice: 15000,
      hoursToExpiry: 0.2,
      confidenceScore: 0.99,
      quantityOnHand: 8,
      recentVelocity: 0.1,
    }),
    makeRecommendation({
      suffix: "mixed_stock",
      skuName: "Free-Range Eggs 10pk",
      category: "eggs",
      riskScore: 65,
      recommendedDiscountPct: 0,
      recommendedPrice: 45000,
      activePrice: 45000,
      hoursToExpiry: 240,
      confidenceScore: 0.93,
      quantityOnHand: 2,
      recentVelocity: 14.8,
    }),
  ],
  candidateLots: {
    unsaleable: ["rec_fixture_mixed_unsale"],
    stockoutRisk: ["rec_fixture_mixed_stock"],
  },
  sourceHealth: "healthy",
  sourceFreshness: SEED_SOURCE_FRESHNESS_HEALTHY,
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const ALL_SCENARIOS = [
  SCENARIO_LOW_RISK_MARKDOWN,
  SCENARIO_HIGH_RISK_MARKDOWN,
  SCENARIO_UNSALEABLE,
  SCENARIO_STOCKOUT_RISK,
  SCENARIO_STALE_SOURCES,
  SCENARIO_MIXED,
];

export function getScenarioById(id) {
  return ALL_SCENARIOS.find((s) => s.id === id) ?? null;
}

/**
 * Converts a scenario into a store snapshot shape compatible with
 * `buildPromptEnvelope` and the orchestrator pipeline.
 */
export function toStoreSnapshot(scenario) {
  return {
    storeId: scenario.store.id,
    storeName: scenario.store.name,
    district: scenario.store.district,
    sourceHealth: scenario.sourceHealth,
    sourceFreshness: scenario.sourceFreshness,
    routeCounts: {
      markdown: scenario.recommendations.filter(
        (r) =>
          !scenario.candidateLots.unsaleable.includes(r.id) &&
          !scenario.candidateLots.stockoutRisk.includes(r.id)
      ).length,
      unsaleable: scenario.candidateLots.unsaleable.length,
      stockout_risk: scenario.candidateLots.stockoutRisk.length,
    },
    recommendations: scenario.recommendations,
    candidateLots: scenario.candidateLots,
  };
}
