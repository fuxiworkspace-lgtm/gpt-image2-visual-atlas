import { getSupabaseAdminClient } from '../_lib/supabase.js';
import { formatCase, json } from '../_lib/content.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const client = getSupabaseAdminClient();
  if (!client) return json(res, 200, { ok: true, cases: [] });
  const { data, error } = await client
    .from('content_cases')
    .select('*')
    .eq('published', true)
    .order('sort_order', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return json(res, 500, { ok: false, error: 'CONTENT_LOAD_FAILED' });
  return json(res, 200, { ok: true, cases: (data || []).map(formatCase) });
}
