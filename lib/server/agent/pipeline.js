import {
  publishPipelineAgentDone,
  publishPipelineAgentStart,
  publishPipelineDone,
  publishPipelineFailed,
} from "@/lib/server/events";
import { crawlSignals } from "@/lib/server/agent/exa-client";
import { runAggregationAgent } from "@/lib/server/agent/agents/aggregation-agent";
import { runCampaignAgent } from "@/lib/server/agent/agents/campaign-agent";
import { runIngestionAgent } from "@/lib/server/agent/agents/ingestion-agent";
import { runRecommendationAgent } from "@/lib/server/agent/agents/recommendation-agent";
import { runRiskScoringAgent } from "@/lib/server/agent/agents/risk-scoring-agent";
import {
  EXECUTION_ROUTES,
  SOURCE_FAMILIES,
  SOURCE_TYPES,
} from "@/lib/server/control-tower/constants";
import {
  getCurrentPayload,
  getStorefrontData,
  getPrototypeMeta,
  persistMultiAgentPipelineRun,
} from "@/lib/server/prototype-store";
import { emitPipelineEvent } from "@/lib/server/server-events";

function now() {
  return new Date().toISOString();
}

function computeFreshness(observedAt) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(observedAt).getTime()) / 60000));
  if (minutes <= 60) {
    return { freshnessMinutes: minutes, freshnessStatus: "fresh" };
  }
  if (minutes <= 240) {
    return { freshnessMinutes: minutes, freshnessStatus: "degraded" };
  }
  return { freshnessMinutes: minutes, freshnessStatus: "stale" };
}

function emitStepEvent(storeId, type, payload) {
  const event = { ...payload, at: now() };
  if (type === "start") {
    publishPipelineAgentStart(event);
  } else {
    publishPipelineAgentDone(event);
  }
  emitPipelineEvent(storeId, event);
}

function emitFailedEvent(storeId, payload) {
  const event = { ...payload, at: now() };
  publishPipelineFailed(event);
  emitPipelineEvent(storeId, event);
}

function emitDoneEvent(storeId, payload) {
  const event = { ...payload, at: now() };
  publishPipelineDone(event);
  emitPipelineEvent(storeId, event);
}

