import { LLM_PROVIDERS } from "@/lib/server/control-tower/constants";
import { generateWithOpenAI } from "@/lib/server/agent/providers/openai";
import { generateWithGemini } from "@/lib/server/agent/providers/gemini";
import { generateWithMock } from "@/lib/server/agent/providers/mock";

const PROVIDERS = {
  [LLM_PROVIDERS.OPENAI]: generateWithOpenAI,
  [LLM_PROVIDERS.GEMINI]: generateWithGemini,
  [LLM_PROVIDERS.MOCK]: generateWithMock,
};

const MODELS_BY_TIER = {
  low: "gemini-2.0-flash",
  medium: "gemini-2.5-flash-preview-04-17",
  high: "gemini-2.5-pro-preview-03-25",
};

export function getProviderAdapter(provider) {
  return PROVIDERS[provider] ?? PROVIDERS[LLM_PROVIDERS.MOCK];
}

export function getModelForTier(tier) {
  return MODELS_BY_TIER[tier] ?? MODELS_BY_TIER.medium;
}

export function resolveProviderName(provider) {
  if (provider && PROVIDERS[provider]) {
    return provider;
  }
  return process.env.LLM_PROVIDER ?? LLM_PROVIDERS.MOCK;
}
