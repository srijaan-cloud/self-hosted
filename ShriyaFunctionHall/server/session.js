import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const COOKIE_NAME = 'sid';

// KV-backed session, keyed by a random id in an httpOnly cookie. Route
// handlers read/write c.get('session') directly; this middleware loads it
// before the handler runs and persists it after.
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
