import {
  LLM_PROVIDERS,
  LLM_ROLLOUT_MODES,
} from "@/lib/server/control-tower/constants";
import { getProviderAdapter, resolveProviderName } from "@/lib/server/agent/provider-registry";

const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 15000);
const DEFAULT_MAX_RETRIES = Number(process.env.LLM_MAX_RETRIES ?? 2);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateCost(provider, usage) {
  const totalTokens = Number(usage?.totalTokens ?? 0);
  if (!totalTokens) {
    return 0;
  }

  const perThousand =
    provider === LLM_PROVIDERS.OPENAI ? 0.01 :
    provider === LLM_PROVIDERS.GEMINI ? 0.008 :
    0;
  return Number(((totalTokens / 1000) * perThousand).toFixed(4));
}

function shouldRetry(error) {
  return [
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_TIMEOUT",
    "PROVIDER_FAILED",
  ].includes(error.code);
}

function resolveMode(storePolicy) {
  return storePolicy?.llmMode ?? process.env.LLM_MODE ?? LLM_ROLLOUT_MODES.SHADOW;
}

function resolveModel(provider) {
  if (provider === LLM_PROVIDERS.OPENAI) {
    return process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4.1-mini";
  }
  if (provider === LLM_PROVIDERS.GEMINI) {
    return process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-2.5-pro";
  }
  return "mock-control-tower-v1";
}

export async function runProposalAgent({ storeSnapshot, storePolicy, promptEnvelope }) {
  const mode = resolveMode(storePolicy);
  const requestedProvider = resolveProviderName(process.env.LLM_PROVIDER);
  const liveProviderConfigured =
    (requestedProvider === LLM_PROVIDERS.OPENAI && Boolean(process.env.OPENAI_API_KEY)) ||
    (requestedProvider === LLM_PROVIDERS.GEMINI && Boolean(process.env.GEMINI_API_KEY));
  const provider =
    mode === LLM_ROLLOUT_MODES.LIVE && !liveProviderConfigured
      ? requestedProvider
      : liveProviderConfigured
        ? requestedProvider
        : LLM_PROVIDERS.MOCK;

  if (mode === LLM_ROLLOUT_MODES.DISABLED) {
    return {
      provider: LLM_PROVIDERS.MOCK,
      model: "disabled",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      rawText: JSON.stringify({ proposals: [] }),
      rawJson: { proposals: [] },
      retryCount: 0,
      latencyMs: 0,
      failureCode: null,
      failureReason: null,
      timedOut: false,
      rateLimited: false,
      requestEcho: promptEnvelope.request,
      mode,
      estimatedCost: 0,
    };
  }

  const adapter = getProviderAdapter(provider);
  const model = resolveModel(provider);
  let retryCount = 0;
  let lastError = null;

  while (retryCount <= DEFAULT_MAX_RETRIES) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const result = await adapter({
        promptEnvelope,
        storeSnapshot,
        storePolicy,
        model,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return {
        ...result,
        retryCount,
        estimatedCost: estimateCost(result.provider, result.usage),
        mode,
      };
    } catch (error) {
      clearTimeout(timeout);
      lastError = error.name === "AbortError"
        ? Object.assign(new Error("provider request timed out"), { code: "PROVIDER_TIMEOUT", timedOut: true })
        : error;
      if (!shouldRetry(lastError) || retryCount >= DEFAULT_MAX_RETRIES) {
        break;
      }
      retryCount += 1;
      await sleep(250 * retryCount);
    }
  }

  throw Object.assign(lastError ?? new Error("provider request failed"), {
    retryCount,
    mode,
  });
}
