import * as client from 'openid-client';
import { isKnownUser, recordEmailLogin, requestOtp } from './auth.js';

function redirectUri(c) {
  const base = c.env.PUBLIC_BASE_URL || new URL(c.req.url).origin;
  return `${base}/auth/google/callback`;
}

let googleConfigPromise = null;
function googleConfigured(env) {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
function getGoogleConfig(env) {
  if (!googleConfigPromise) {
    googleConfigPromise = client.discovery(new URL('https://accounts.google.com'), env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
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
      redirect_uri: redirectUri(c),
      scope: 'openid email profile',
      code_challenge,
      code_challenge_method: 'S256',
      state,
      // Otherwise Google silently reuses whichever account is already active in
      // the browser instead of letting the user pick.
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
    const email = claims.email;
    const name = claims.name || email;
    const normalizedEmail = email.trim().toLowerCase();
    const session = c.get('session');

    // Returning user: straight in. First time we've ever seen this email: don't
    // trust Google's claim alone — send a code to it and only grant access once
    // that comes back (see /api/auth/verify-first-login).
    if (await isKnownUser(c.env, normalizedEmail)) {
      const user = await recordEmailLogin(c.env, normalizedEmail, name);
      session.loggedIn = true;
      session.userId = user.id;
      session.email = user.email;
      session.name = user.name;
      session.role = user.role;
      session.all_projects_access = !!user.all_projects_access;
      return c.redirect('/');
    }
    session.pendingEmail = normalizedEmail;
    session.pendingName = name;
    await requestOtp(c.env, normalizedEmail);
    return c.redirect('/login.html');
  } catch (err) {
    return c.text('Google sign-in failed: ' + err.message, 400);
  }
}
