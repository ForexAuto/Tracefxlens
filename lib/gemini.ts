import {
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
  type Schema,
} from '@google/genai';

export const GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

let cachedGeminiClient: GoogleGenAI | null = null;
const geminiContentByOutputItem = new WeakMap<object, Content>();

export function hasGeminiApiKey(): boolean {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  if (!cachedGeminiClient) {
    cachedGeminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedGeminiClient;
}

function parseDataUrlImage(url: string): { mimeType: string; data: string } | null {
  const m = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

function toGeminiSchemaType(rawType: unknown): Type {
  switch (String(rawType || 'string').toLowerCase()) {
    case 'object':
      return Type.OBJECT;
    case 'array':
      return Type.ARRAY;
    case 'number':
      return Type.NUMBER;
    case 'integer':
      return Type.INTEGER;
    case 'boolean':
      return Type.BOOLEAN;
    case 'null':
      return Type.NULL;
    default:
      return Type.STRING;
  }
}

function convertJsonSchemaToGemini(raw: unknown): Schema {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const schemaType = toGeminiSchemaType(obj.type);
  const out: Schema = { type: schemaType };

  if (typeof obj.description === 'string' && obj.description.trim()) {
    out.description = obj.description;
  }
  if (Array.isArray(obj.enum)) {
    out.enum = obj.enum.map(String);
  }
  if (schemaType === Type.OBJECT) {
    const rawProps =
      obj.properties && typeof obj.properties === 'object'
        ? (obj.properties as Record<string, unknown>)
        : {};
    const props: Record<string, Schema> = {};
    for (const [k, v] of Object.entries(rawProps)) {
      props[k] = convertJsonSchemaToGemini(v);
    }
    if (Object.keys(props).length > 0) {
      out.properties = props;
    } else {
      out.properties = { value: { type: Type.STRING } };
    }
    if (Array.isArray(obj.required)) {
      out.required = obj.required.map(String);
    }
  } else if (schemaType === Type.ARRAY && obj.items) {
    out.items = convertJsonSchemaToGemini(obj.items);
  }

  return out;
}

function convertOpenAIToolsToGemini(tools?: unknown[]): FunctionDeclaration[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const decls: FunctionDeclaration[] = [];

  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    const tool = t as Record<string, unknown>;
    if (tool.type !== 'function' || typeof tool.name !== 'string') continue;

    decls.push({
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : undefined,
      parameters: tool.parameters
        ? convertJsonSchemaToGemini(tool.parameters)
        : undefined,
    });
  }

  return decls.length > 0 ? decls : undefined;
}

function convertOpenAIPartsToGemini(content: unknown): Part[] {
  if (typeof content === 'string') {
    return content.trim() ? [{ text: content }] : [];
  }
  if (!Array.isArray(content)) return [];

  const parts: Part[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if ((p.type === 'input_text' || p.type === 'output_text' || p.type === 'text') && typeof p.text === 'string') {
      if (p.text.length > 0) parts.push({ text: p.text });
    } else if (p.type === 'input_image' && typeof p.image_url === 'string') {
      const parsed = parseDataUrlImage(p.image_url);
      if (parsed) {
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        });
      }
    }
  }
  return parts;
}

function pushMergedContent(contents: Content[], role: 'user' | 'model', parts: Part[]) {
  if (parts.length === 0) return;
  const prev = contents[contents.length - 1];
  if (prev && prev.role === role && Array.isArray(prev.parts)) {
    prev.parts.push(...parts);
  } else {
    contents.push({ role, parts });
  }
}

