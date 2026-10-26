import {
  DEFAULT_OPENROUTER_FREE_VISION_MODELS,
  GEMINI_PRIMARY_MODEL_OPTION,
  isRestrictedHarnessModelId,
  OPENROUTER_AUTO_MODEL_OPTION,
  OPENROUTER_AUTO_VISION_ID,
  type VisionModelOption,
} from '@/lib/vision-models';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const PRIORITY_MODEL_ORDER: string[] = [
  'nvidia/nemotron-3.5-super-vl:free',
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'openrouter/free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];

interface RawOpenRouterModel {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
  };
  supported_parameters?: string[];
}

let cachedFreeVisionModels: {
  models: VisionModelOption[];
  fetchedAt: number;
} | null = null;

export function getOpenRouterApiKey(): string | null {
  const raw = process.env.OPENROUTER_API_KEY?.trim();
  if (!raw || raw === 'MY_OPENROUTER_API_KEY') return null;
  return raw;
}

export function hasOpenRouterKey(): boolean {
  return Boolean(getOpenRouterApiKey());
}

export function hasGeminiKey(): boolean {
  const raw = process.env.GEMINI_API_KEY?.trim();
  return Boolean(raw && raw !== 'MY_GEMINI_API_KEY');
}

function formatContextBadge(ctx?: number): string {
  if (!ctx || ctx <= 0) return 'Free Vision';
  if (ctx >= 1_000_000) {
    return `${Math.round(ctx / 1_000_000)}M Context · Free Vision`;
  }
  return `${Math.round(ctx / 1000)}K Context · Free Vision`;
}

function cleanDisplayName(
  rawName: string,
  id: string
): {
  providerLabel: string;
  shortName: string;
} {
  const withoutFree = rawName.replace(/\s*\(free\)\s*$/i, '').trim();
  const colonIdx = withoutFree.indexOf(':');
  if (colonIdx > 0) {
    return {
      providerLabel: withoutFree.slice(0, colonIdx).trim(),
      shortName: withoutFree.slice(colonIdx + 1).trim(),
    };
  }
  const slashIdx = id.indexOf('/');
  const fallbackProvider =
    slashIdx > 0
      ? id
          .slice(0, slashIdx)
          .replace(/(^|-)([a-z])/g, (_, p1, p2) => `${p1 ? ' ' : ''}${p2.toUpperCase()}`)
      : 'OpenRouter';
  return {
    providerLabel: fallbackProvider,
    shortName: withoutFree || id,
  };
}

function isUnsupportedOrRestrictedModel(
  id: string,
  name: string,
  description = ''
): boolean {
  if (isRestrictedHarnessModelId(id)) return true;
  const lower = `${id} ${name} ${description}`.toLowerCase();
  return (
    lower.includes('agentic harnesses') ||
    lower.includes('only available on') ||
    lower.includes('content-safety') ||
    lower.includes('llama-guard') ||
    lower.includes('shieldgemma') ||
    lower.includes('safeguard') ||
    lower.includes('moderation')
  );
}

/**
 * Fetches and caches live free vision-capable chat models from OpenRouter,
 * automatically excluding harness-restricted (403) and moderation-only models.
 */
export async function getLiveOpenRouterFreeVisionModels(): Promise<
  VisionModelOption[]
> {
  if (
    cachedFreeVisionModels &&
    Date.now() - cachedFreeVisionModels.fetchedAt < CATALOG_CACHE_TTL_MS
  ) {
    return cachedFreeVisionModels.models;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/models`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      next: { revalidate: 600 },
    });

    if (!res.ok) {
      throw new Error(`OpenRouter catalog HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: RawOpenRouterModel[] };
    const list = Array.isArray(json?.data) ? json.data : [];

    const discovered: VisionModelOption[] = [];

    for (const item of list) {
      const id = item.id?.trim();
      if (!id) continue;

      const inputs = item.architecture?.input_modalities || [];
      const outputs = item.architecture?.output_modalities || ['text'];
      const supportsImage = inputs.includes('image');
      const supportsTextOnly =
        outputs.includes('text') && !outputs.includes('audio');
      if (!supportsImage || !supportsTextOnly) continue;

      const isFree = id.endsWith(':free') || id === 'openrouter/free';
      if (!isFree) continue;
      if (
        isUnsupportedOrRestrictedModel(
          id,
          item.name || '',
          item.description || ''
        )
      ) {
        continue;
      }

      const curated = DEFAULT_OPENROUTER_FREE_VISION_MODELS.find(
        (c) => c.id === id
      );
      if (curated) {
        discovered.push({
          ...curated,
          contextLength: item.context_length || curated.contextLength,
          supportsTools: Array.isArray(item.supported_parameters)
            ? item.supported_parameters.includes('tools')
            : curated.supportsTools,
        });
        continue;
      }

      const { providerLabel, shortName } = cleanDisplayName(
        item.name || id,
        id
      );
      discovered.push({
        id,
        name: shortName,
        subtitle: `${providerLabel} · ${formatContextBadge(item.context_length)}`,
        provider: 'openrouter',
        badge: id === 'openrouter/free' ? 'Free Router' : 'Free',
        contextLength: item.context_length,
        supportsTools: Array.isArray(item.supported_parameters)
          ? item.supported_parameters.includes('tools')
          : false,
      });
    }

    if (discovered.length > 0) {
      discovered.sort((a, b) => {
        const idxA = PRIORITY_MODEL_ORDER.indexOf(a.id);
        const idxB = PRIORITY_MODEL_ORDER.indexOf(b.id);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return (b.contextLength || 0) - (a.contextLength || 0);
      });

      cachedFreeVisionModels = {
        models: discovered,
        fetchedAt: Date.now(),
      };
      return discovered;
    }
  } catch {
    // Fallback to verified curated list if catalog request fails
  } finally {
    clearTimeout(timeout);
  }

  return DEFAULT_OPENROUTER_FREE_VISION_MODELS;
}

