import * as client from 'openid-client';
import { requestOtp } from './auth.js';

// Google sign-in with role-gated admin access. ADMIN_EMAIL is the
// unconditional, un-demotable bootstrap admin (so the site can never lock
// itself out); beyond that, the `users.role` column (assignable from
// /admin.html → Users) decides who else gets in. Either way, having the
// 'admin' role isn't enough on its own — it only triggers an OTP emailed to
// that same address; actual admin access is granted by
// server/index.js's /api/auth/verify-otp, once that code comes back correct.

function redirectUri(c) {
  const base = c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin;
  return `${base}/auth/google/callback`;
}

function googleConfigured(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.ADMIN_EMAIL);
}

let googleConfigPromise = null;
function getGoogleConfig(env) {
  if (!googleConfigPromise) {
    googleConfigPromise = client.discovery(new URL('https://accounts.google.com'), env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  }
  return googleConfigPromise;
}

// Mirrors the `google_login_enabled` flag in site_content (server/index.js) —
// duplicated here as a direct query rather than importing getSiteContent, to
// avoid a circular import between index.js and this module.
async function googleLoginEnabled(env) {
  const row = await env.DB.prepare('SELECT data FROM site_content WHERE id = 1').first();
  if (!row) return false;
  try {
    return !!JSON.parse(row.data).google_login_enabled;
  } catch {
    return false;
  }
}

export async function googleAuthStart(c) {
  if (!googleConfigured(c.env)) {
    return c.text('Google login is not configured yet.', 503);
  }
  if (!(await googleLoginEnabled(c.env))) {
    return c.redirect('/login.html?error=disabled');
  }
  try {
    const config = await getGoogleConfig(c.env);
    const code_verifier = client.randomPKCECodeVerifier();
    const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
    const state = client.randomState();
    c.get('session').googleOAuth = { code_verifier, state };

    const redirectTo = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri(c),
      scope: 'openid email profile',
      code_challenge,
      code_challenge_method: 'S256',
      state,
      prompt: 'select_account',
    });
    return c.redirect(redirectTo.href);
  } catch (err) {
    return c.text('Could not start Google sign-in: ' + err.message, 500);
  }
}

export async function googleAuthCallback(c) {
  const saved = c.get('session').googleOAuth;
  c.get('session').googleOAuth = null;
  if (!saved) return c.redirect('/login.html?error=expired');
  try {
    const config = await getGoogleConfig(c.env);
    const currentUrl = new URL(c.req.url);
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: saved.code_verifier,
      expectedState: saved.state,
    });
    const claims = tokens.claims();
    const email = String(claims.email || '').trim().toLowerCase();
    const adminEmail = String(c.env.ADMIN_EMAIL || '').trim().toLowerCase();

    if (claims.email_verified === false || !email) {
      return c.redirect('/');
    }

    // Recognize anyone who successfully signs in with Google (so the header
    // can show "Logged in as ...") independently of whether they get admin
    // access — that's a separate, higher bar gated by the OTP step below.
    const session = c.get('session');
    const name = claims.name || email;
    session.name = name;
    session.email = email;

    // A brand-new row seeds its role from ADMIN_EMAIL; an existing row's role
    // (possibly since promoted/demoted from /admin.html → Users) is left
    // alone by ON CONFLICT — this upsert only ever touches name/last_login.
    const initialRole = email === adminEmail ? 'admin' : 'viewer';
    await c.env.DB.prepare(
      `INSERT INTO users (email, name, role, first_login_at, last_login_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(email) DO UPDATE SET name = excluded.name, last_login_at = CURRENT_TIMESTAMP`
    ).bind(email, name, initialRole).run();

    const userRow = await c.env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(email).first();
    const hasAdminRole = email === adminEmail || (userRow && userRow.role === 'admin');

    // Anyone can already see everything on this site without an account, so
    // a non-admin Google sign-in isn't an error — just send them back to the
    // normal public page rather than accusing them of doing something wrong.
    if (!hasAdminRole) {
      return c.redirect('/');
    }

    session.pendingAdminEmail = email;
    try {
      await requestOtp(c.env, email);
    } catch (err) {
      return c.redirect('/login.html?error=failed');
    }
    return c.redirect('/login.html?step=verify');
  } catch (err) {
    return c.redirect('/login.html?error=failed');
  }
}
