import { getSupabaseAdminClient } from '../_lib/supabase.js';
import { formatHomepage, json } from '../_lib/content.js';

const fallback = { heroImageUrl: '', heroCaseIds: [] };

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const client = getSupabaseAdminClient();
  if (!client) return json(res, 200, { ok: true, homepage: fallback });
  const { data, error } = await client.from('homepage_settings').select('*').eq('id', true).maybeSingle();
  if (error) return json(res, 200, { ok: true, homepage: fallback });
  return json(res, 200, { ok: true, homepage: formatHomepage(data || {}) });
}
