import { getAuthContext } from './supabase.js';

export function json(res, status, payload) {
  res.status(status).json(payload);
}

export async function requireSuperAdmin(req, res) {
  const auth = await getAuthContext(req);
  if (auth.error) {
    json(res, auth.status || 401, { ok: false, error: auth.error });
    return null;
  }
  if (!auth.profile?.isSuperAdmin) {
    json(res, 403, { ok: false, error: 'FORBIDDEN' });
    return null;
  }
  return auth;
}

function arrayValue(value, max = 8) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return values.map((item) => String(item).trim()).filter(Boolean).slice(0, max);
}

export function normalizeCaseInput(body = {}) {
  return {
    title: String(body.title || '').trim().slice(0, 180),
    image_url: String(body.imageUrl || body.image_url || '').trim().slice(0, 2000),
    image_alt: String(body.imageAlt || body.image_alt || body.title || '').trim().slice(0, 240),
    prompt: String(body.prompt || '').trim().slice(0, 6000),
    source_label: String(body.sourceLabel || body.source_label || 'Visual Atlas').trim().slice(0, 120),
    source_url: String(body.sourceUrl || body.source_url || '').trim().slice(0, 1000),
    category: String(body.category || 'Other Use Cases').trim().slice(0, 100),
    styles: arrayValue(body.styles),
    scenes: arrayValue(body.scenes),
    featured: Boolean(body.featured),
    published: body.published !== false,
    sort_order: Number.isInteger(Number(body.sortOrder || body.sort_order)) ? Number(body.sortOrder || body.sort_order) : 0
  };
}

export function normalizeTemplateInput(body = {}) {
  const id = String(body.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 80);
  return {
    id,
    title_en: String(body.titleEn || body.title_en || '').trim().slice(0, 180),
    title_zh: String(body.titleZh || body.title_zh || '').trim().slice(0, 180),
    description_en: String(body.descriptionEn || body.description_en || '').trim().slice(0, 500),
    description_zh: String(body.descriptionZh || body.description_zh || '').trim().slice(0, 500),
    prompt: String(body.prompt || '').trim().slice(0, 6000),
    category: String(body.category || 'Other Use Cases').trim().slice(0, 100),
    tags: arrayValue(body.tags, 12),
    cover_url: String(body.coverUrl || body.cover_url || '').trim().slice(0, 2000),
    published: body.published !== false,
    sort_order: Number.isInteger(Number(body.sortOrder || body.sort_order)) ? Number(body.sortOrder || body.sort_order) : 0
  };
}

export function validCaseInput(value) { return Boolean(value.title && value.image_url && value.prompt); }
export function validTemplateInput(value) { return Boolean(value.id && value.title_en && value.title_zh && value.prompt); }

function heroCaseIds(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))].slice(0, 3);
}

export function normalizeHomepageInput(body = {}) {
  return {
    hero_image_url: String(body.heroImageUrl || body.hero_image_url || '').trim().slice(0, 2000),
    hero_case_ids: heroCaseIds(body.heroCaseIds || body.hero_case_ids)
  };
}

export function formatHomepage(row = {}) {
  return {
    heroImageUrl: String(row.hero_image_url || '').trim(),
    heroCaseIds: heroCaseIds(row.hero_case_ids)
  };
}

export function formatCase(row) {
  return {
    id: Number(row.id), title: row.title, image: row.image_url, imageAlt: row.image_alt || row.title,
    sourceLabel: row.source_label || 'Visual Atlas', sourceUrl: row.source_url || '', prompt: row.prompt,
    promptPreview: row.prompt.replace(/\s+/g, ' ').slice(0, 220), category: row.category || 'Other Use Cases',
    styles: row.styles || [], scenes: row.scenes || [], featured: Boolean(row.featured), published: Boolean(row.published),
    contentSource: 'database', createdAt: row.created_at || '', updatedAt: row.updated_at || ''
  };
}

export function formatTemplate(row) {
  return {
    id: row.id,
    title: { en: row.title_en, zh: row.title_zh },
    description: { en: row.description_en, zh: row.description_zh },
    prompt: row.prompt, category: row.category, tags: row.tags || [], cover: row.cover_url || '',
    published: Boolean(row.published), contentSource: 'database'
  };
}
