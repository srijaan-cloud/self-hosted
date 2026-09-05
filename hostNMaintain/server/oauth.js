import * as client from 'openid-client';

// Single-admin Google sign-in: unlike the sibling apps (which manage a table
// of staff users and a first-login OTP-verification step), there is exactly
// one person allowed in here, and their email is a fixed config value
// (ADMIN_EMAIL) — so a successful Google sign-in either matches that email
// or it's rejected outright. No user table, no OTP step needed.

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

    // Anyone can already see everything on this site without an account, so
    // a non-admin Google sign-in isn't an error — just send them back to the
    // normal public page rather than accusing them of doing something wrong.
    if (claims.email_verified === false || !email || email !== adminEmail) {
      return c.redirect('/');
    }

    const session = c.get('session');
    session.isAdmin = true;
    session.email = email;
    return c.redirect('/admin.html');
  } catch (err) {
    return c.redirect('/login.html?error=failed');
  }
}
