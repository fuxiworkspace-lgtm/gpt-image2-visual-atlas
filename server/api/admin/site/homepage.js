import { readJsonBody } from '../../_lib/billing.js';
import { formatHomepage, json, normalizeHomepageInput, requireSuperAdmin } from '../../_lib/content.js';

export default async function handler(req, res) {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const { data, error } = await auth.client.from('homepage_settings').select('*').eq('id', true).maybeSingle();
    if (error) return json(res, 500, { ok: false, error: 'HOMEPAGE_LOAD_FAILED' });
    return json(res, 200, { ok: true, homepage: formatHomepage(data || {}) });
  }

  if (req.method !== 'PATCH') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  let body;
  try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false, error: 'INVALID_HOMEPAGE_SETTINGS' }); }
  const input = normalizeHomepageInput(body);
  const { data, error } = await auth.client
    .from('homepage_settings')
    .upsert({ id: true, ...input, updated_by: auth.user.id }, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) return json(res, 500, { ok: false, error: 'HOMEPAGE_SAVE_FAILED' });
  return json(res, 200, { ok: true, homepage: formatHomepage(data) });
}
