import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const COOKIE_NAME = 'sid';

// KV-backed session, same pattern as tapasyaConstructions/server/session.js.
// This site only ever has one kind of session (an admin who signed in with
// Google — see server/oauth.js), so the stored shape is just { isAdmin, email }.
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
  // anonymous visitor.
  if (!finalSession.isAdmin && !finalSid) return;

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