function dominantCategory(recommendations) {
  const counts = new Map();
  for (const recommendation of recommendations) {
    counts.set(recommendation.category, (counts.get(recommendation.category) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "produce";
}

function dominantCategoryFromLots(lots = []) {
  const counts = new Map();
  for (const lot of lots) {
    const category = lot.category ?? null;
    if (!category) {
      continue;
    }
    counts.set(category, (counts.get(category) ?? 0) + Number(lot.quantity ?? 0));
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "produce";
}

function inferCandidateType(recommendation) {
  if ((recommendation.lot?.confidenceScore ?? 1) < 0.65 || (recommendation.lot?.hoursToExpiry ?? 999) <= 2) {
    return "unsaleable";
  }

  if (
    (recommendation.lot?.recentVelocity ?? 0) >= 5 &&
    (recommendation.lot?.quantityOnHand ?? 0) <= Math.max(3, recommendation.lot?.recentVelocity ?? 0)
  ) {
    return "stockout_risk";
  }

  return recommendation.recommendedDiscountPct > 0 ? "markdown" : null;
}

function buildLots(storeRecommendations) {
  return storeRecommendations.map((recommendation) => ({
    storeId: recommendation.storeId,
    lot_id: recommendation.lotId,
    sku_name: recommendation.skuName,
    category: recommendation.category,
    quantity: recommendation.lot?.quantityOnHand ?? 0,
    expiry_iso:
      recommendation.lot?.expiryAtMs != null
        ? new Date(recommendation.lot.expiryAtMs).toISOString()
        : null,
    hours_to_expiry: recommendation.lot?.hoursToExpiry ?? null,
    current_price: recommendation.activePrice,
    original_price: recommendation.lot?.basePrice ?? recommendation.activePrice,
    recent_velocity: recommendation.lot?.recentVelocity ?? 0,
    item_traffic: recommendation.lot?.itemTraffic ?? 1,
    temperature_c: recommendation.lot?.temp ?? null,
    confidence_score: recommendation.lot?.confidenceScore ?? null,
    baseline_recommended_discount_pct: recommendation.recommendedDiscountPct ?? 0,
    baseline_recommended_price: recommendation.recommendedPrice ?? recommendation.activePrice,
    candidate_type: inferCandidateType(recommendation),
    unit_cost: recommendation.lot?.unitCost ?? recommendation.lot?.cost ?? 0,
  }));
}

function buildLotsFromProducts(products = []) {
  return products.map((product) => ({
    storeId: product.storeId ?? null,
    lot_id: product.lotId,
    sku_name: product.productName,
    category: product.category,
    quantity: product.quantityOnHand ?? product.quantity ?? 0,
    expiry_iso: product.expiryIso ?? null,
    hours_to_expiry: product.hoursToExpiry ?? null,
    current_price: product.currentPrice ?? product.price ?? 0,
    original_price: product.originalPrice ?? product.currentPrice ?? product.price ?? 0,
    recent_velocity: product.recentVelocity ?? 0,
    item_traffic: product.itemTraffic ?? 1,
    temperature_c: product.temp ?? product.temperatureC ?? null,
    confidence_score: product.confidenceScore ?? null,
    baseline_recommended_discount_pct: product.discountPct ?? 0,
    baseline_recommended_price:
      product.discountPct && Number(product.discountPct) > 0
        ? product.currentPrice ?? product.price ?? 0
        : product.originalPrice ?? product.currentPrice ?? product.price ?? 0,
    candidate_type:
      Number(product.stockoutRisk ?? 0) >= 0.8
        ? "stockout_risk"
        : Number(product.spoilageRisk ?? 0) >= 0.72
          ? "markdown"
          : null,
    unit_cost: product.cost ?? 0,
  }));
}

function buildPosSummary(lots) {
  return {
    sold_units_last_window: Number(
      lots.reduce((sum, lot) => sum + Number(lot.recent_velocity ?? 0), 0).toFixed(2)
    ),
    active_lots: lots.length,
    active_markdowns: lots.filter(
      (lot) => Number(lot.current_price ?? 0) < Number(lot.original_price ?? lot.current_price ?? 0)
    ).length,
  };
}

function buildSignalObservation(storeId, sourceType, signal, structuredSignal) {
  const freshness = computeFreshness(signal.observed_at ?? now());
  return {
    storeId,
    sourceType,
    sourceFamily: SOURCE_FAMILIES.EXTERNAL,
    freshnessStatus: freshness.freshnessStatus,
    freshnessMinutes: freshness.freshnessMinutes,
    provenance: signal.cached ? "cached" : signal.synthetic || signal.error ? "simulated" : "live",
    observedAt: signal.observed_at ?? now(),
    payload: {
      url: signal.url ?? null,
      cached: Boolean(signal.cached),
      cachedAt: signal.cached_at ?? null,
      error: signal.error ?? null,
      extracted: structuredSignal?.status === "insufficient_data" ? null : structuredSignal?.fields ?? null,
    },
  };
}

function riskMapFromOutput(riskScores) {
  return new Map(riskScores.map((entry) => [entry.lot_id, entry]));
}

function decorateLotsWithRisk(lots, riskScores) {
  const scoreMap = riskMapFromOutput(riskScores);
  return lots.map((lot) => {
    const risk = scoreMap.get(lot.lot_id) ?? {};
    return {
      ...lot,
      spoilage_risk: risk.spoilage_risk ?? null,
      sell_through_probability: risk.sell_through_probability ?? null,
      stockout_risk: risk.stockout_risk ?? null,
      citations: risk.citations ?? {},
      confidence: risk.confidence ?? null,
    };
  });
}

function buildAggregatedSnapshotPayload(store, aggregationOutput, signalObservations, lots) {
  const routeCounts = lots.reduce(
    (summary, lot) => {
      if (lot.candidate_type === "unsaleable") {
        summary.unsaleable += 1;
      } else if (lot.candidate_type === "stockout_risk") {
        summary.stockout_risk += 1;
      } else if ((lot.baseline_recommended_discount_pct ?? 0) > 0) {
        summary.markdown += 1;
      }
      return summary;
    },
    { markdown: 0, unsaleable: 0, stockout_risk: 0 }
  );

  return {
    storeId: store.id,
    storeName: store.name,
    district: store.district,
    archetype: store.archetype,
    sourceHealth: aggregationOutput.source_health,
    sourceFreshness: signalObservations.map((observation) => ({
      sourceType: observation.sourceType,
      freshnessStatus: observation.freshnessStatus,
      freshnessMinutes: observation.freshnessMinutes,
      provenance: observation.provenance,
    })),
    weather: aggregationOutput.weather,
    commodity: aggregationOutput.commodity,
    demographic: aggregationOutput.demographic,
    posSummary: aggregationOutput.pos_summary,
    conflicts: aggregationOutput.conflicts ?? [],
    routeCounts,
    candidateLots: {
      lowRiskMarkdowns: lots
        .filter((lot) => lot.candidate_type === "markdown" && (lot.baseline_recommended_discount_pct ?? 0) <= 50)
        .map((lot) => lot.lot_id),
      highRiskMarkdowns: lots
        .filter((lot) => lot.candidate_type === "markdown" && (lot.baseline_recommended_discount_pct ?? 0) > 50)
        .map((lot) => lot.lot_id),
      unsaleable: lots.filter((lot) => lot.candidate_type === "unsaleable").map((lot) => lot.lot_id),
      stockoutRisk: lots.filter((lot) => lot.candidate_type === "stockout_risk").map((lot) => lot.lot_id),
    },
    metrics: {
      activeLots: lots.length,
      atRiskLots: lots.filter((lot) => (lot.spoilage_risk ?? 0) >= 0.6).length,
      blockedForFreshness: signalObservations.filter((observation) => observation.freshnessStatus === "stale").length,
    },
    lots,
  };
}

function buildCampaignInput(store, aggregationOutput, lots) {
  return {
    archetype:
      store.archetype === "premium"
        ? "premium_urban"
        : store.archetype === "transit"
          ? "transit"
          : "residential",
    district_profile: aggregationOutput.demographic ?? {
      district: store.district,
      spending_tier: "middle",
      peak_hours: ["17:00-19:00"],
      profile_type: store.archetype,
    },
    intraday_traffic: {
      peak_hours: aggregationOutput.demographic?.peak_hours ?? ["17:00-19:00"],
      avg_item_traffic: Number(
        (
          lots.reduce((sum, lot) => sum + Number(lot.item_traffic ?? 1), 0) /
          Math.max(1, lots.length)
        ).toFixed(2)
      ),
    },
    inventory_state: {
      lot_count: lots.length,
      markdown_candidates: lots.filter((lot) => lot.candidate_type === "markdown").length,
      rte_lot_count: lots.filter((lot) => String(lot.category ?? "").toLowerCase().includes("rte")).length,
      categories: [...new Map(lots.map((lot) => [lot.category, lot]).filter(([category]) => category)).entries()].map(
        ([category]) => ({
          category,
          quantity: lots
            .filter((lot) => lot.category === category)
            .reduce((sum, lot) => sum + Number(lot.quantity ?? 0), 0),
        })
      ),
    },
  };
}

function buildRationale(action, lot) {
  if (action.type === "logistics_route") {
    return `Route ${lot.sku_name} out of saleable inventory because ${action.data_citation} indicates the lot is no longer viable for markdown.`;
  }

  if (action.type === "procurement_order") {
    return `Place a bounded replenishment order because ${action.data_citation} indicates demand pressure against current on-hand units.`;
  }

  return `Markdown ${lot.sku_name} because ${action.data_citation} indicates elevated spoilage pressure on this lot.`;
}

function normalizeRecommendationOutput(storeId, actions, lots) {
  const lotMap = new Map(lots.map((lot) => [lot.lot_id, lot]));

  return actions
    .map((action) => {
      const lot = lotMap.get(action.lot_id);
      if (!lot) {
        return null;
      }

      const proposalType =
        action.type === "logistics_route"
          ? "unsaleable"
          : action.type === "procurement_order"
            ? "stockout_risk"
            : "markdown";

      const derivedDiscountPct =
        proposalType === "markdown"
          ? lot.baseline_recommended_discount_pct > 0
            ? lot.baseline_recommended_discount_pct
            : (lot.spoilage_risk ?? 0) >= 0.85
              ? 35
              : (lot.spoilage_risk ?? 0) >= 0.7
                ? 20
                : 10
          : 0;

      const basePrice = lot.original_price ?? lot.current_price ?? 0;
      const proposedPrice =
        proposalType === "markdown"
          ? Number((basePrice * (1 - derivedDiscountPct / 100)).toFixed(2))
          : lot.current_price ?? basePrice;

      return {
        storeId,
        skuName: lot.sku_name,
        lotId: lot.lot_id,
        proposalType,
        executionRoute:
          proposalType === "markdown"
            ? EXECUTION_ROUTES.LABEL
            : proposalType === "unsaleable"
              ? EXECUTION_ROUTES.LOGISTICS
              : EXECUTION_ROUTES.PROCUREMENT,
        recommendedDiscountPct: derivedDiscountPct,
        proposedPrice,
        rationale: buildRationale(action, lot),
        metadata: {
          confidence: action.confidence ?? 0.8,
          dataCitation: action.data_citation,
          originalActionType: action.type,
          basePrice,
          category: lot.category ?? null,
          quantity: lot.quantity ?? 0,
          expiryIso: lot.expiry_iso ?? null,
          unit: lot.unit ?? "lot",
          hoursToExpiry: lot.hours_to_expiry,
          riskScore: Math.round(Math.max(lot.spoilage_risk ?? 0, lot.stockout_risk ?? 0) * 100),
          unitCost: lot.unit_cost ?? 0,
          spoilageRisk: lot.spoilage_risk ?? null,
          sellThroughProbability: lot.sell_through_probability ?? null,
          stockoutRisk: lot.stockout_risk ?? null,
        },
      };
    })
    .filter(Boolean);
}

export async function runPipeline({ actorUserId, snapshotKey, storeId, user = null }) {
  const { stores, defaultSnapshot } = await getPrototypeMeta();
  const targetSnapshot = snapshotKey ?? defaultSnapshot;
  const store = stores.find((entry) => entry.id === storeId) ?? stores[0] ?? null;

  if (!store || !targetSnapshot) {
    const error = new Error("Pipeline context could not be resolved");
    error.code = "PIPELINE_CONTEXT_ERROR";
    throw error;
  }

  const payload = await getCurrentPayload(targetSnapshot);
  const storeRecommendations = payload.latestRun.recommendations.filter(
    (recommendation) => recommendation.storeId === store.id
  );
  const storefront = await getStorefrontData({ storeId: store.id });
  const storefrontLots = buildLotsFromProducts(storefront.products ?? []);
  const lots = storefrontLots.length ? storefrontLots : buildLots(storeRecommendations);
  const dominantStoreCategory = dominantCategoryFromLots(lots) || dominantCategory(storeRecommendations);

  emitStepEvent(store.id, "start", { step: "ingestion", status: "start", storeId: store.id, snapshotKey: targetSnapshot });
  const crawledSignals = await crawlSignals({
    storeId: store.id,
    district: store.district,
    category: dominantStoreCategory,
  });

  const weatherIngestion = await runIngestionAgent({
    signalType: "weather",
    district: store.district,
    signal: crawledSignals.weather,
  });
  const commodityIngestion = await runIngestionAgent({
    signalType: "commodity",
    category: dominantStoreCategory,
    signal: crawledSignals.commodity,
  });
  const demographicIngestion = await runIngestionAgent({
    signalType: "demographic",
    district: store.district,
    signal: crawledSignals.demographic,
  });
  const ingestionRuns = [weatherIngestion, commodityIngestion, demographicIngestion];

  emitStepEvent(store.id, "done", {
    step: "ingestion",
    status: ingestionRuns.some((run) => run.status === "failed") ? "failed" : "done",
    storeId: store.id,
    snapshotKey: targetSnapshot,
  });

  const signalObservations = [
    buildSignalObservation(store.id, SOURCE_TYPES.WEATHER, crawledSignals.weather, weatherIngestion.output),
    buildSignalObservation(store.id, SOURCE_TYPES.COMMODITY, crawledSignals.commodity, commodityIngestion.output),
    buildSignalObservation(store.id, SOURCE_TYPES.DEMOGRAPHICS, crawledSignals.demographic, demographicIngestion.output),
  ];

  emitStepEvent(store.id, "start", { step: "aggregation", status: "start", storeId: store.id, snapshotKey: targetSnapshot });
  const aggregationRun = await runAggregationAgent({
    store: {
      id: store.id,
      name: store.name,
      district: store.district,
      archetype: store.archetype,
    },
    structured_signals: {
      weather: weatherIngestion.output,
      commodity: commodityIngestion.output,
      demographic: demographicIngestion.output,
    },
    signal_freshness: signalObservations.map((observation) => ({
      source_type: observation.sourceType,
      freshness_status: observation.freshnessStatus,
      freshness_minutes: observation.freshnessMinutes,
      provenance: observation.provenance,
      observed_at: observation.observedAt,
    })),
    pos_summary: buildPosSummary(lots),
    lots,
    stale_threshold_minutes: 240,
  });

  if (!aggregationRun.output) {
    emitFailedEvent(store.id, {
      step: "aggregation",
      status: "failed",
      storeId: store.id,
      snapshotKey: targetSnapshot,
      reason: aggregationRun.failureReason ?? "aggregation agent did not return a usable snapshot",
    });
    const error = new Error("Aggregation agent did not return a usable snapshot");
    error.code = "PIPELINE_AGGREGATION_FAILED";
    throw error;
  }

  emitStepEvent(store.id, "done", {
    step: "aggregation",
    status: aggregationRun.status === "failed" ? "failed" : "done",
    storeId: store.id,
    snapshotKey: targetSnapshot,
  });

  emitStepEvent(store.id, "start", { step: "risk_scoring", status: "start", storeId: store.id, snapshotKey: targetSnapshot });
  const riskRun = await runRiskScoringAgent({
    store_id: store.id,
    lots: aggregationRun.output.lots,
    weather: aggregationRun.output.weather,
    demographic: aggregationRun.output.demographic,
  });
  const riskEnrichedLots = decorateLotsWithRisk(aggregationRun.output.lots, riskRun.output ?? []);
  emitStepEvent(store.id, "done", {
    step: "risk_scoring",
    status: riskRun.status === "failed" ? "failed" : "done",
    storeId: store.id,
    snapshotKey: targetSnapshot,
  });

  emitStepEvent(store.id, "start", { step: "recommendation", status: "start", storeId: store.id, snapshotKey: targetSnapshot });
  const recommendationRun = await runRecommendationAgent({
    store_id: store.id,
    source_health: aggregationRun.output.source_health,
    lots: riskEnrichedLots,
  });
  const normalizedProposals = normalizeRecommendationOutput(store.id, recommendationRun.output ?? [], riskEnrichedLots);
  emitStepEvent(store.id, "done", {
    step: "recommendation",
    status: recommendationRun.status === "failed" ? "failed" : "done",
    storeId: store.id,
    snapshotKey: targetSnapshot,
    proposalCount: normalizedProposals.length,
  });

  emitStepEvent(store.id, "start", { step: "campaign", status: "start", storeId: store.id, snapshotKey: targetSnapshot });
  const campaignRun = await runCampaignAgent(buildCampaignInput(store, aggregationRun.output, riskEnrichedLots));
  emitStepEvent(store.id, "done", {
    step: "campaign",
    status: campaignRun.status === "failed" ? "failed" : "done",
    storeId: store.id,
    snapshotKey: targetSnapshot,
  });

  emitStepEvent(store.id, "start", { step: "guardrails", status: "start", storeId: store.id, snapshotKey: targetSnapshot });
  const aggregatedSnapshot = buildAggregatedSnapshotPayload(
    store,
    aggregationRun.output,
    signalObservations,
    riskEnrichedLots
  );

  const persisted = await persistMultiAgentPipelineRun({
    actorUserId,
    aggregatedSnapshot,
    proposals: normalizedProposals,
    signalObservations,
    snapshotKey: targetSnapshot,
    stageRuns: [...ingestionRuns, aggregationRun, riskRun, recommendationRun, campaignRun],
    storeId: store.id,
    user,
  });

  const routeSummary = {
    dispatched: persisted.executionTasks.length,
    approvals: persisted.approvalRequests.length,
    blocked: persisted.guardrailEvaluations.filter((evaluation) => evaluation.outcome === "blocked").length,
  };

  emitStepEvent(store.id, "done", {
    step: "guardrails",
    status: "done",
    storeId: store.id,
    snapshotKey: targetSnapshot,
    routeSummary,
  });

  emitDoneEvent(store.id, {
    step: "done",
    status: "done",
    storeId: store.id,
    snapshotKey: targetSnapshot,
    proposalCount: persisted.proposals.length,
    routeSummary,
  });

  return {
    ...persisted,
    campaignSuggestion: campaignRun.output ?? null,
  };
}
