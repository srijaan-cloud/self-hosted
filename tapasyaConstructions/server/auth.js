import { getDb } from './db.js';

// Cloudflare Workers' Web Crypto implementation caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100000;

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
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}
export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, saltBytes);
  return { hash, salt: bytesToHex(saltBytes) };
}
async function checkPasswordHash(password, hash, salt) {
  const check = await deriveHash(password, hexToBytes(salt));
  return timingSafeEqualHex(check, hash);
}

// ---------- Users ----------
// One table covers both admin-created username/password accounts (directors,
// and any staff without a Gmail address) and self-service Google/OTP accounts
// (identified by email, default role 'viewer'). role: director | site_supervisor
// | auditor | viewer. all_projects_access: for site_supervisor/auditor, whether
// they see/edit every project or only ones in project_assignments — director
// and viewer ignore this (always all, by role alone).

export async function createStaffUser(env, { name, username, password, role, allProjectsAccess }) {
  const { hash, salt } = await hashPassword(password);
  const db = getDb(env);
  const res = await db
    .prepare('INSERT INTO users (name, username, password_hash, salt, role, all_projects_access) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, username.trim().toLowerCase(), hash, salt, role || 'viewer', allProjectsAccess ? 1 : 0);
  return res.lastInsertRowid;
}

export async function verifyLogin(env, username, password) {
  const db = getDb(env);
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase());
  if (!user || !user.password_hash) return null;
  const ok = await checkPasswordHash(password, user.password_hash, user.salt);
  if (!ok) return null;
  await db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  return user;
}

export async function hasAnyStaffUser(env) {
  const db = getDb(env);
  const row = await db.prepare('SELECT COUNT(*) as c FROM users').get();
  return row.c > 0;
}

export async function getUser(env, id) {
  const db = getDb(env);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export async function listUsers(env) {
  const db = getDb(env);
  return db
    .prepare('SELECT id, name, username, email, role, all_projects_access, created_at, last_login FROM users ORDER BY COALESCE(last_login, created_at) DESC')
    .all();
}

export async function setUserRole(env, id, role, allProjectsAccess) {
  const db = getDb(env);
  await db
    .prepare('UPDATE users SET role = ?, all_projects_access = ? WHERE id = ?')
    .run(role, allProjectsAccess ? 1 : 0, id);
}

export async function assignProject(env, userId, projectId) {
  const db = getDb(env);
  await db.prepare('INSERT OR IGNORE INTO project_assignments (project_id, user_id) VALUES (?, ?)').run(projectId, userId);
}
export async function unassignProject(env, userId, projectId) {
  const db = getDb(env);
  await db.prepare('DELETE FROM project_assignments WHERE project_id = ? AND user_id = ?').run(projectId, userId);
}
export async function assignedProjectIds(env, userId) {
  const db = getDb(env);
  const rows = await db.prepare('SELECT project_id FROM project_assignments WHERE user_id = ?').all(userId);
  return rows.map((r) => r.project_id);
}

// ---------- Email-identified logins (Google / OTP) ----------

export async function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function isKnownUser(env, email) {
  const db = getDb(env);
  const row = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase());
  return !!row;
}

// First time we see an email, create a viewer account for it (read-only by
// default — an admin/director has to explicitly promote them). Returns the
// user row.
export async function recordEmailLogin(env, email, name) {
  const normalized = email.trim().toLowerCase();
  const db = getDb(env);
  const existing = await db.prepare('SELECT * FROM users WHERE email = ?').get(normalized);
  if (existing) {
    await db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(existing.id);
    return existing;
  }
  const res = await db
    .prepare('INSERT INTO users (name, email, role, all_projects_access, last_login) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)')
    .run(name || normalized, normalized, 'viewer');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(res.lastInsertRowid);
}

// ---------- Email OTP (used both as a login-verification step and for
// confirming a Google-provided email is really reachable, first login only) ----------

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
  await env.KV.put(key, JSON.stringify({ code, createdAt: Date.now(), attempts: 0 }), { expirationTtl: OTP_TTL_SECONDS });
  if (!env.RESEND_API_KEY) throw new Error('Email sign-in is not configured yet');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL || 'Tapasya Constructions <onboarding@resend.dev>',
      to: [email],
      subject: `Your sign-in code: ${code}`,
      html: `<p>Your Tapasya Constructions sign-in code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Could not send sign-in email (status ${res.status})`);
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

// ---------- Background image (admin-configurable, stored in KV) ----------

const BACKGROUND_KEY = 'config:background';

export async function setBackgroundImage(env, bytes, contentType) {
  // String.fromCharCode(...bytes) blows the call stack for anything beyond a few
  // tens of KB (spreads the whole array as individual arguments) — build the
  // binary string in chunks instead.
  const arr = new Uint8Array(bytes);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  const b64 = btoa(binary);
  await env.KV.put(BACKGROUND_KEY, JSON.stringify({ data: b64, contentType }));
}

export async function getBackgroundImage(env) {
  const raw = await env.KV.get(BACKGROUND_KEY);
  if (!raw) return null;
  const { data, contentType } = JSON.parse(raw);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, contentType };
}
