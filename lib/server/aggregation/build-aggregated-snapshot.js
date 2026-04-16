import {
  AUTO_MARKDOWN_THRESHOLD_PCT,
  PROPOSAL_TYPES,
} from "@/lib/server/control-tower/constants";

function summarizeFreshness(observations) {
  const degraded = observations.filter((observation) => observation.freshnessStatus !== "fresh");
  if (!degraded.length) {
    return "healthy";
  }
  return degraded.some((observation) => observation.freshnessStatus === "stale")
    ? "attention"
    : "watch";
}

function inferUnsaleable(recommendation) {
  return (
    (recommendation.lot?.confidenceScore ?? 1) < 0.65 ||
    recommendation.lot?.hoursToExpiry <= 2 ||
    recommendation.lot?.quantityOnHand <= 0
  );
}

function inferStockoutRisk(recommendation) {
  return (
    recommendation.lot?.recentVelocity >= 5 &&
    recommendation.lot?.quantityOnHand <= Math.max(3, recommendation.lot?.recentVelocity ?? 0)
  );
}

function buildSnapshot(store, observations, recommendations) {
  const lowRiskMarkdowns = [];
  const highRiskMarkdowns = [];
  const unsaleableLots = [];
  const stockoutRiskLots = [];

  recommendations.forEach((recommendation) => {
    if (inferUnsaleable(recommendation)) {
      unsaleableLots.push(recommendation);
      return;
    }

    if (inferStockoutRisk(recommendation)) {
      stockoutRiskLots.push(recommendation);
      return;
    }

    if (recommendation.recommendedDiscountPct > 0) {
      if (recommendation.recommendedDiscountPct <= AUTO_MARKDOWN_THRESHOLD_PCT) {
        lowRiskMarkdowns.push(recommendation);
      } else {
        highRiskMarkdowns.push(recommendation);
      }
    }
  });

  return {
    storeId: store.id,
    storeName: store.name,
    district: store.district,
    sourceHealth: summarizeFreshness(observations),
    observationCount: observations.length,
    recommendations,
    routeCounts: {
      [PROPOSAL_TYPES.MARKDOWN]: lowRiskMarkdowns.length + highRiskMarkdowns.length,
      [PROPOSAL_TYPES.UNSALEABLE]: unsaleableLots.length,
      [PROPOSAL_TYPES.STOCKOUT_RISK]: stockoutRiskLots.length,
    },
    sourceFreshness: observations.map((observation) => ({
      sourceType: observation.sourceType,
      freshnessStatus: observation.freshnessStatus,
      freshnessMinutes: observation.freshnessMinutes,
      provenance: observation.provenance,
    })),
    candidateLots: {
      lowRiskMarkdowns: lowRiskMarkdowns.map((recommendation) => recommendation.id),
      highRiskMarkdowns: highRiskMarkdowns.map((recommendation) => recommendation.id),
      unsaleable: unsaleableLots.map((recommendation) => recommendation.id),
      stockoutRisk: stockoutRiskLots.map((recommendation) => recommendation.id),
    },
    metrics: {
      activeLots: recommendations.length,
      atRiskLots: recommendations.filter((recommendation) => recommendation.riskScore >= 60).length,
      blockedForFreshness: observations.filter(
        (observation) => observation.freshnessStatus === "stale"
      ).length,
    },
  };
}

export function buildAggregatedSnapshots({ stores, payload, signalObservations }) {
  return stores.map((store) => {
    const storeObservations = signalObservations.filter(
      (observation) => observation.storeId === store.id
    );
    const storeRecommendations = payload.latestRun.recommendations.filter(
      (recommendation) => recommendation.storeId === store.id
    );
    return buildSnapshot(store, storeObservations, storeRecommendations);
  });
}

export function buildAggregationRunSummary({ snapshotKey, signalObservations, aggregatedSnapshots }) {
  return {
    snapshotKey,
    observedSourceCount: signalObservations.length,
    storeCount: aggregatedSnapshots.length,
    degradedStores: aggregatedSnapshots.filter((snapshot) => snapshot.sourceHealth !== "healthy")
      .length,
  };
}
