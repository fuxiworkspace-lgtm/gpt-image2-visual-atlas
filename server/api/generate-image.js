import {
  getAuthContext,
  getProfileById,
  getSupabaseAdminClient,
  isSupabaseServerConfigured
} from './_lib/supabase.js';

const MAX_PROMPT_LENGTH = 6000;
const IMAGE_REQUEST_TIMEOUT_MS = 45000;
const DEFAULT_CIYUAN_BASE_URL = 'https://ciyuan.today';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

function json(res, status, payload) {
  res.status(status).json(payload);
}

function isServerConfigured() {
  return Boolean(
    (process.env.OPENAI_API_KEY || process.env.CIYUAN_API_KEY) &&
    isSupabaseServerConfigured()
  );
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function normalizeReservation(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.reservation_id) return null;
  return {
    reservationId: row.reservation_id,
    usedFreeGeneration: Boolean(row.used_free_generation),
    creditAmount: Number(row.credit_amount || 0),
    freeGenerationsUsed: Number(row.free_generations_used || 0),
    creditBalance: Number(row.credit_balance || 0)
  };
}

function profileFromReservation(profile, reservation) {
  if (!profile || !reservation) return profile;
  const usage = profile.usage || {};
  return {
    ...profile,
    creditBalance: reservation.creditBalance,
    freeGenerationsUsed: reservation.freeGenerationsUsed,
    freeUsed: reservation.freeGenerationsUsed >= 1,
    usage: {
      ...usage,
      totalGenerations: Number(usage.totalGenerations || 0) + 1,
      totalGenerationCredits: Number(usage.totalGenerationCredits || 0) + Number(reservation.creditAmount || 0)
    }
  };
}

async function reserveGeneration(client, userId, caseId, prompt) {
  const { data, error } = await client.rpc('reserve_generation_usage', {
    p_user_id: userId,
    p_case_id: caseId,
    p_prompt: prompt,
    p_force_credit: false
  });

  if (error) {
    const normalizedMessage = String(error.message || error.details || '').toUpperCase();
    if (normalizedMessage.includes('CREDITS_REQUIRED')) {
      const limitError = new Error('CREDITS_REQUIRED');
      limitError.code = 'CREDITS_REQUIRED';
      throw limitError;
    }
    throw error;
  }

  const reservation = normalizeReservation(data);
  if (!reservation) throw new Error('RESERVATION_FAILED');
  return reservation;
}

async function reserveCreditGeneration(client, userId, caseId, prompt) {
  const { data, error } = await client.rpc('reserve_generation_usage', {
    p_user_id: userId,
    p_case_id: caseId,
    p_prompt: prompt,
    p_force_credit: true
  });

  if (error) {
    const normalizedMessage = String(error.message || error.details || '').toUpperCase();
    if (normalizedMessage.includes('CREDITS_REQUIRED')) {
      const limitError = new Error('CREDITS_REQUIRED');
      limitError.code = 'CREDITS_REQUIRED';
      throw limitError;
    }
    throw error;
  }

  const reservation = normalizeReservation(data);
  if (!reservation) throw new Error('RESERVATION_FAILED');
  return reservation;
}

async function completeReservation(client, reservationId) {
  const { error } = await client.rpc('complete_generation_reservation', {
    p_reservation_id: reservationId
  });
  if (error) throw error;
}

