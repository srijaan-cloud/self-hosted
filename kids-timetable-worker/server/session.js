import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches the old express-session maxAge
const COOKIE_NAME = 'sid';

// KV-backed replacement for express-session. Every field that used to live on
// req.session (loggedIn, role, userEmail, oauth state/PKCE verifier, WebAuthn
// challenges) lives on this same session object — one KV entry per
// visitor, keyed by a random id in an httpOnly cookie. Route handlers read/write
// c.get('session') exactly like req.session before; this middleware loads it
// before the handler runs and persists it after, so no explicit save() is needed.
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

  const id = finalSid || crypto.randomUUID();
  await c.env.KV.put(`session:${id}`, JSON.stringify(finalSession), {
    expirationTtl: TTL_SECONDS,
  });
  setCookie(c, COOKIE_NAME, id, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: TTL_SECONDS,
  });
}

export function destroySession(c) {
  c.get('session').destroyed = true;
}
