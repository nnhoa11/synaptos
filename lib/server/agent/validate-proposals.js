import {
  EXECUTION_ROUTES,
  PROPOSAL_STATUSES,
  PROPOSAL_TYPES,
} from "@/lib/server/control-tower/constants";

export function buildProposalSeedFromRecommendation(recommendation, storeSnapshot, storePolicy = null) {
  const baseMetadata = {
    riskScore: recommendation.riskScore,
    hoursToExpiry: recommendation.lot?.hoursToExpiry ?? null,
    confidenceScore: recommendation.lot?.confidenceScore ?? null,
    basePrice: recommendation.activePrice ?? recommendation.recommendedPrice,
    unitCost: recommendation.lot?.cost ?? recommendation.lot?.unitCost ?? 0,
  };

  if (storeSnapshot.candidateLots.unsaleable.includes(recommendation.id)) {
    return {
      recommendationId: recommendation.id,
      proposalType: PROPOSAL_TYPES.UNSALEABLE,
      executionRoute: EXECUTION_ROUTES.LOGISTICS,
      recommendedDiscountPct: 0,
      proposedPrice: recommendation.activePrice ?? recommendation.recommendedPrice,
      rationale: "Lot is now unsaleable and should move into routing.",
      metadata: {
        ...baseMetadata,
        logistics: {
          routeType: "cross_dock_or_eol",
          destination:
            recommendation.lot?.hoursToExpiry != null && recommendation.lot.hoursToExpiry <= 1
              ? "eol"
              : "cross_dock",
        },
      },
    };
  }

  if (storeSnapshot.candidateLots.stockoutRisk.includes(recommendation.id)) {
    const quantity = Math.max(4, Math.ceil((recommendation.riskScore ?? 50) / 12));
    return {
      recommendationId: recommendation.id,
      proposalType: PROPOSAL_TYPES.STOCKOUT_RISK,
      executionRoute: EXECUTION_ROUTES.PROCUREMENT,
      recommendedDiscountPct: 0,
      proposedPrice: recommendation.activePrice ?? recommendation.recommendedPrice,
      rationale: "Demand is outpacing available on-hand units.",
      metadata: {
        ...baseMetadata,
        procurement: {
          supplier: storePolicy?.preferredSupplierId ?? "Simulated Preferred Supplier",
          quantity,
        },
      },
    };
  }

  return {
    recommendationId: recommendation.id,
    proposalType: PROPOSAL_TYPES.MARKDOWN,
    executionRoute:
      recommendation.recommendedDiscountPct > recommendation.approvalThresholdPct
        ? EXECUTION_ROUTES.APPROVAL
        : EXECUTION_ROUTES.LABEL,
    recommendedDiscountPct: recommendation.recommendedDiscountPct,
    proposedPrice: recommendation.recommendedPrice,
    rationale: recommendation.reasonSummary,
    metadata: baseMetadata,
  };
}

function buildRecommendationIndex(storeSnapshot) {
  return Object.fromEntries(
    (storeSnapshot.recommendations ?? []).map((recommendation) => [recommendation.id, recommendation])
  );
}

function normalizeLogisticsMetadata(metadata, recommendation) {
  const logistics = metadata.logistics ?? {};
  return {
    ...metadata,
    logistics: {
      routeType: logistics.routeType ?? "cross_dock_or_eol",
      destination:
        logistics.destination ??
        (recommendation?.lot?.hoursToExpiry != null && recommendation.lot.hoursToExpiry <= 1
          ? "eol"
          : "cross_dock"),
    },
  };
}

function normalizeProcurementMetadata(metadata, recommendation) {
  const procurement = metadata.procurement ?? {};
  const quantity = Number(
    procurement.quantity ?? Math.max(4, Math.ceil((metadata.riskScore ?? recommendation?.riskScore ?? 50) / 12))
  );
  if (!Number.isFinite(quantity) || quantity <= 0) {
    const error = new Error("procurement quantity must be positive");
    error.code = "INVALID_PROPOSAL";
    throw error;
  }

  return {
    ...metadata,
    procurement: {
      supplier: procurement.supplier ?? "Simulated Preferred Supplier",
      quantity,
    },
  };
}

export function normalizeActionProposal(seed, storeSnapshot) {
  const recommendationIndex = buildRecommendationIndex(storeSnapshot);
  const recommendation = recommendationIndex[seed.recommendationId];

  if (!seed.recommendationId || !recommendation || !seed.proposalType || !seed.executionRoute) {
    const error = new Error("INVALID_PROPOSAL");
    error.code = "INVALID_PROPOSAL";
    throw error;
  }

  let metadata = {
    riskScore: recommendation.riskScore,
    hoursToExpiry: recommendation.lot?.hoursToExpiry ?? null,
    confidenceScore: recommendation.lot?.confidenceScore ?? null,
    basePrice: recommendation.activePrice ?? recommendation.recommendedPrice,
    unitCost: recommendation.lot?.cost ?? recommendation.lot?.unitCost ?? 0,
    ...(seed.metadata ?? {}),
  };

  if (seed.proposalType === PROPOSAL_TYPES.UNSALEABLE) {
    metadata = normalizeLogisticsMetadata(metadata, recommendation);
  }
  if (seed.proposalType === PROPOSAL_TYPES.STOCKOUT_RISK) {
    metadata = normalizeProcurementMetadata(metadata, recommendation);
  }

  return {
    recommendationId: seed.recommendationId,
    storeId: recommendation.storeId,
    skuName: recommendation.skuName,
    lotId: recommendation.lotId,
    proposalType: seed.proposalType,
    executionRoute: seed.executionRoute,
    recommendedDiscountPct: Number(seed.recommendedDiscountPct ?? 0),
    proposedPrice: Number(seed.proposedPrice ?? recommendation.recommendedPrice ?? 0),
    rationale: seed.rationale ?? "",
    status: seed.status ?? PROPOSAL_STATUSES.DRAFT,
    metadata,
  };
}
