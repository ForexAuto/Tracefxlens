import {
  createGeminiFallbackResponse,
  createGeminiFallbackStream,
  hasGeminiApiKey,
} from '@/lib/gemini';

export const OPENAI_TRADING_MODEL = 'gpt-6.1-sol';
const DEFAULT_GPT_FALLBACK_TIMEOUT_MS = 28000;

type OpenAIRequestOptions = {
  input: unknown;
  instructions?: string;
  signal?: AbortSignal;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxOutputTokens?: number;
  responseFormat?: 'json_object';
  tools?: unknown[];
  gptTimeoutMs?: number;
};

export function hasOpenAIApiKey(): boolean {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  return Boolean(key && key !== 'MY_OPENAI_API_KEY');
}

export function hasAnyAiProviderKey(): boolean {
  return hasOpenAIApiKey() || hasGeminiApiKey();
}

function apiKey(): string {
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key || key === 'MY_OPENAI_API_KEY') {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }
  return key;
}

async function upstreamError(response: Response): Promise<Error> {
  let message = `OpenAI API request failed (HTTP ${response.status}).`;
  try {
    const body = await response.json();
    if (typeof body?.error?.message === 'string') message = body.error.message;
  } catch {}
  return new Error(message);
}

function ensureJsonInstruction(input: unknown): unknown {
  const instruction = 'Return a valid json object. Do not wrap it in markdown.';

  if (typeof input === 'string') {
    return `${input}\n\n${instruction}`;
  }

  if (!Array.isArray(input)) {
    return [{ role: 'user', content: [{ type: 'input_text', text: instruction }] }];
  }

  const messages = input.map((item) => (
    item && typeof item === 'object' ? { ...(item as Record<string, unknown>) } : item
  ));
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index] && typeof messages[index] === 'object' &&
        (messages[index] as Record<string, unknown>).role === 'user') {
      userIndex = index;
      break;
    }
  }

  if (userIndex < 0) {
    messages.push({ role: 'user', content: [{ type: 'input_text', text: instruction }] });
    return messages;
  }

  const userMessage = messages[userIndex] as Record<string, unknown>;
  if (typeof userMessage.content === 'string') {
    userMessage.content = `${userMessage.content}\n\n${instruction}`;
  } else if (Array.isArray(userMessage.content)) {
    userMessage.content = [
      ...userMessage.content,
      { type: 'input_text', text: instruction },
    ];
  } else {
    userMessage.content = [{ type: 'input_text', text: instruction }];
  }

  messages[userIndex] = userMessage;
  return messages;
}

function requestBody(options: OpenAIRequestOptions) {
  return {
    model: OPENAI_TRADING_MODEL,
    input: options.responseFormat === 'json_object'
      ? ensureJsonInstruction(options.input)
      : options.input,
    ...(options.instructions ? { instructions: options.instructions } : {}),
    reasoning: { effort: options.reasoningEffort || 'medium' },
    max_output_tokens: options.maxOutputTokens || 6000,
    ...(options.responseFormat ? { text: { format: { type: options.responseFormat } } } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
  };
}

function createLinkedSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
    } else {
      parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new Error(`GPT request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
    },
  };
}

export async function createOpenAIResponse(options: OpenAIRequestOptions): Promise<any> {
  const canFallbackToGemini = hasGeminiApiKey();

  if (!hasOpenAIApiKey()) {
    if (canFallbackToGemini) {
      return createGeminiFallbackResponse(options);
    }
    throw new Error('Neither OPENAI_API_KEY nor GEMINI_API_KEY is configured on the server.');
  }

  const timeoutMs = canFallbackToGemini
    ? (options.gptTimeoutMs ?? DEFAULT_GPT_FALLBACK_TIMEOUT_MS)
    : options.gptTimeoutMs;
  const linked = createLinkedSignal(options.signal, timeoutMs);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(options)),
      signal: linked.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw await upstreamError(response);
    const json = await response.json();
    const hasOutputText = Boolean(extractOpenAIOutputText(json).trim());
    const hasToolCalls =
      Array.isArray(json?.output) &&
      json.output.some((item: any) => item?.type === 'function_call');
    if (!hasOutputText && !hasToolCalls) {
      throw new Error('OpenAI returned an empty response.');
    }
    return json;
  } catch (err) {
    if (options.signal?.aborted || !canFallbackToGemini) {
      throw err;
    }
    console.warn('[AI Fallback] OpenAI request failed, falling back to gemini-3.1-flash-lite:', err instanceof Error ? err.message : err);
    return createGeminiFallbackResponse(options);
  } finally {
    linked.cleanup();
  }
}

export function extractOpenAIOutputText(response: any): string {
  if (typeof response?.output_text === 'string') return response.output_text;
  const chunks: string[] = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('');
}

export async function createOpenAIResponseStream(options: OpenAIRequestOptions): Promise<AsyncIterable<string>> {
  if (!hasOpenAIApiKey()) {
    throw new Error('OPENAI_API_KEY is not configured on the server.');
  }

  const linked = createLinkedSignal(options.signal, options.gptTimeoutMs ?? DEFAULT_GPT_FALLBACK_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ ...requestBody(options), stream: true }),
      signal: linked.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw await upstreamError(response);
    if (!response.body) throw new Error('OpenAI returned an empty streaming response.');
  } catch (err) {
    linked.cleanup();
    throw err;
  }

  // This helper is deliberately OpenAI-only. The Analyze route owns fallback
  // selection so the reported PR/FB attribution always matches the provider used.
  return (async function* () {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let yieldedAnyText = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        linked.cleanup();
        buffer += decoder.decode(value, { stream: true }).replace(/\\r\\n/g, '\\n');
        let split = buffer.indexOf('\\n\\n');
        while (split >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = block.split('\\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\\n');
          if (data && data !== '[DONE]') {
            const event = JSON.parse(data);
            if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
              yieldedAnyText = true;
              yield event.delta;
            }
            if (event.type === 'error' || event.type === 'response.failed') {
              throw new Error(event.error?.message || event.response?.error?.message || 'OpenAI analysis failed.');
            }
            if (event.type === 'response.completed' && event.response?.status === 'incomplete') {
              throw new Error('OpenAI ended the response before completing the analysis.');
            }
          }
          split = buffer.indexOf('\\n\\n');
        }
      }
      if (!yieldedAnyText) {
        throw new Error('OpenAI stream ended without generating text.');
      }
    } catch (streamErr) {
      throw streamErr;
    } finally {
      linked.cleanup();
      reader.releaseLock();
    }
  })();
}
