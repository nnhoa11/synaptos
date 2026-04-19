import { LLM_PROVIDERS } from "@/lib/server/control-tower/constants";
import { generateWithOpenAI } from "@/lib/server/agent/providers/openai";
import { generateWithGemini } from "@/lib/server/agent/providers/gemini";
import { generateWithMock } from "@/lib/server/agent/providers/mock";

const PROVIDERS = {
  [LLM_PROVIDERS.OPENAI]: generateWithOpenAI,
  [LLM_PROVIDERS.GEMINI]: generateWithGemini,
  [LLM_PROVIDERS.MOCK]: generateWithMock,
};

export function getProviderAdapter(provider) {
  return PROVIDERS[provider] ?? PROVIDERS[LLM_PROVIDERS.MOCK];
}

export function getModelForTier(tier) {
  if (tier === "low" || tier === "medium") {
    return process.env.GEMINI_MODEL_FLASH || process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-2.5-flash-preview-04-17";
  }

  if (tier === "high") {
    return process.env.GEMINI_MODEL_PRO || process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-2.5-pro-preview-03-25";
  }

  return process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-2.5-flash-preview-04-17";
}

export function resolveProviderName(provider) {
  if (provider && PROVIDERS[provider]) {
    return provider;
  }
  return process.env.LLM_PROVIDER ?? LLM_PROVIDERS.MOCK;
}
