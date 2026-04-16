import {
  AUDIT_TYPES,
  MODEL_RUN_STATUSES,
  PARSE_STATUSES,
} from "@/lib/server/control-tower/constants";
import { runProposalAgent } from "@/lib/server/agent/client";
import { buildPromptEnvelope } from "@/lib/server/agent/prompt-builder";
import { parseProviderResponse } from "@/lib/server/agent/response-parser";
import { normalizeActionProposal } from "@/lib/server/agent/validate-proposals";

function summarizeModelRuns(modelRuns) {
  return modelRuns.reduce(
    (summary, modelRun) => {
      summary.modelRunCount += 1;
      summary.proposalCount += modelRun.proposals.length;
      summary.failedModelRuns += modelRun.status === MODEL_RUN_STATUSES.FAILED ? 1 : 0;
      summary.estimatedCost = Number((summary.estimatedCost + (modelRun.estimatedCost ?? 0)).toFixed(4));
      summary.providers[modelRun.provider] = (summary.providers[modelRun.provider] ?? 0) + 1;
      return summary;
    },
    {
      modelRunCount: 0,
      proposalCount: 0,
      failedModelRuns: 0,
      estimatedCost: 0,
      providers: {},
    }
  );
}

export async function buildAgentRunResult({
  aggregationRunId,
  snapshotKey,
  aggregatedSnapshots,
  storePolicies,
  promptTemplate,
}) {
  const modelRuns = await Promise.all(
    aggregatedSnapshots.map(async (storeSnapshot) => {
      const storePolicy = storePolicies.find((store) => store.id === storeSnapshot.storeId) ?? null;
      const createdAt = new Date().toISOString();
      const promptEnvelope = buildPromptEnvelope({
        storeSnapshot,
        storePolicy,
        llmMode: storePolicy?.llmMode,
        promptTemplate,
      });

      try {
        const providerResult = await runProposalAgent({
          storeSnapshot,
          storePolicy,
          promptEnvelope,
        });
        const parsed = parseProviderResponse(providerResult.rawText);
        const proposals = parsed.proposals.map((proposal) =>
          normalizeActionProposal(proposal, storeSnapshot)
        );

        return {
          storeId: storeSnapshot.storeId,
          aggregationRunId,
          snapshotKey,
          provider: providerResult.provider,
          model: providerResult.model,
          mode: providerResult.mode,
          promptTemplateName: promptTemplate.name,
          promptTemplateVersion: promptTemplate.version,
          status:
            parsed.parseStatus === PARSE_STATUSES.PARSED
              ? MODEL_RUN_STATUSES.COMPLETED
              : MODEL_RUN_STATUSES.FAILED,
          parseStatus: parsed.parseStatus,
          usage: providerResult.usage,
          estimatedCost: providerResult.estimatedCost,
          retryCount: providerResult.retryCount,
          latencyMs: providerResult.latencyMs,
          timedOut: providerResult.timedOut,
          rateLimited: providerResult.rateLimited,
          failureCode: parsed.failureCode,
          failureReason: parsed.failureReason,
          auditType:
            parsed.parseStatus === PARSE_STATUSES.PARSED
              ? AUDIT_TYPES.MODEL_RUN
              : AUDIT_TYPES.PROPOSAL_GENERATION,
          inputArtifact: {
            promptContext: promptEnvelope.promptContext,
            request: providerResult.requestEcho,
          },
          outputArtifact: {
            rawText: providerResult.rawText,
            rawJson: providerResult.rawJson,
            parsedOutput: parsed.parsedOutput,
            parseStatus: parsed.parseStatus,
            errorCode: parsed.failureCode,
            errorMessage: parsed.failureReason,
          },
          proposals,
          createdAt,
          completedAt: new Date().toISOString(),
        };
      } catch (error) {
        return {
          storeId: storeSnapshot.storeId,
          aggregationRunId,
          snapshotKey,
          provider: storePolicy?.llmMode === "disabled" ? "mock" : (process.env.LLM_PROVIDER ?? "mock"),
          model: process.env.LLM_MODEL ?? "unconfigured",
          mode: storePolicy?.llmMode ?? process.env.LLM_MODE ?? "shadow",
          promptTemplateName: promptTemplate.name,
          promptTemplateVersion: promptTemplate.version,
          status: MODEL_RUN_STATUSES.FAILED,
          parseStatus: PARSE_STATUSES.PROVIDER_FAILED,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          estimatedCost: 0,
          retryCount: error.retryCount ?? 0,
          latencyMs: null,
          timedOut: Boolean(error.timedOut),
          rateLimited: Boolean(error.rateLimited),
          failureCode: error.code ?? "PROVIDER_FAILED",
          failureReason: error.message,
          inputArtifact: {
            promptContext: promptEnvelope.promptContext,
            request: promptEnvelope.request,
          },
          outputArtifact: {
            rawText: "",
            rawJson: null,
            parsedOutput: null,
            parseStatus: PARSE_STATUSES.PROVIDER_FAILED,
            errorCode: error.code ?? "PROVIDER_FAILED",
            errorMessage: error.message,
          },
          proposals: [],
          createdAt,
          completedAt: new Date().toISOString(),
        };
      }
    })
  );

  const proposals = modelRuns.flatMap((modelRun) => modelRun.proposals);
  return {
    aggregationRunId,
    snapshotKey,
    summary: {
      ...summarizeModelRuns(modelRuns),
      storeCount: aggregatedSnapshots.length,
    },
    modelRuns,
    proposals,
  };
}
