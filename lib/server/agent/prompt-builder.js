import { DEFAULT_PROMPT_TEMPLATE } from "@/lib/server/control-tower/constants";
import { ACTION_PROPOSAL_RESPONSE_SCHEMA } from "@/lib/server/agent/schemas";

export function getDefaultPromptTemplateRecord() {
  return {
    name: DEFAULT_PROMPT_TEMPLATE.NAME,
    version: DEFAULT_PROMPT_TEMPLATE.VERSION,
    systemPrompt:
      "You generate structured control-tower proposals for a fresh-food retail operator. Output JSON only.",
    developerPrompt:
      "Recommend bounded actions only. Never claim authority to execute. Prefer conservative proposals when source health is degraded.",
    responseSchemaJson: ACTION_PROPOSAL_RESPONSE_SCHEMA,
    isActive: true,
  };
}

export function buildPromptContext({ storeSnapshot, storePolicy, llmMode }) {
  const candidates = (storeSnapshot.recommendations ?? []).map((recommendation) => ({
    recommendationId: recommendation.id,
    skuName: recommendation.skuName,
    category: recommendation.category,
    lotId: recommendation.lotId,
    riskScore: recommendation.riskScore,
    recommendedDiscountPct: recommendation.recommendedDiscountPct,
    recommendedPrice: recommendation.recommendedPrice,
    activePrice: recommendation.activePrice,
    approvalThresholdPct: recommendation.approvalThresholdPct,
    hoursToExpiry: recommendation.lot?.hoursToExpiry ?? null,
    confidenceScore: recommendation.lot?.confidenceScore ?? null,
    unitCost: recommendation.lot?.cost ?? recommendation.lot?.unitCost ?? 0,
    candidateType: storeSnapshot.candidateLots?.unsaleable?.includes(recommendation.id)
      ? "unsaleable"
      : storeSnapshot.candidateLots?.stockoutRisk?.includes(recommendation.id)
        ? "stockout_risk"
        : "markdown",
  }));

  return {
    store: {
      id: storeSnapshot.storeId,
      name: storeSnapshot.storeName,
      district: storeSnapshot.district,
      sourceHealth: storeSnapshot.sourceHealth,
      llmMode,
    },
    sourceFreshness: storeSnapshot.sourceFreshness ?? [],
    routeCounts: storeSnapshot.routeCounts ?? {},
    policy: {
      approvalThresholdPct: storePolicy?.approvalThresholdPct ?? 50,
      markdownMaxAutoDiscountPct: storePolicy?.markdownMaxAutoDiscountPct ?? 50,
      procurementSpendCap: storePolicy?.procurementSpendCap ?? 250,
    },
    candidates,
  };
}

export function buildPromptEnvelope({
  storeSnapshot,
  storePolicy,
  llmMode,
  promptTemplate = getDefaultPromptTemplateRecord(),
}) {
  const promptContext = buildPromptContext({ storeSnapshot, storePolicy, llmMode });
  const userPrompt = [
    "Return JSON with a top-level `proposals` array.",
    "Each proposal must reference a recommendationId from the provided candidates.",
    "Allowed proposalType values: markdown, unsaleable, stockout_risk.",
    "Allowed executionRoute values: label, approval, logistics, procurement.",
    "Include recommendedDiscountPct, proposedPrice, rationale, and optional metadata.",
    "Use conservative markdowns when confidence is low or source health is degraded.",
    "",
    JSON.stringify(promptContext, null, 2),
  ].join("\n");

  return {
    promptTemplate,
    promptContext,
    request: {
      systemPrompt: promptTemplate.systemPrompt,
      developerPrompt: promptTemplate.developerPrompt,
      userPrompt,
      responseSchemaJson: promptTemplate.responseSchemaJson,
    },
  };
}
