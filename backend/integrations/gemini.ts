import { HttpError } from '@/backend/http';

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export interface GeminiImage {
  mime: string;
  data: string; // base64
}

export interface GeminiSource {
  title: string;
  uri: string;
}

interface Opts {
  system?: string;
  prompt: string;
  images?: GeminiImage[];
  /** JSON schema (Gemini OpenAPI subset, UPPERCASE types). Enables strict JSON mode. */
  schema?: Record<string, unknown>;
  /** Grounding with Google Search. Cannot be combined with `schema`; the prompt must ask for JSON. */
  grounding?: boolean;
  temperature?: number;
}

/** Gemini-style schema (UPPERCASE types, nullable) to standard JSON schema for OpenRouter. */
function toJsonSchema(n: any): any {
  if (Array.isArray(n)) return n.map(toJsonSchema);
  if (!n || typeof n !== 'object') return n;
  const o: any = {};
  for (const [k, v] of Object.entries(n)) {
    if (k === 'nullable') continue;
    o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v);
  }
  if (n.nullable && o.type) o.type = [o.type, 'null'];
  if (o.type === 'object' && o.properties) { o.additionalProperties = false; o.required = Object.keys(o.properties); }
  return o;
}

/** Google models only, served by Google's own infrastructure, through OpenRouter (used when OPENROUTER_API_KEY is set). */
async function viaOpenRouter(opts: Opts, key: string): Promise<{ text: string; sources: GeminiSource[] }> {
  const content: unknown[] = [{ type: 'text', text: opts.prompt }];
  for (const img of opts.images ?? []) content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } });
  const body: Record<string, unknown> = {
    model: process.env.OPENROUTER_MODEL || 'google/gemini-3.7-flash',
    temperature: opts.temperature ?? 0.2,
    messages: [...(opts.system ? [{ role: 'system', content: opts.system }] : []), { role: 'user', content }],
    provider: { only: ['google-vertex', 'google-ai-studio'], allow_fallbacks: false },
  };
  if (opts.schema) body.response_format = { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: toJsonSchema(opts.schema) } };
  if (opts.grounding) body.plugins = [{ id: 'web' }];
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const msg = json.choices?.[0]?.message;
      const text = typeof msg?.content === 'string' ? msg.content : (msg?.content ?? []).map((p: { text?: string }) => p.text ?? '').join('');
      if (!text) throw new HttpError(502, `The model returned no text (${json.choices?.[0]?.finish_reason ?? json.error?.message ?? 'unknown'}).`);
      const seen = new Set<string>();
      const sources = (msg?.annotations ?? [])
        .filter((a: any) => a.type === 'url_citation' && a.url_citation?.url)
        .map((a: any) => ({ title: a.url_citation.title || a.url_citation.url, uri: a.url_citation.url }))
        .filter((x: GeminiSource) => !seen.has(x.uri) && seen.add(x.uri));
      return { text, sources };
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status === 402) break;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new HttpError(502, `AI request failed: ${lastErr}`);
}

export async function gemini(opts: Opts): Promise<{ text: string; sources: GeminiSource[] }> {
  // OpenRouter first. If it fails (outage, no credit) and a direct Google key is configured, use that instead so the app keeps working.
  if (process.env.OPENROUTER_API_KEY) {
    try { return await viaOpenRouter(opts, process.env.OPENROUTER_API_KEY); }
    catch (e) { if (!process.env.GEMINI_API_KEY) throw e; console.warn('OpenRouter failed, falling back to the direct Gemini key:', e instanceof Error ? e.message.slice(0, 160) : e); }
  }
  return viaGoogle(opts);
}

async function viaGoogle(opts: Opts): Promise<{ text: string; sources: GeminiSource[] }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(500, 'GEMINI_API_KEY is not set.');
  if (opts.grounding && opts.schema) throw new Error('Grounding and responseSchema cannot be combined.');

  const parts: unknown[] = [{ text: opts.prompt }];
  for (const img of opts.images ?? []) parts.push({ inline_data: { mime_type: img.mime, data: img.data } });

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      ...(opts.schema ? { responseMimeType: 'application/json', responseSchema: opts.schema } : {}),
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.grounding) body.tools = [{ google_search: {} }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`;
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      const cand = json.candidates?.[0];
      const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
      if (!text) throw new HttpError(502, `Gemini returned no text (${cand?.finishReason ?? 'unknown'}).`);
      const chunks: { web?: { title?: string; uri?: string } }[] = cand?.groundingMetadata?.groundingChunks ?? [];
      const seen = new Set<string>();
      const sources = chunks
        .map((c) => ({ title: c.web?.title ?? c.web?.uri ?? '', uri: c.web?.uri ?? '' }))
        .filter((s) => s.uri && !seen.has(s.uri) && seen.add(s.uri));
      return { text, sources };
    }
    lastErr = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new HttpError(502, `Gemini request failed: ${lastErr}`);
}

/** Parse JSON from model text, tolerating code fences and leading/trailing prose. */
export function parseJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new HttpError(502, 'Gemini did not return valid JSON.');
  }
}

export const S = {
  str: { type: 'STRING' },
  num: { type: 'NUMBER' },
  int: { type: 'INTEGER' },
  enum: (values: string[]) => ({ type: 'STRING', enum: values }),
  arr: (items: unknown) => ({ type: 'ARRAY', items }),
  obj: (properties: Record<string, unknown>, required?: string[]) => ({
    type: 'OBJECT',
    properties,
    required: required ?? Object.keys(properties),
  }),
};
