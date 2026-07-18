import {
  getAuthContext,
  isSupabaseServerConfigured
} from './_lib/supabase.js';

const MAX_IMAGE_DATA_URL_LENGTH = 14 * 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 180;
const MAX_RESULT_TEXT_LENGTH = 12000;
const HISTORY_LIMIT = 12;
const ANALYSIS_TIMEOUT_MS = 65000;
const DEFAULT_CIYUAN_BASE_URL = 'https://ciyuan.today';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const STORAGE_BUCKET = 'reverse-prompt-assets';

function json(res, status, payload) {
  res.status(status).json(payload);
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function getProviderConfig() {
  // Prefer the existing Ciyuan channel when both keys exist; it is the
  // project's current image provider and keeps reverse-prompt costs aligned.
  const apiKey = process.env.REVERSE_PROMPT_API_KEY
    || process.env.CIYUAN_API_KEY
    || process.env.OPENAI_API_KEY;
  const isOpenAI = Boolean(apiKey && apiKey === process.env.OPENAI_API_KEY && !process.env.CIYUAN_API_KEY && !process.env.REVERSE_PROMPT_API_KEY);
  const rawBaseUrl = process.env.REVERSE_PROMPT_BASE_URL
    || (isOpenAI ? process.env.OPENAI_BASE_URL : process.env.CIYUAN_BASE_URL)
    || (isOpenAI ? DEFAULT_OPENAI_BASE_URL : DEFAULT_CIYUAN_BASE_URL);
  const baseUrl = String(rawBaseUrl).replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith('/v1')
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  return {
    apiKey,
    endpoint,
    provider: isOpenAI ? 'openai' : 'ciyuan',
    model: process.env.REVERSE_PROMPT_MODEL
      || process.env.CIYUAN_VISION_MODEL
      || (isOpenAI ? 'gpt-4.1' : 'gpt-4o')
  };
}

function parseImageDataUrl(value) {
  const image = String(value || '');
  if (image.length > MAX_IMAGE_DATA_URL_LENGTH) return null;
  const match = image.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) return null;
  return { dataUrl: `data:${mimeType};base64,${base64}`, mimeType, buffer };
}

function optionValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function buildInstruction({ outputLanguage, detail, purpose }) {
  const language = outputLanguage === 'en' ? 'English' : outputLanguage === 'bilingual' ? 'Chinese and English' : 'Simplified Chinese';
  const detailLabel = detail === 'concise' ? 'concise but specific' : detail === 'standard' ? 'balanced' : 'professional and exhaustive';
  const purposeLabel = {
    general: 'general image generation',
    advertising: 'commercial/product advertising',
    portrait: 'portrait photography',
    poster: 'poster and editorial design',
    infographic: 'infographic and information design'
  }[purpose] || 'general image generation';

  return `You are the visual analysis engine for Visual Atlas, a professional visual reference archive. Analyze the attached image and reverse-engineer it into an executable image-generation brief.

Output language: ${language}.
Detail level: ${detailLabel}.
Intended use: ${purposeLabel}.

Rules:
1. Describe only observable visual evidence. Do not identify a real person, infer private attributes, or claim facts that cannot be seen.
2. Read visible typography only when it is legible. If text is unclear, say it is unreadable instead of inventing it.
3. Separate what is confidently observed from uncertain interpretation.
4. Make the final prompt useful for image generation: include subject, action, environment, composition, camera, lighting, palette, materials, style, typography/layout, and quality constraints.
5. Return JSON only. No Markdown fences, no commentary, and no extra keys.

Return exactly this shape:
{
  "summary": "one sentence visual summary",
  "sections": [
    {"label": "Subject & action", "value": "..."},
    {"label": "Scene & environment", "value": "..."},
    {"label": "Composition & camera", "value": "..."},
    {"label": "Light & atmosphere", "value": "..."},
    {"label": "Color & material", "value": "..."},
    {"label": "Art direction", "value": "..."},
    {"label": "Typography & layout", "value": "..."},
    {"label": "Quality & detail", "value": "..."}
  ],
  "negative": "comma-separated negative prompt",
  "uncertainties": "short list of uncertain or unreadable details; use an empty string when none",
  "prompt": "one complete, copy-ready image-generation prompt",
  "confidence": 0.0
}`;
}

function stripJsonFences(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function textValue(value, fallback = '') {
  const text = String(value || '').trim();
  return text.slice(0, MAX_RESULT_TEXT_LENGTH) || fallback;
}

function normalizeAnalysis(raw) {
  const parsed = JSON.parse(stripJsonFences(raw));
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections
      .map((section) => ({
        label: textValue(section?.label),
        value: textValue(section?.value)
      }))
      .filter((section) => section.label && section.value)
      .slice(0, 8)
    : [];
  if (!textValue(parsed.summary) || !textValue(parsed.prompt) || sections.length < 4) {
    throw new Error('INVALID_MODEL_RESULT');
  }

  const confidence = Number(parsed.confidence);
  return {
    summary: textValue(parsed.summary),
    sections,
    negative: textValue(parsed.negative),
    uncertainties: textValue(parsed.uncertainties),
    prompt: textValue(parsed.prompt),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.75
  };
}

function extractModelText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('');
  return payload?.output_text || '';
}

