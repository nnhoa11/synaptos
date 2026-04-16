import {
  SIMULATION_LABEL,
  SOURCE_FAMILIES,
  SOURCE_TYPES,
} from "@/lib/server/control-tower/constants";

function toFreshness(snapshotTimeMs, observedTimeMs, allowedAgeMs) {
  const ageMs = Math.max(0, snapshotTimeMs - observedTimeMs);
  return {
    ageMinutes: Math.round(ageMs / 60000),
    status: ageMs <= allowedAgeMs ? "fresh" : ageMs <= allowedAgeMs * 2 ? "degraded" : "stale",
  };
}

function buildExternalObservations(store, snapshotTimeMs) {
  return [
    {
      sourceType: SOURCE_TYPES.WEATHER,
      sourceFamily: SOURCE_FAMILIES.EXTERNAL,
      observedAt: new Date(snapshotTimeMs - 45 * 60000).toISOString(),
      freshnessWindowMs: 90 * 60000,
      payload: {
        district: store.district,
        temperatureC: store.archetype === "premium" ? 31 : store.archetype === "transit" ? 34 : 29,
        humidityPct: 71,
      },
    },
    {
      sourceType: SOURCE_TYPES.DEMOGRAPHICS,
      sourceFamily: SOURCE_FAMILIES.EXTERNAL,
      observedAt: new Date(snapshotTimeMs - 12 * 60 * 60000).toISOString(),
      freshnessWindowMs: 24 * 60 * 60000,
      payload: {
        district: store.district,
        footfallMix: store.archetype,
      },
    },
    {
      sourceType: SOURCE_TYPES.COMMODITY,
      sourceFamily: SOURCE_FAMILIES.EXTERNAL,
      observedAt: new Date(snapshotTimeMs - 3 * 60 * 60000).toISOString(),
      freshnessWindowMs: 8 * 60 * 60000,
      payload: {
        seafoodIndex: 1.08,
        meatIndex: 1.04,
        dairyIndex: 0.98,
      },
    },
  ];
}

function buildInternalObservations(store, snapshotTimeMs, storeRecommendations) {
  const soldUnits = storeRecommendations.reduce(
    (sum, recommendation) => sum + (recommendation.lot?.recentVelocity ?? 0),
    0
  );
  const inventoryUnits = storeRecommendations.reduce(
    (sum, recommendation) => sum + (recommendation.lot?.quantityOnHand ?? 0),
    0
  );

  return [
    {
      sourceType: SOURCE_TYPES.POS,
      sourceFamily: SOURCE_FAMILIES.INTERNAL,
      observedAt: new Date(snapshotTimeMs - 15 * 60000).toISOString(),
      freshnessWindowMs: 60 * 60000,
      payload: {
        soldUnits: Number(soldUnits.toFixed(2)),
        activeRecommendations: storeRecommendations.length,
      },
    },
    {
      sourceType: SOURCE_TYPES.INVENTORY,
      sourceFamily: SOURCE_FAMILIES.INTERNAL,
      observedAt: new Date(snapshotTimeMs - 10 * 60000).toISOString(),
      freshnessWindowMs: 45 * 60000,
      payload: {
        quantityOnHand: Number(inventoryUnits.toFixed(2)),
        lowConfidenceLots: storeRecommendations.filter(
          (recommendation) => (recommendation.lot?.confidenceScore ?? 1) < 0.75
        ).length,
      },
    },
  ];
}

export function buildSignalObservations({ snapshotKey, stores, payload }) {
  const snapshotTimeMs = new Date(snapshotKey).getTime();
  return stores.flatMap((store) => {
    const storeRecommendations = payload.latestRun.recommendations.filter(
      (recommendation) => recommendation.storeId === store.id
    );
    const rawObservations = [
      ...buildExternalObservations(store, snapshotTimeMs),
      ...buildInternalObservations(store, snapshotTimeMs, storeRecommendations),
    ];

    return rawObservations.map((observation) => {
      const observedTimeMs = new Date(observation.observedAt).getTime();
      const freshness = toFreshness(
        snapshotTimeMs,
        observedTimeMs,
        observation.freshnessWindowMs
      );
      return {
        ...observation,
        storeId: store.id,
        snapshotKey,
        observedAt: observation.observedAt,
        provenance: SIMULATION_LABEL,
        freshnessStatus: freshness.status,
        freshnessMinutes: freshness.ageMinutes,
      };
    });
  });
}
