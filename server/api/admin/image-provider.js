import { getSupabaseAdminClient } from '../_lib/supabase.js';
import { readJsonBody } from '../_lib/billing.js';
import { json, requireSuperAdmin } from '../_lib/content.js';

export default async function handler(req, res) {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  const client = getSupabaseAdminClient();
  if (!client) return json(res, 500, { ok: false, error: 'SERVER_NOT_CONFIGURED' });

  if (req.method === 'GET') {
    const { data, error } = await client.from('image_provider_settings').select('provider').eq('id', true).maybeSingle();
    if (error) return json(res, 500, { ok: false, error: 'IMAGE_PROVIDER_LOAD_FAILED' });
    return json(res, 200, {
      ok: true,
      provider: data?.provider === 'ciyuan' ? 'ciyuan' : 'openai',
      available: { openai: Boolean(process.env.OPENAI_API_KEY), ciyuan: Boolean(process.env.CIYUAN_API_KEY) }
    });
  }

  if (req.method !== 'PATCH') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  let body;
  try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false, error: 'INVALID_IMAGE_PROVIDER' }); }
  const provider = body.provider === 'ciyuan' ? 'ciyuan' : body.provider === 'openai' ? 'openai' : '';
  if (!provider) return json(res, 400, { ok: false, error: 'INVALID_IMAGE_PROVIDER' });
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) return json(res, 400, { ok: false, error: 'OPENAI_NOT_CONFIGURED' });
  if (provider === 'ciyuan' && !process.env.CIYUAN_API_KEY) return json(res, 400, { ok: false, error: 'CIYUAN_NOT_CONFIGURED' });
  const { error } = await client.from('image_provider_settings').upsert({ id: true, provider, updated_by: auth.user.id }, { onConflict: 'id' });
  if (error) return json(res, 500, { ok: false, error: 'IMAGE_PROVIDER_SAVE_FAILED' });
  return json(res, 200, { ok: true, provider });
}
