import * as client from 'openid-client';
import { recordLogin, isKnownUser, requestOtp } from './auth.js';

function redirectUri(c, provider) {
  const base = c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin;
  return `${base}/auth/${provider}/callback`;
}

// Called once an OAuth provider hands us a real email: returning users go straight
// in; the first time we ever see an email, we don't trust the provider's word alone
// — a code is sent to it and access is only granted once that code comes back,
// via /api/auth/verify-first-login.
async function loginWithVerifiedEmail(c, email) {
  const normalizedEmail = email.trim().toLowerCase();
  const session = c.get('session');
  if (await isKnownUser(c.env, normalizedEmail)) {
    session.loggedIn = true;
    session.userEmail = normalizedEmail;
    session.role = await recordLogin(c.env, normalizedEmail);
    return c.redirect('/');
  }
  session.pendingEmail = normalizedEmail;
  await requestOtp(c.env, normalizedEmail);
  return c.redirect('/login.html');
}

// ---------- Google (OIDC, Authorization Code + PKCE) ----------

let googleConfigPromise = null;

function googleConfigured(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function getGoogleConfig(env) {
  if (!googleConfigPromise) {
    googleConfigPromise = client.discovery(
      new URL('https://accounts.google.com'),
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET
    );
  }
  return googleConfigPromise;
}

export async function googleAuthStart(c) {
  if (!googleConfigured(c.env)) {
    return c.text('Google login is not configured yet.', 503);
  }
  try {
    const config = await getGoogleConfig(c.env);
    const code_verifier = client.randomPKCECodeVerifier();
    const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);
    const state = client.randomState();
    c.get('session').googleOAuth = { code_verifier, state };

    const redirectTo = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri(c, 'google'),
      scope: 'openid email profile',
      code_challenge,
      code_challenge_method: 'S256',
      state,
      // Without this, Google silently reuses whichever Google account is already
      // active in the browser instead of letting the user pick — makes it look like
      // sign-in is "stuck" on one email when testing multiple accounts.
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
  if (!saved) return c.text('Sign-in session expired, please try again.', 400);
  try {
    const config = await getGoogleConfig(c.env);
    const currentUrl = new URL(c.req.url);
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: saved.code_verifier,
      expectedState: saved.state,
    });
    const claims = tokens.claims();
    return await loginWithVerifiedEmail(c, claims.email);
  } catch (err) {
    return c.text('Google sign-in failed: ' + err.message, 400);
  }
}
