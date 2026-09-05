import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

// A merely-recognized (non-admin) session can stick around for a while — it
// grants no access to anything. An admin session is deliberately much
// shorter (a sliding 30-minute idle timeout, refreshed on every authenticated
// request) so admin access is never silently relied on indefinitely — 30
// minutes of no activity against /admin.html and its APIs, and it's gone.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const ADMIN_TTL_SECONDS = 30 * 60; // 30 minutes
const COOKIE_NAME = 'sid';

// KV-backed session, same pattern as tapasyaConstructions/server/session.js.
export async function sessionMiddleware(c, next) {
  const sid = getCookie(c, COOKIE_NAME);
  let session = {};
  if (sid) {
    const raw = await c.env.KV.get(`session:${sid}`);
    if (raw) session = JSON.parse(raw);
  }
  c.set('session', session);
  c.set('sessionId', sid || null);

  await next();

  const finalSession = c.get('session');
  const finalSid = c.get('sessionId');

  if (finalSession.destroyed) {
    if (finalSid) await c.env.KV.delete(`session:${finalSid}`);
    deleteCookie(c, COOKIE_NAME, { path: '/' });
    return;
  }

  // Nothing worth persisting — skip writing an empty row to KV for every
  // anonymous visitor. Bug fixed here: this used to check `isAdmin`
  // specifically, which silently dropped the mid-OAuth `googleOAuth` state
  // (set on a brand-new, cookie-less visitor by googleAuthStart) since
  // isAdmin isn't true yet at that point — no cookie ever got set, so the
  // callback always saw no session and failed with "expired".
  if (!finalSid && Object.keys(finalSession).length === 0) return;

  const ttlSeconds = finalSession.isAdmin ? ADMIN_TTL_SECONDS : DEFAULT_TTL_SECONDS;
  const id = finalSid || crypto.randomUUID();
  await c.env.KV.put(`session:${id}`, JSON.stringify(finalSession), {
    expirationTtl: ttlSeconds,
  });
  setCookie(c, COOKIE_NAME, id, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: ttlSeconds,
  });
}

export function destroySession(c) {
  c.get('session').destroyed = true;
}
