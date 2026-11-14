import adminCreditsAdjust from './_lib/handlers/admin-credits-adjust.js';
import adminMetrics from './_lib/handlers/admin-metrics.js';
import adminUsers from './_lib/handlers/admin-users.js';
import authWatchaCallback from './_lib/handlers/auth-watcha-callback.js';
import authWatchaStart from './_lib/handlers/auth-watcha-start.js';
import billingCheckout from './_lib/handlers/billing-checkout.js';
import billingHistory from './_lib/handlers/billing-history.js';
import billingPlans from './_lib/handlers/billing-plans.js';
import billingPortal from './_lib/handlers/billing-portal.js';
import billingWebhook from './_lib/handlers/billing-webhook.js';
import favorites from './_lib/handlers/favorites.js';
import generateImage from './_lib/handlers/generate-image.js';
import me from './_lib/handlers/me.js';

export const config = {
  api: {
    bodyParser: false
  }
};

const handlers = {
  'admin/credits/adjust': adminCreditsAdjust,
  'admin/metrics': adminMetrics,
  'admin/users': adminUsers,
  'auth/watcha/callback': authWatchaCallback,
  'auth/watcha/start': authWatchaStart,
  'billing/checkout': billingCheckout,
  'billing/history': billingHistory,
  'billing/plans': billingPlans,
  'billing/portal': billingPortal,
  'billing/webhook': billingWebhook,
  favorites,
  'generate-image': generateImage,
  me
};

function getRoute(req) {
  const routeParam = req.query?.route;
  if (Array.isArray(routeParam)) return routeParam.join('/');
  if (typeof routeParam === 'string') return routeParam;

  const pathname = String(req.url || '').split('?')[0];
  return pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
}

export default async function handler(req, res) {
  const route = getRoute(req);
  const routeHandler = handlers[route];

  if (!routeHandler) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  }

  return routeHandler(req, res);
}