export async function getFullVisionModelCatalog(): Promise<VisionModelOption[]> {
  const freeModels = await getLiveOpenRouterFreeVisionModels();
  return [
    GEMINI_PRIMARY_MODEL_OPTION,
    OPENROUTER_AUTO_MODEL_OPTION,
    ...freeModels,
  ];
}

/**
 * Resolves an ordered cascade of OpenRouter free vision model IDs to try.
 * Automatically skips harness-restricted models and includes `openrouter/free` as smart catch-all.
 */
export async function resolveOpenRouterVisionCascade(
  preferredModelId?: string | null,
  maxCandidates = 5
): Promise<string[]> {
  const liveModels = await getLiveOpenRouterFreeVisionModels();
  const liveIds = liveModels.map((m) => m.id);

  const ordered: string[] = [];
  if (
    preferredModelId &&
    preferredModelId !== OPENROUTER_AUTO_VISION_ID &&
    preferredModelId.includes('/') &&
    !isRestrictedHarnessModelId(preferredModelId)
  ) {
    ordered.push(preferredModelId);
  }

  for (const id of liveIds) {
    if (isRestrictedHarnessModelId(id)) continue;
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }

  if (!ordered.includes('openrouter/free')) {
    ordered.push('openrouter/free');
  }

  const trimmed = ordered.slice(0, Math.max(3, maxCandidates));
  if (!trimmed.includes('openrouter/free')) {
    trimmed[trimmed.length - 1] = 'openrouter/free';
  }
  return trimmed;
}

export interface OpenRouterImageInput {
  mimeType: string;
  data: string;
  essential?: boolean;
}

type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenRouterContentPart[];
}

function buildOpenRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.APP_URL || 'https://tracefx-lens.app',
    'X-Title': 'TraceFX Lens',
  };
}

function buildMultimodalMessages(
  systemInstruction: string,
  images: OpenRouterImageInput[],
  promptText: string,
  mergeSystemIntoUser = false
): OpenRouterMessage[] {
  const imageParts: OpenRouterContentPart[] = images.map((img) => ({
    type: 'image_url',
    image_url: {
      url: `data:${img.mimeType};base64,${img.data}`,
    },
  }));

  if (mergeSystemIntoUser) {
    return [
      {
        role: 'user',
        content: [
          ...imageParts,
          {
            type: 'text',
            text: `${systemInstruction}\n\n---\n\n${promptText}`,
          },
        ],
      },
    ];
  }

  return [
    {
      role: 'system',
      content: systemInstruction,
    },
    {
      role: 'user',
      content: [
        ...imageParts,
        {
          type: 'text',
          text: promptText,
        },
      ],
    },
  ];
}

function selectEssentialImages(
  images: OpenRouterImageInput[]
): OpenRouterImageInput[] {
  if (images.length <= 2) return images;
  const essentials = images.filter((img) => img.essential);
  if (essentials.length >= 1 && essentials.length <= 2) {
    return essentials;
  }
  return [images[0], images[images.length - 1]];
}

