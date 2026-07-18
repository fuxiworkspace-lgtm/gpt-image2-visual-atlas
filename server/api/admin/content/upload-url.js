import crypto from 'node:crypto';
import { readJsonBody } from '../../_lib/billing.js';
import { json, requireSuperAdmin } from '../../_lib/content.js';

const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const auth = await requireSuperAdmin(req, res);
  if (!auth) return;
  let body;
  try { body = await readJsonBody(req); } catch { return json(res, 400, { ok: false, error: 'INVALID_UPLOAD' }); }
  const contentType = String(body.contentType || '').toLowerCase();
  if (!allowed.has(contentType)) return json(res, 400, { ok: false, error: 'UNSUPPORTED_IMAGE_TYPE' });
  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  const scope = body.scope === 'homepage' ? 'homepage' : 'cases';
  const path = `${scope}/${auth.user.id}/${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${ext}`;
  const { data, error } = await auth.client.storage.from('content-assets').createSignedUploadUrl(path);
  if (error || !data?.token) return json(res, 500, { ok: false, error: 'UPLOAD_URL_FAILED' });
  const { data: publicData } = auth.client.storage.from('content-assets').getPublicUrl(path);
  return json(res, 200, { ok: true, path, token: data.token, publicUrl: publicData.publicUrl });
}
