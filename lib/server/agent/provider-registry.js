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

export function resolveProviderName(provider) {
  if (provider && PROVIDERS[provider]) {
    return provider;
  }
  return process.env.LLM_PROVIDER ?? LLM_PROVIDERS.MOCK;
}