async function extractOpenRouterErrorText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `OpenRouter HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string; code?: number; metadata?: { raw?: string } };
      };
      const rawMeta = parsed?.error?.metadata?.raw;
      const msg = parsed?.error?.message || text;
      return `OpenRouter ${res.status}: ${msg}${rawMeta ? ` (${rawMeta})` : ''}`;
    } catch {
      return `OpenRouter ${res.status}: ${text.slice(0, 240)}`;
    }
  } catch {
    return `OpenRouter HTTP ${res.status}`;
  }
}

/**
 * Streams text deltas from an OpenRouter multimodal vision model via SSE (`stream: true`).
 * Emits empty heartbeat strings during active `delta.reasoning` chunks so reasoning vision models
 * (like Nemotron VL / Omni) do not trigger premature idle timeouts while thinking.
 */
export async function* streamOpenRouterVision(params: {
  model: string;
  systemInstruction: string;
  images: OpenRouterImageInput[];
  promptText: string;
  temperature?: number;
  signal: AbortSignal;
}): AsyncGenerator<string, void, unknown> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not configured yet. Add OPENROUTER_API_KEY in Settings > Secrets, or switch Vision Engine to Gemini 3.8 Flash.'
    );
  }

  const {
    model,
    systemInstruction,
    images,
    promptText,
    temperature = 0.2,
    signal,
  } = params;

  const attemptRequest = async (
    imgs: OpenRouterImageInput[],
    mergeSystem: boolean
  ) => {
    return fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: buildOpenRouterHeaders(apiKey),
      body: JSON.stringify({
        model,
        stream: true,
        temperature,
        messages: buildMultimodalMessages(
          systemInstruction,
          imgs,
          promptText,
          mergeSystem
        ),
      }),
      signal,
    });
  };

  let res = await attemptRequest(images, false);

  // Compatibility retry if a :free provider rejects >2 images or separate system role (HTTP 400/422)
  if ((res.status === 400 || res.status === 422) && !signal.aborted) {
    const compactImages = selectEssentialImages(images);
    res = await attemptRequest(compactImages, true);
  }

  if (!res.ok) {
    const errText = await extractOpenRouterErrorText(res);
    throw new Error(errText);
  }

  if (!res.body) {
    throw new Error(`OpenRouter ${model}: Empty streaming body.`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = '';
  const reasoningStartedAt = Date.now();
  let emittedContent = false;

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      if (signal.aborted) break;

      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith(':')) {
          // Keepalive comment such as `: OPENROUTER PROCESSING` (allow up to 35s while queued/reasoning)
          if (!emittedContent && Date.now() - reasoningStartedAt < 35_000) {
            yield '';
          }
          continue;
        }
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: {
          error?: { message?: string; code?: number | string };
          choices?: Array<{
            delta?: {
              content?: string | null;
              reasoning?: string | null;
              reasoning_content?: string | null;
            };
            message?: { content?: string | null };
          }>;
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed.error) {
          throw new Error(
            `OpenRouter ${parsed.error.code || 503}: ${
              parsed.error.message || 'Upstream free provider error'
            }`
          );
        }

        const delta = parsed.choices?.[0]?.delta;
        const deltaText =
          delta?.content ?? parsed.choices?.[0]?.message?.content ?? '';

        if (typeof deltaText === 'string' && deltaText.length > 0) {
          emittedContent = true;
          yield deltaText;
        } else if (
          !emittedContent &&
          (delta?.reasoning || delta?.reasoning_content) &&
          Date.now() - reasoningStartedAt < 75_000
        ) {
          // Model is actively streaming reasoning tokens before emitting JSON content
          yield '';
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore lock release errors
    }
  }
}

/**
 * Non-streaming OpenRouter completion helper for Pass 2 Visual Self-Check & Macro Briefs.
 */
export async function generateOpenRouterCompletion(params: {
  model: string;
  systemInstruction: string;
  images?: OpenRouterImageInput[];
  promptText: string;
  temperature?: number;
  signal: AbortSignal;
}): Promise<string> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  const {
    model,
    systemInstruction,
    images = [],
    promptText,
    temperature = 0.15,
    signal,
  } = params;

  const attemptRequest = async (
    imgs: OpenRouterImageInput[],
    mergeSystem: boolean
  ) => {
    return fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: buildOpenRouterHeaders(apiKey),
      body: JSON.stringify({
        model,
        stream: false,
        temperature,
        messages: buildMultimodalMessages(
          systemInstruction,
          imgs,
          promptText,
          mergeSystem
        ),
      }),
      signal,
    });
  };

  let res = await attemptRequest(images, false);
  if ((res.status === 400 || res.status === 422) && !signal.aborted) {
    res = await attemptRequest(selectEssentialImages(images), true);
  }

  if (!res.ok) {
    const errText = await extractOpenRouterErrorText(res);
    throw new Error(errText);
  }

  const data = (await res.json()) as {
    error?: { message?: string; code?: number | string };
    choices?: Array<{
      message?: { content?: string | Array<{ type?: string; text?: string }> };
    }>;
  };

  if (data.error) {
    throw new Error(
      `OpenRouter ${data.error.code || 503}: ${
        data.error.message || 'Upstream provider error'
      }`
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}