async function analyzeImage(image, options) {
  const config = getProviderConfig();
  if (!config.apiKey) {
    const error = new Error('VISION_PROVIDER_NOT_CONFIGURED');
    error.code = 'VISION_PROVIDER_NOT_CONFIGURED';
    error.status = 500;
    throw error;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 2600,
        messages: [
          { role: 'system', content: 'You are a precise visual analysis assistant. Follow the requested JSON schema exactly.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: buildInstruction(options) },
              { type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } }
            ]
          }
        ]
      })
    });
  } catch (error) {
    const wrapped = new Error(error?.name === 'AbortError' ? 'VISION_PROVIDER_TIMEOUT' : 'VISION_PROVIDER_UNAVAILABLE');
    wrapped.code = error?.name === 'AbortError' ? 'VISION_PROVIDER_TIMEOUT' : 'VISION_PROVIDER_UNAVAILABLE';
    wrapped.status = error?.name === 'AbortError' ? 504 : 503;
    throw wrapped;
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || 'VISION_PROVIDER_FAILED');
    error.code = response.status === 429 ? 'VISION_PROVIDER_BUSY' : 'VISION_PROVIDER_FAILED';
    error.status = response.status;
    throw error;
  }

  try {
    return { result: normalizeAnalysis(extractModelText(payload)), model: config.model, provider: config.provider };
  } catch {
    const error = new Error('INVALID_MODEL_RESULT');
    error.code = 'INVALID_MODEL_RESULT';
    error.status = 502;
    throw error;
  }
}

async function formatHistoryRow(client, row) {
  let image = '';
  if (row.image_path) {
    const signed = await client.storage.from(STORAGE_BUCKET).createSignedUrl(row.image_path, 60 * 60 * 24 * 7);
    image = signed?.data?.signedUrl || '';
  }
  return {
    id: row.id,
    image,
    fileName: row.file_name || '',
    createdAt: row.created_at || '',
    result: row.result || null,
    outputLanguage: row.output_language || 'zh-CN',
    detail: row.detail || 'professional',
    purpose: row.purpose || 'general'
  };
}

async function saveHistory(auth, { image, fileName, outputLanguage, detail, purpose }, result) {
  const path = `${auth.user.id}/${Date.now()}-${crypto.randomUUID()}.jpg`;
  const upload = await auth.client.storage.from(STORAGE_BUCKET).upload(path, image.buffer, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false
  });
  if (upload.error) throw upload.error;

  const { data, error } = await auth.client
    .from('reverse_prompt_runs')
    .insert({
      user_id: auth.user.id,
      file_name: String(fileName || '').slice(0, MAX_FILE_NAME_LENGTH),
      image_path: path,
      output_language: outputLanguage,
      detail,
      purpose,
      result
    })
    .select('*')
    .single();
  if (error) {
    await auth.client.storage.from(STORAGE_BUCKET).remove([path]).catch(() => {});
    throw error;
  }
  return formatHistoryRow(auth.client, data);
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  if (!isSupabaseServerConfigured()) return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });

  const auth = await getAuthContext(req);
  if (auth.error) return json(res, auth.status || 401, { ok: false, error: auth.error, loginRequired: auth.error === 'AUTH_REQUIRED' });

  if (req.method === 'GET') {
    const { data, error } = await auth.client
      .from('reverse_prompt_runs')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) return json(res, 503, { ok: false, error: 'REVERSE_HISTORY_UNAVAILABLE' });
    return json(res, 200, { ok: true, history: await Promise.all((data || []).map((row) => formatHistoryRow(auth.client, row))) });
  }

  if (req.method === 'DELETE') {
    const id = String(req.query?.id || '').trim();
    if (!id) return json(res, 400, { ok: false, error: 'INVALID_REVERSE_RUN' });
    const { data: row } = await auth.client
      .from('reverse_prompt_runs')
      .select('id,image_path')
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (!row) return json(res, 404, { ok: false, error: 'REVERSE_RUN_NOT_FOUND' });
    const { error } = await auth.client.from('reverse_prompt_runs').delete().eq('id', id).eq('user_id', auth.user.id);
    if (error) return json(res, 500, { ok: false, error: 'REVERSE_DELETE_FAILED' });
    if (row.image_path) await auth.client.storage.from(STORAGE_BUCKET).remove([row.image_path]).catch(() => {});
    return json(res, 200, { ok: true, id });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'INVALID_REVERSE_IMAGE' });
  }
  const image = parseImageDataUrl(body.image);
  if (!image) return json(res, 400, { ok: false, error: 'INVALID_REVERSE_IMAGE' });
  const options = {
    outputLanguage: optionValue(body.outputLanguage, ['zh-CN', 'en', 'bilingual'], 'zh-CN'),
    detail: optionValue(body.detail, ['concise', 'standard', 'professional'], 'professional'),
    purpose: optionValue(body.purpose, ['general', 'advertising', 'portrait', 'poster', 'infographic'], 'general')
  };

  try {
    const analyzed = await analyzeImage(image, options);
    let historyRow = null;
    let saved = true;
    try {
      historyRow = await saveHistory(auth, { image, fileName: body.fileName, ...options }, analyzed.result);
    } catch (storageError) {
      saved = false;
      console.warn('Reverse prompt result was not persisted', { message: String(storageError?.message || 'unknown').slice(0, 240) });
    }
    return json(res, 200, {
      ok: true,
      result: analyzed.result,
      run: historyRow,
      saved,
      provider: analyzed.provider,
      model: analyzed.model
    });
  } catch (error) {
    console.warn('Reverse prompt analysis failed', {
      code: error?.code || null,
      status: error?.status || null,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, error?.status || 502, { ok: false, error: error?.code || 'REVERSE_ANALYSIS_FAILED' });
  }
}
