import { readJsonBody } from '../../_lib/billing.js';
import { formatTemplate, json, normalizeTemplateInput, requireSuperAdmin, validTemplateInput } from '../../_lib/content.js';

export default async function handler(req, res) {
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  const table = auth.client.from('content_templates');

  if (req.method === 'GET') {
    const { data, error } = await table.select('*').order('sort_order', { ascending: false }).order('created_at', { ascending: false });
    if (error) return json(res, 500, { ok: false, error: 'CONTENT_LOAD_FAILED' });
    return json(res, 200, { ok: true, templates: (data || []).map(formatTemplate) });
  }

  let body;
  try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false, error: 'INVALID_CONTENT' }); }
  const input = normalizeTemplateInput(body);
  if (req.method === 'POST' || req.method === 'PATCH') {
    if (!validTemplateInput(input)) return json(res, 400, { ok: false, error: 'TEMPLATE_REQUIRED_FIELDS' });
    const query = req.method === 'POST'
      ? table.insert({ ...input, created_by: auth.user.id })
      : table.update(input).eq('id', input.id);
    const { data, error } = await query.select('*').single();
    if (error) return json(res, 500, { ok: false, error: 'CONTENT_SAVE_FAILED' });
    return json(res, req.method === 'POST' ? 201 : 200, { ok: true, template: formatTemplate(data) });
  }

  if (req.method === 'DELETE') {
    if (!input.id) return json(res, 400, { ok: false, error: 'INVALID_CONTENT_ID' });
    const { error } = await table.delete().eq('id', input.id);
    if (error) return json(res, 500, { ok: false, error: 'CONTENT_DELETE_FAILED' });
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
}
