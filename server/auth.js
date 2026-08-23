import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { getDb } from './db.js';

const RP_NAME = 'Kids Timetable';
// Cloudflare Workers' Web Crypto implementation caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100000;
const AUTH_CONFIG_KEY = 'config:auth';

export function getRpId(env, c) {
  return env.RP_ID || new URL(c.req.url).hostname;
}

export function getOrigin(c) {
  return new URL(c.req.url).origin;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function deriveHash(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, saltBytes);
  return { hash, salt: bytesToHex(saltBytes) };
}

async function getAuthConfig(env) {
  const raw = await env.KV.get(AUTH_CONFIG_KEY);
  return raw ? JSON.parse(raw) : { passwordHash: null, salt: null };
}

async function saveAuthConfig(env, config) {
  await env.KV.put(AUTH_CONFIG_KEY, JSON.stringify(config));
}

export async function isPasswordSet(env) {
  const config = await getAuthConfig(env);
  return !!config.passwordHash;
}

export async function setPassword(env, password) {
  const { hash, salt } = await hashPassword(password);
  const config = await getAuthConfig(env);
  await saveAuthConfig(env, { ...config, passwordHash: hash, salt });
}

export async function checkPassword(env, password) {
  const config = await getAuthConfig(env);
  if (!config.passwordHash) return false;
  const check = await deriveHash(password, hexToBytes(config.salt));
  return timingSafeEqualHex(check, config.passwordHash);
}

// ---------- Roles ----------
// Everyone who reaches the site-wide login can view the tracker; admins can save
// changes. Password/Touch ID logins have no identity of their own, so those always
// resolve to admin. Email-identified logins (Google/OTP) are governed by
// the `users` table, which any existing admin can edit from Settings — except
// ADMIN_EMAIL itself, which is a permanent admin (a safety net against ever locking
// everyone out) and isn't stored as a row that could be edited away.

function seedAdminEmail(env) {
  return (env.ADMIN_EMAIL || '').trim().toLowerCase();
}

// Has this email ever completed a login before? Used to gate the first-login email
// verification step — read-only, doesn't create the row (recordLogin does that).
export async function isKnownUser(env, email) {
  const normalized = email.trim().toLowerCase();
  const db = getDb(env);
  const row = await db.prepare('SELECT email FROM users WHERE email = ?').get(normalized);
  return !!row;
}

export async function getUserRole(env, email) {
  const normalized = email.trim().toLowerCase();
  if (normalized === seedAdminEmail(env)) return 'admin';
  const db = getDb(env);
  const row = await db.prepare('SELECT role FROM users WHERE email = ?').get(normalized);
  return row?.role === 'admin' ? 'admin' : 'viewer';
}

// Called on every email-identified login: upserts the user's row (so they show up
// in the admin's Users list) and returns their current role.
export async function recordLogin(env, email) {
  const normalized = email.trim().toLowerCase();
  const role = await getUserRole(env, normalized);
  const db = getDb(env);
  const existing = await db.prepare('SELECT email FROM users WHERE email = ?').get(normalized);
  if (existing) {
    await db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE email = ?').run(normalized);
  } else {
    await db
      .prepare('INSERT INTO users (email, role) VALUES (?, ?)')
      .run(normalized, role === 'admin' ? 'admin' : 'viewer');
  }
  return role;
}

export async function listUsers(env) {
  const db = getDb(env);
  const rows = await db
    .prepare('SELECT email, role, first_login, last_login FROM users ORDER BY last_login DESC')
    .all();
  return { users: rows, seedAdminEmail: seedAdminEmail(env) };
}

export async function setUserRole(env, email, role) {
  const normalized = email.trim().toLowerCase();
  if (normalized === seedAdminEmail(env)) {
    throw new Error("Can't change the primary admin's role");
  }
  const db = getDb(env);
  const existing = await db.prepare('SELECT email FROM users WHERE email = ?').get(normalized);
  if (!existing) throw new Error('No such user — they need to sign in at least once first');
  await db.prepare('UPDATE users SET role = ? WHERE email = ?').run(role, normalized);
}

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// TEMPORARY fallback for saving, while Touch ID registration is broken on some
// Android/Chrome + Google Password Manager combinations. Deliberately hardcoded
// (not hashed/stored, not configurable) per explicit instruction — this is a weak,
// guessable bypass of the admin-only write model, not a real secret. Server-side
// only; never sent to the browser. Replace with a properly stored code (or drop
// entirely) once Touch ID works reliably on mobile.
const ADMIN_CODE = 'qwerty';

export function checkAdminCode(code) {
  return code === ADMIN_CODE;
}

