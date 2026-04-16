import { LLM_PROVIDERS } from "@/lib/server/control-tower/constants";
import { buildProposalSeedFromRecommendation } from "@/lib/server/agent/validate-proposals";

export async function generateWithMock({ promptEnvelope, storeSnapshot, storePolicy, model }) {
  const proposals = (storeSnapshot.recommendations ?? [])
    .filter((recommendation) => recommendation.riskScore >= 45)
    .map((recommendation) =>
      buildProposalSeedFromRecommendation(recommendation, storeSnapshot, storePolicy)
    );

  return {
    provider: LLM_PROVIDERS.MOCK,
    model: model || "mock-control-tower-v1",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    rawText: JSON.stringify({ proposals }, null, 2),
    rawJson: { proposals },
    retryCount: 0,
    latencyMs: 1,
    failureCode: null,
    failureReason: null,
    timedOut: false,
    rateLimited: false,
    requestEcho: promptEnvelope.request,
  };
}
