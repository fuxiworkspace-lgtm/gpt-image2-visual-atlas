import { readJsonBody } from '../../_lib/billing.js';
import { formatCase, json, normalizeCaseInput, requireSuperAdmin, validCaseInput } from '../../_lib/content.js';

export default async function handler(req, res) {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  const table = auth.client.from('content_cases');

  if (req.method === 'GET') {
    const { data, error } = await table.select('*').order('sort_order', { ascending: false }).order('created_at', { ascending: false });
    if (error) return json(res, 500, { ok: false, error: 'CONTENT_LOAD_FAILED' });
    return json(res, 200, { ok: true, cases: (data || []).map(formatCase) });
  }

  let body;
  try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false, error: 'INVALID_CONTENT' }); }
  const input = normalizeCaseInput(body);
  if (req.method === 'POST') {
    if (!validCaseInput(input)) return json(res, 400, { ok: false, error: 'CASE_REQUIRED_FIELDS' });
    const { data, error } = await table.insert({ ...input, created_by: auth.user.id }).select('*').single();
    if (error) return json(res, 500, { ok: false, error: 'CONTENT_SAVE_FAILED' });
    return json(res, 201, { ok: true, case: formatCase(data) });
  }

  if (req.method === 'PATCH') {
    if (!validCaseInput(input)) return json(res, 400, { ok: false, error: 'CASE_REQUIRED_FIELDS' });
    const id = Number(body.id);
    if (!Number.isInteger(id)) return json(res, 400, { ok: false, error: 'INVALID_CONTENT_ID' });
    const { data, error } = await table.update(input).eq('id', id).select('*').single();
    if (error) return json(res, 500, { ok: false, error: 'CONTENT_SAVE_FAILED' });
    return json(res, 200, { ok: true, case: formatCase(data) });
  }

  if (req.method === 'DELETE') {
    const id = Number(body.id);
    if (!Number.isInteger(id)) return json(res, 400, { ok: false, error: 'INVALID_CONTENT_ID' });
    const { error } = await table.delete().eq('id', id);
    if (error) return json(res, 500, { ok: false, error: 'CONTENT_DELETE_FAILED' });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
}