function convertOpenAIInputToGeminiContents(input: unknown): Content[] {
  if (typeof input === 'string') {
    return [{ role: 'user', parts: [{ text: input }] }];
  }
  if (!Array.isArray(input)) {
    return [{ role: 'user', parts: [{ text: String(input ?? '') }] }];
  }

  const contents: Content[] = [];
  const callNameById = new Map<string, string>();
  const emittedGeminiContents = new Set<unknown>();

  for (const rawItem of input) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;

    const preservedContent = geminiContentByOutputItem.get(item);
    if (preservedContent) {
      if (item.type === 'function_call' && typeof item.call_id === 'string' && typeof item.name === 'string') {
        callNameById.set(item.call_id, item.name);
      }
      if (!emittedGeminiContents.has(preservedContent)) {
        emittedGeminiContents.add(preservedContent);
        if (Array.isArray(preservedContent.parts) && preservedContent.parts.length > 0) {
          contents.push({
            role: preservedContent.role === 'user' ? 'user' : 'model',
            parts: preservedContent.parts,
          });
        }
      }
      continue;
    }

    if (item.type === 'function_call') {
      const callId = typeof item.call_id === 'string' ? item.call_id : undefined;
      const name = typeof item.name === 'string' ? item.name : 'unknown_tool';
      if (callId) callNameById.set(callId, name);
      let args: Record<string, unknown> = {};
      if (typeof item.arguments === 'string') {
        try {
          args = JSON.parse(item.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
      } else if (item.arguments && typeof item.arguments === 'object') {
        args = item.arguments as Record<string, unknown>;
      }
      pushMergedContent(contents, 'model', [
        {
          functionCall: {
            id: callId,
            name,
            args,
          },
        },
      ]);
      continue;
    }

    if (item.type === 'function_call_output') {
      const callId = typeof item.call_id === 'string' ? item.call_id : undefined;
      const fnName =
        (typeof item.name === 'string' && item.name) ||
        (callId && callNameById.get(callId)) ||
        'tool_result';
      let responseObj: Record<string, unknown>;
      if (typeof item.output === 'string') {
        try {
          const parsed = JSON.parse(item.output);
          responseObj =
            parsed && typeof parsed === 'object' && !Array.isArray(parsed)
              ? (parsed as Record<string, unknown>)
              : { result: parsed };
        } catch {
          responseObj = { result: item.output };
        }
      } else {
        responseObj = { result: item.output ?? null };
      }

      pushMergedContent(contents, 'user', [
        {
          functionResponse: {
            id: callId,
            name: fnName,
            response: responseObj,
          },
        },
      ]);
      continue;
    }

    const role = item.role === 'assistant' ? 'model' : 'user';
    const parts = convertOpenAIPartsToGemini(item.content);
    pushMergedContent(contents, role, parts);
  }

  return contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: '' }] }];
}

export interface GeminiFallbackOptions {
  input: unknown;
  instructions?: string;
  signal?: AbortSignal;
  responseFormat?: 'json_object';
  tools?: unknown[];
}

export async function createGeminiFallbackResponse(
  options: GeminiFallbackOptions
): Promise<{
  provider: 'gemini';
  model: string;
  output_text: string;
  output: Array<Record<string, unknown>>;
}> {
  const ai = getGeminiClient();
  const contents = convertOpenAIInputToGeminiContents(options.input);
  const functionDeclarations = convertOpenAIToolsToGemini(options.tools);

  const response = await ai.models.generateContent({
    model: GEMINI_FALLBACK_MODEL,
    contents,
    config: {
      ...(options.instructions ? { systemInstruction: options.instructions } : {}),
      ...(options.responseFormat === 'json_object' && !functionDeclarations
        ? { responseMimeType: 'application/json' }
        : {}),
      ...(functionDeclarations ? { tools: [{ functionDeclarations }] } : {}),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    },
  });

  const candidateContent = response.candidates?.[0]?.content;
  const outputText = (response.text ?? '').trim();
  const functionCalls = response.functionCalls || [];
  const output: Array<Record<string, unknown>> = [];

  if (functionCalls.length > 0) {
    functionCalls.forEach((fc, idx) => {
      const callId = fc.id || `gemini_call_${Date.now()}_${idx}`;
      const outputItem: Record<string, unknown> = {
        type: 'function_call',
        id: callId,
        call_id: callId,
        name: fc.name || 'unknown_tool',
        arguments: JSON.stringify(fc.args ?? {}),
      };
      if (candidateContent) {
        geminiContentByOutputItem.set(outputItem, candidateContent);
      }
      output.push(outputItem);
    });
  } else if (outputText) {
    const outputItem: Record<string, unknown> = {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: outputText }],
    };
    if (candidateContent) {
      geminiContentByOutputItem.set(outputItem, candidateContent);
    }
    output.push(outputItem);
  }

  return {
    provider: 'gemini',
    model: GEMINI_FALLBACK_MODEL,
    output_text: outputText,
    output,
  };
}

export async function createGeminiFallbackStream(
  options: GeminiFallbackOptions
): Promise<AsyncIterable<string>> {
  const ai = getGeminiClient();
  const contents = convertOpenAIInputToGeminiContents(options.input);

  const responseStream = await ai.models.generateContentStream({
    model: GEMINI_FALLBACK_MODEL,
    contents,
    config: {
      ...(options.instructions ? { systemInstruction: options.instructions } : {}),
      ...(options.signal ? { abortSignal: options.signal } : {}),
    },
  });

  return (async function* () {
    for await (const chunk of responseStream) {
      if (options.signal?.aborted) break;
      const text = chunk.text;
      if (typeof text === 'string' && text.length > 0) {
        yield text;
      }
    }
  })();
}
