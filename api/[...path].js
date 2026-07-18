import favorites from '../server/api/favorites.js';
import generateImage from '../server/api/generate-image.js';
import me from '../server/api/me.js';
import reversePrompt from '../server/api/reverse-prompt.js';
import skillGithub from '../server/api/skill/github.js';
import authWatchaStart from '../server/api/auth/watcha/start.js';
import authWatchaCallback from '../server/api/auth/watcha/callback.js';
import billingCheckout from '../server/api/billing/checkout.js';
import billingHistory from '../server/api/billing/history.js';
import billingPlans from '../server/api/billing/plans.js';
import billingPortal from '../server/api/billing/portal.js';
import billingWebhook from '../server/api/billing/webhook.js';
import contentCases from '../server/api/content/cases.js';
import contentTemplates from '../server/api/content/templates.js';
import siteHomepage from '../server/api/site/homepage.js';
import adminCreditsAdjust from '../server/api/admin/credits/adjust.js';
import adminImageProvider from '../server/api/admin/image-provider.js';
import adminMetrics from '../server/api/admin/metrics.js';
import adminUsers from '../server/api/admin/users.js';
import adminContentCases from '../server/api/admin/content/cases.js';
import adminContentTemplates from '../server/api/admin/content/templates.js';
import adminContentUploadUrl from '../server/api/admin/content/upload-url.js';
import adminSiteHomepage from '../server/api/admin/site/homepage.js';

// Keep request bodies untouched so Stripe webhook signatures can be verified.
export const config = {
  api: {
    bodyParser: false
  }
};

const handlers = {
  favorites,
  'generate-image': generateImage,
  me,
  'reverse-prompt': reversePrompt,
  'skill/github': skillGithub,
  'auth/watcha/start': authWatchaStart,
  'auth/watcha/callback': authWatchaCallback,
  'billing/checkout': billingCheckout,
  'billing/history': billingHistory,
  'billing/plans': billingPlans,
  'billing/portal': billingPortal,
  'billing/webhook': billingWebhook,
  'content/cases': contentCases,
  'content/templates': contentTemplates,
  'site/homepage': siteHomepage,
  'admin/credits/adjust': adminCreditsAdjust,
  'admin/image-provider': adminImageProvider,
  'admin/metrics': adminMetrics,
  'admin/users': adminUsers,
  'admin/content/cases': adminContentCases,
  'admin/content/templates': adminContentTemplates,
  'admin/content/upload-url': adminContentUploadUrl,
  'admin/site/homepage': adminSiteHomepage
};

function getRoute(req) {
  const url = new URL(req.url || '/', 'http://visual-atlas.local');
  const pathname = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  // Vercel normally supplies req.query. The fallback keeps local adapters and
  // direct tests compatible with the same dispatcher.
  if (!req.query || typeof req.query !== 'object') {
    req.query = Object.fromEntries(url.searchParams.entries());
  }

  return pathname;
}

function json(res, status, payload) {
  return res.status(status).json(payload);
}

export default async function handler(req, res) {
  const route = getRoute(req);
  const target = handlers[route];

  if (!target) {
    return json(res, 404, {
      ok: false,
      error: 'API_ROUTE_NOT_FOUND'
    });
  }

  return target(req, res);
}
