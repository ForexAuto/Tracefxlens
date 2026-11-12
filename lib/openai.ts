export const OPENAI_TRADING_MODEL = 'gpt-6.1-sol';

type OpenAIRequestOptions = {
  input: unknown;
  instructions?: string;
  signal?: AbortSignal;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxOutputTokens?: number;
  responseFormat?: 'json_object';
  tools?: unknown[];
};

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not configured on the server.');
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

function requestBody(options: OpenAIRequestOptions) {
  return {
    model: OPENAI_TRADING_MODEL,
    input: options.input,
    ...(options.instructions ? { instructions: options.instructions } : {}),
    reasoning: { effort: options.reasoningEffort || 'medium' },
    max_output_tokens: options.maxOutputTokens || 6000,
    ...(options.responseFormat ? { text: { format: { type: options.responseFormat } } } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
  };
}

export async function createOpenAIResponse(options: OpenAIRequestOptions): Promise<any> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody(options)),
    signal: options.signal,
    cache: 'no-store',
  });
  if (!response.ok) throw await upstreamError(response);
  return response.json();
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
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ ...requestBody(options), stream: true }),
    signal: options.signal,
    cache: 'no-store',
  });
  if (!response.ok) throw await upstreamError(response);
  if (!response.body) throw new Error('OpenAI returned an empty streaming response.');
  return (async function* () {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let split = buffer.indexOf('\n\n');
        while (split >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
          if (data && data !== '[DONE]') {
            const event = JSON.parse(data);
            if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') yield event.delta;
            if (event.type === 'error' || event.type === 'response.failed') {
              throw new Error(event.error?.message || event.response?.error?.message || 'OpenAI analysis failed.');
            }
            if (event.type === 'response.completed' && event.response?.status === 'incomplete') {
              throw new Error('OpenAI ended the response before completing the analysis.');
            }
          }
          split = buffer.indexOf('\n\n');
        }
      }
    } finally { reader.releaseLock(); }
  })();
}
