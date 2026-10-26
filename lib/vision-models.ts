export type VisionProvider = 'gemini' | 'openrouter';

export interface VisionModelOption {
  id: string;
  name: string;
  subtitle: string;
  provider: VisionProvider;
  badge: string;
  contextLength?: number;
  supportsTools?: boolean;
}

export const DEFAULT_VISION_MODEL_ID = 'gemini-3.8-flash';
export const OPENROUTER_AUTO_VISION_ID = 'openrouter:auto';

export const GEMINI_PRIMARY_MODEL_OPTION: VisionModelOption = {
  id: DEFAULT_VISION_MODEL_ID,
  name: 'Gemini 3.8 Flash',
  subtitle: 'Primary Vision · Auto OpenRouter Free Failover',
  provider: 'gemini',
  badge: 'Primary',
  contextLength: 1_048_576,
  supportsTools: true,
};

export const OPENROUTER_AUTO_MODEL_OPTION: VisionModelOption = {
  id: OPENROUTER_AUTO_VISION_ID,
  name: 'OpenRouter · Auto Free Vision',
  subtitle: 'Cascades across live working :free vision models',
  provider: 'openrouter',
  badge: 'Free Auto',
  supportsTools: true,
};

/**
 * Empirically verified OpenRouter Free Vision Models (:free) that support direct API multimodal requests.
 * Excludes harness-restricted models (such as thinkingmachines/inkling*) that return HTTP 403 on custom apps.
 */
export const DEFAULT_OPENROUTER_FREE_VISION_MODELS: VisionModelOption[] = [
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'Nemotron 3.5 Super VL',
    subtitle: 'NVIDIA · 1M Context · High-Res Chart Vision',
    provider: 'openrouter',
    badge: 'Free',
    contextLength: 1_000_000,
    supportsTools: true,
  },
  {
    id: 'dots-studio/dots-3-note-preview:free',
    name: 'Dots 3 Note Preview',
    subtitle: 'Dots Studio · 512K Context · Fast Multimodal Vision',
    provider: 'openrouter',
    badge: 'Free',
    contextLength: 512_000,
    supportsTools: true,
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'Nemotron 3 Nano Omni',
    subtitle: 'NVIDIA · 256K Context · Multimodal Reasoning',
    provider: 'openrouter',
    badge: 'Free',
    contextLength: 256_000,
    supportsTools: true,
  },
  {
    id: 'openrouter/free',
    name: 'OpenRouter Free Router',
    subtitle: 'OpenRouter · Dynamic Free Multimodal Router',
    provider: 'openrouter',
    badge: 'Free Router',
    contextLength: 200_000,
    supportsTools: true,
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B',
    subtitle: 'Google · 262K Context · Free Vision',
    provider: 'openrouter',
    badge: 'Free',
    contextLength: 262_144,
    supportsTools: true,
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Gemma 4 26B A4B',
    subtitle: 'Google MoE · 262K Context · Fast Free Vision',
    provider: 'openrouter',
    badge: 'Free',
    contextLength: 262_144,
    supportsTools: true,
  },
];

export const INITIAL_VISION_MODEL_CATALOG: VisionModelOption[] = [
  GEMINI_PRIMARY_MODEL_OPTION,
  OPENROUTER_AUTO_MODEL_OPTION,
  ...DEFAULT_OPENROUTER_FREE_VISION_MODELS,
];

export function isRestrictedHarnessModelId(modelId?: string | null): boolean {
  if (!modelId) return false;
  const lower = modelId.toLowerCase();
  return lower.startsWith('thinkingmachines/');
}

export function isOpenRouterModelSelection(modelId?: string | null): boolean {
  if (!modelId) return false;
  return (
    modelId === OPENROUTER_AUTO_VISION_ID ||
    modelId === 'openrouter/free' ||
    modelId.includes('/')
  );
}