// ---------- Email OTP login ----------

const OTP_KEY_PREFIX = 'otp:';
const OTP_TTL_SECONDS = 10 * 60;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function generateOtpCode() {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(100000 + (bytes[0] % 900000));
}

export async function requestOtp(env, email) {
  const key = OTP_KEY_PREFIX + email;
  const existingRaw = await env.KV.get(key);
  if (existingRaw) {
    const existing = JSON.parse(existingRaw);
    if (Date.now() - existing.createdAt < OTP_RESEND_COOLDOWN_MS) {
      throw new Error('Please wait a bit before requesting another code');
    }
  }
  const code = generateOtpCode();
  await env.KV.put(key, JSON.stringify({ code, createdAt: Date.now(), attempts: 0 }), {
    expirationTtl: OTP_TTL_SECONDS,
  });
  await sendOtpEmail(env, email, code);
}

export async function verifyOtp(env, email, code) {
  const key = OTP_KEY_PREFIX + email;
  const raw = await env.KV.get(key);
  if (!raw) return false;
  const stored = JSON.parse(raw);
  if (stored.attempts >= OTP_MAX_ATTEMPTS) {
    await env.KV.delete(key);
    return false;
  }
  if (stored.code !== code) {
    stored.attempts += 1;
    await env.KV.put(key, JSON.stringify(stored), { expirationTtl: OTP_TTL_SECONDS });
    return false;
  }
  await env.KV.delete(key);
  return true;
}

async function sendOtpEmail(env, email, code) {
  if (!env.RESEND_API_KEY) throw new Error('Email sign-in is not configured yet');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL || 'Kids Timetable <onboarding@resend.dev>',
      to: [email],
      subject: `Your sign-in code: ${code}`,
      html: `<p>Your Kids Timetable sign-in code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Could not send sign-in email (status ${res.status})`);
  }
}

// ---------- WebAuthn (Touch ID), credentials stored in D1 ----------

export async function listCredentials(env) {
  const db = getDb(env);
  return db.prepare('SELECT id, device_name, created_at FROM credentials ORDER BY created_at').all();
}

export async function hasCredentials(env) {
  const db = getDb(env);
  const row = await db.prepare('SELECT COUNT(*) as c FROM credentials').get();
  return row.c > 0;
}

export async function deleteCredential(env, id) {
  const db = getDb(env);
  await db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
}

export async function getRegistrationOptions(env, rpId) {
  const db = getDb(env);
  const existing = await db.prepare('SELECT id, transports FROM credentials').all();
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId,
    userName: 'parent',
    userDisplayName: 'Parent',
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
    authenticatorSelection: {
      // Android's platform authenticator (Chrome + Google Password Manager /
      // Credential Manager) doesn't really support non-discoverable credentials —
      // it only manages real (resident) passkeys. "discouraged" here caused
      // Android's Credential Manager to misfire into its *authentication*-flow
      // dialog ("No passkeys available... Use a different device") instead of
      // creating one. "required" commits to a real discoverable passkey, which is
      // what Android's platform authenticator actually needs; iOS/desktop support
      // this fine too.
      residentKey: 'required',
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
  });
}

export async function verifyRegistration(env, response, expectedChallenge, origin, rpId, deviceName) {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
  });
  if (verification.verified && verification.registrationInfo) {
    const { credential } = verification.registrationInfo;
    const db = getDb(env);
    await db
      .prepare(
        'INSERT INTO credentials (id, public_key, counter, device_name, transports) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        credential.id,
        bytesToHex(credential.publicKey),
        credential.counter,
        deviceName || 'This device',
        JSON.stringify(credential.transports || [])
      );
  }
  return verification;
}

export async function getAuthenticationOptions(env, rpId) {
  const db = getDb(env);
  const creds = await db.prepare('SELECT id, transports FROM credentials').all();
  return generateAuthenticationOptions({
    rpID: rpId,
    userVerification: 'required',
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: c.transports ? JSON.parse(c.transports) : undefined,
    })),
  });
}

export async function verifyAuthentication(env, response, expectedChallenge, origin, rpId) {
  const db = getDb(env);
  const cred = await db.prepare('SELECT * FROM credentials WHERE id = ?').get(response.id);
  if (!cred) throw new Error('Unknown credential');
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpId,
    credential: {
      id: cred.id,
      publicKey: hexToBytes(cred.public_key),
      counter: cred.counter,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    },
  });
  if (verification.verified) {
    await db
      .prepare('UPDATE credentials SET counter = ? WHERE id = ?')
      .run(verification.authenticationInfo.newCounter, cred.id);
  }
  return verification;
}