async function releaseReservation(client, reservationId, errorCode) {
  if (!reservationId) return;
  const { error } = await client.rpc('release_generation_reservation', {
    p_reservation_id: reservationId,
    p_error_code: errorCode || 'GENERATION_FAILED'
  });
  if (error) {
    console.warn('Failed to release generation reservation', {
      reservationId,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
  }
}

async function getImageProvider() {
  const fallback = process.env.OPENAI_API_KEY ? 'openai' : 'ciyuan';
  const client = getSupabaseAdminClient();
  if (!client) return fallback;
  const { data } = await client
    .from('image_provider_settings')
    .select('provider')
    .eq('id', true)
    .maybeSingle();
  return data?.provider === 'ciyuan' && process.env.CIYUAN_API_KEY ? 'ciyuan' : fallback;
}

async function generateImage(prompt) {
  const provider = await getImageProvider();
  const isOpenAI = provider === 'openai';
  const baseUrl = (isOpenAI
    ? (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL)
    : (process.env.CIYUAN_BASE_URL || DEFAULT_CIYUAN_BASE_URL)
  ).replace(/\/$/, '');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(`${baseUrl}${isOpenAI ? '/images/generations' : '/v1/images/generations'}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${isOpenAI ? process.env.OPENAI_API_KEY : process.env.CIYUAN_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: isOpenAI ? (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2') : 'gpt-image-2',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'low',
        ...(isOpenAI ? { output_format: 'jpeg' } : { format: 'jpeg' })
      })
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Image provider timed out');
      timeoutError.status = 504;
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      throw timeoutError;
    }
    const networkError = new Error('Image provider could not be reached');
    networkError.status = 503;
    networkError.code = 'UPSTREAM_UNAVAILABLE';
    networkError.cause = error;
    throw networkError;
  } finally {
    clearTimeout(timeoutId);
  }
  const payload = await response.json().catch(() => ({}));
  const item = Array.isArray(payload?.data) ? payload.data[0] : payload?.data;
  const b64 = item?.b64_json || payload?.b64_json || '';
  const imageUrl = item?.url || item?.image_url || payload?.url || payload?.image_url || '';
  const image = b64 ? `data:image/jpeg;base64,${b64}` : imageUrl;

  if (!response.ok || !image) {
    const message = payload?.error?.message || payload?.message || `Image generation failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error?.code || payload?.code;
    error.type = payload?.error?.type || payload?.type;
    throw error;
  }

  return { image, provider };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  if (!isServerConfigured()) {
    return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });
  }

  const auth = await getAuthContext(req, { allowAnonymous: req.method === 'GET' });
  if (auth.error) {
    return json(res, auth.status || 401, {
      ok: false,
      error: auth.error,
      loginRequired: auth.error === 'AUTH_REQUIRED'
    });
  }

  if (req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      authRequired: !auth.profile,
      freeUsed: Boolean(auth.profile?.freeUsed),
      user: auth.profile || null
    });
  }

  if (!auth.user || !auth.profile) {
    return json(res, 401, { ok: false, error: 'AUTH_REQUIRED', loginRequired: true });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { ok: false, error: 'INVALID_PROMPT' });
  }

  const prompt = String(body.prompt || '').trim();
  const caseId = Number(body.caseId);
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH || !Number.isFinite(caseId)) {
    return json(res, 400, { ok: false, error: 'INVALID_PROMPT' });
  }

  let reservation;
  try {
    reservation = auth.profile.isSuperAdmin
      ? await reserveCreditGeneration(auth.client, auth.user.id, caseId, prompt)
      : await reserveGeneration(auth.client, auth.user.id, caseId, prompt);
  } catch (error) {
    if (error?.code === 'CREDITS_REQUIRED') {
      return json(res, 402, { ok: false, error: 'CREDITS_REQUIRED' });
    }
    console.warn('Failed to reserve generation usage', {
      userId: auth.user.id,
      message: String(error?.message || 'unknown').slice(0, 240)
    });
    return json(res, 500, { ok: false, error: 'GENERATION_FAILED' });
  }

  try {
    const result = await generateImage(prompt);
    await completeReservation(auth.client, reservation.reservationId);
    return json(res, 200, {
      ok: true,
      image: result.image,
      provider: result.provider,
      user: profileFromReservation(auth.profile, reservation)
    });
  } catch (error) {
    console.warn('Image generation failed', {
      status: error?.status || null,
      code: error?.code || null,
      type: error?.type || null,
      message: String(error?.message || 'unknown').slice(0, 240)
    });

    const upstreamUnavailable = [502, 503, 504, 522, 524].includes(Number(error?.status))
      || error?.code === 'UPSTREAM_TIMEOUT'
      || error?.code === 'UPSTREAM_UNAVAILABLE';
    const errorCode = error?.status === 429
      ? 'UPSTREAM_BUSY'
      : upstreamUnavailable
        ? 'UPSTREAM_UNAVAILABLE'
        : 'GENERATION_FAILED';
    await releaseReservation(auth.client, reservation.reservationId, errorCode);

    const refreshedProfile = await getProfileById(auth.user.id).catch(() => null);
    if (error?.status === 429) {
      return json(res, 503, { ok: false, error: 'UPSTREAM_BUSY', user: refreshedProfile });
    }
    if (upstreamUnavailable) {
      return json(res, 503, { ok: false, error: 'UPSTREAM_UNAVAILABLE', user: refreshedProfile });
    }
    return json(res, 502, { ok: false, error: 'GENERATION_FAILED', user: refreshedProfile });
  }
}
