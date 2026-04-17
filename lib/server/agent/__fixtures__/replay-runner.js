/**
 * Self-contained replay runner for model-run regression validation.
 *
 * Exercises the parsing pipeline and guardrail evaluation against every
 * fixture scenario without requiring a live provider or database.
 *
 * Usage:
 *   import { runAllReplayScenarios } from "@/lib/server/agent/__fixtures__/replay-runner";
 *   const results = runAllReplayScenarios();
 */

import { parseProviderResponse } from "@/lib/server/agent/response-parser";
import { normalizeActionProposal } from "@/lib/server/agent/validate-proposals";
import { evaluateProposal } from "@/lib/server/rules/evaluate-proposal";
import { buildPromptEnvelope } from "@/lib/server/agent/prompt-builder";

import { ALL_SCENARIOS, toStoreSnapshot } from "./scenarios";
import { ALL_VALID_RESPONSES, ALL_FAILURE_RESPONSES, getResponsesForScenario } from "./provider-responses";

// ─── Replay Helpers ──────────────────────────────────────────────────────────

function runParseReplay(response, scenario) {
  const result = parseProviderResponse(response.rawText);
  const parsePass = result.parseStatus === response.expectedParseStatus;

  return {
    responseLabel: response.label,
    expectedParseStatus: response.expectedParseStatus,
    actualParseStatus: result.parseStatus,
    proposalCount: result.proposals.length,
    parsePass,
    failureCode: result.failureCode,
    failureReason: result.failureReason,
  };
}

function runGuardrailReplay(scenario) {
  const storeSnapshot = toStoreSnapshot(scenario);
  const responses = getResponsesForScenario(scenario.id).filter(
    (r) => r.expectedParseStatus === "parsed"
  );

  if (!responses.length) {
    return {
      scenarioId: scenario.id,
      story: scenario.story,
      description: scenario.description,
      skipped: true,
      reason: "No valid-parse responses for this scenario",
    };
  }

  const response = responses[0];
  const parsed = parseProviderResponse(response.rawText);

  if (parsed.parseStatus !== "parsed" || !parsed.proposals.length) {
    return {
      scenarioId: scenario.id,
      story: scenario.story,
      description: scenario.description,
      skipped: true,
      reason: `Parse failed: ${parsed.failureReason}`,
    };
  }

  const guardrailResults = parsed.proposals.map((proposalSeed) => {
    try {
      const normalized = normalizeActionProposal(proposalSeed, storeSnapshot);
      const guardrail = evaluateProposal({
        proposal: normalized,
        storePolicy: scenario.storePolicy,
        sourceHealth: scenario.sourceHealth,
      });
      return {
        recommendationId: normalized.recommendationId,
        proposalType: normalized.proposalType,
        guardrailOutcome: guardrail.outcome,
        executionRoute: guardrail.executionRoute,
        matchedRule: guardrail.matchedRule,
        pass: scenario.expectedGuardrailOutcome === "mixed"
          ? true
          : guardrail.outcome === scenario.expectedGuardrailOutcome,
      };
    } catch (error) {
      return {
        recommendationId: proposalSeed.recommendationId,
        proposalType: proposalSeed.proposalType,
        error: error.message,
        pass: false,
      };
    }
  });

  const allPassed = guardrailResults.every((r) => r.pass);

  return {
    scenarioId: scenario.id,
    story: scenario.story,
    description: scenario.description,
    skipped: false,
    guardrailResults,
    pass: allPassed,
  };
}

function runPromptBuildReplay(scenario) {
  const storeSnapshot = toStoreSnapshot(scenario);

  try {
    const envelope = buildPromptEnvelope({
      storeSnapshot,
      storePolicy: scenario.storePolicy,
      llmMode: scenario.storePolicy.llmMode,
    });

    const hasSystemPrompt = typeof envelope.request.systemPrompt === "string" && envelope.request.systemPrompt.length > 0;
    const hasUserPrompt = typeof envelope.request.userPrompt === "string" && envelope.request.userPrompt.length > 0;
    const hasContext = envelope.promptContext != null;
    const hasCandidates = Array.isArray(envelope.promptContext?.candidates) && envelope.promptContext.candidates.length > 0;

    return {
      scenarioId: scenario.id,
      pass: hasSystemPrompt && hasUserPrompt && hasContext && hasCandidates,
      hasSystemPrompt,
      hasUserPrompt,
      hasContext,
      candidateCount: envelope.promptContext?.candidates?.length ?? 0,
    };
  } catch (error) {
    return {
      scenarioId: scenario.id,
      pass: false,
      error: error.message,
    };
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Run all replay scenarios through the parse pipeline.
 * Returns results for every response fixture against its paired scenario.
 */
export function runParseReplays() {
  const results = [];

  for (const response of [...ALL_VALID_RESPONSES, ...ALL_FAILURE_RESPONSES]) {
    const scenario = ALL_SCENARIOS.find((s) => s.id === response.scenarioId);
    results.push({
      scenarioId: response.scenarioId,
      ...runParseReplay(response, scenario),
    });
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.parsePass).length,
    failed: results.filter((r) => !r.parsePass).length,
    results,
  };
}

/**
 * Run all replay scenarios through the guardrail pipeline.
 * Returns guardrail outcome results for every scenario.
 */
export function runGuardrailReplays() {
  const results = ALL_SCENARIOS.map(runGuardrailReplay);
  const evaluated = results.filter((r) => !r.skipped);

  return {
    total: results.length,
    evaluated: evaluated.length,
    passed: evaluated.filter((r) => r.pass).length,
    failed: evaluated.filter((r) => !r.pass).length,
    skipped: results.filter((r) => r.skipped).length,
    results,
  };
}

/**
 * Run all replay scenarios through the prompt build pipeline.
 * Returns prompt construction results for every scenario.
 */
export function runPromptBuildReplays() {
  const results = ALL_SCENARIOS.map(runPromptBuildReplay);

  return {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
  };
}

/**
 * Run all replay categories and return a combined summary.
 */
export function runAllReplayScenarios() {
  const parse = runParseReplays();
  const guardrails = runGuardrailReplays();
  const prompts = runPromptBuildReplays();

  const allPassed = parse.failed === 0 && guardrails.failed === 0 && prompts.failed === 0;

  return {
    pass: allPassed,
    summary: {
      parse: { passed: parse.passed, failed: parse.failed, total: parse.total },
      guardrails: { passed: guardrails.passed, failed: guardrails.failed, total: guardrails.evaluated },
      prompts: { passed: prompts.passed, failed: prompts.failed, total: prompts.total },
    },
    parse,
    guardrails,
    prompts,
  };
}
