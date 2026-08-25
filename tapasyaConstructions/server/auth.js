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

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, saltBytes);
  return { hash, salt: bytesToHex(saltBytes) };
}

async function checkPassword(password, hash, salt) {
  const check = await deriveHash(password, hexToBytes(salt));
  return timingSafeEqualHex(check, hash);
}

// ---------- Staff accounts ----------
// role: 'director' (all projects, full access) | 'accountant' (all projects,
// payments/accounting focus) | 'site_engineer' (only assigned projects — see
// project_assignments).

export async function createStaffUser(env, { name, username, password, role }) {
  const { hash, salt } = await hashPassword(password);
  const db = getDb(env);
  const res = await db
    .prepare('INSERT INTO staff_users (name, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)')
    .run(name, username.trim().toLowerCase(), hash, salt, role || 'site_engineer');
  return res.lastInsertRowid;
}

export async function verifyLogin(env, username, password) {
  const db = getDb(env);
  const user = await db
    .prepare('SELECT * FROM staff_users WHERE username = ?')
    .get(username.trim().toLowerCase());
  if (!user) return null;
  const ok = await checkPassword(password, user.password_hash, user.salt);
  if (!ok) return null;
  return user;
}

export async function hasAnyStaffUser(env) {
  const db = getDb(env);
  const row = await db.prepare('SELECT COUNT(*) as c FROM staff_users').get();
  return row.c > 0;
}

export async function listStaffUsers(env) {
  const db = getDb(env);
  return db.prepare('SELECT id, name, username, role, created_at FROM staff_users ORDER BY name').all();
}

export async function assignProject(env, staffUserId, projectId) {
  const db = getDb(env);
  await db
    .prepare('INSERT OR IGNORE INTO project_assignments (project_id, staff_user_id) VALUES (?, ?)')
    .run(projectId, staffUserId);
}

export async function unassignProject(env, staffUserId, projectId) {
  const db = getDb(env);
  await db
    .prepare('DELETE FROM project_assignments WHERE project_id = ? AND staff_user_id = ?')
    .run(projectId, staffUserId);
}

export async function assignedProjectIds(env, staffUserId) {
  const db = getDb(env);
  const rows = await db
    .prepare('SELECT project_id FROM project_assignments WHERE staff_user_id = ?')
    .all(staffUserId);
  return rows.map((r) => r.project_id);
}
