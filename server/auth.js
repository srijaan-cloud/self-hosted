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
async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, saltBytes);
  return { hash, salt: bytesToHex(saltBytes) };
}
async function checkPasswordHash(password, hash, salt) {
  const check = await deriveHash(password, hexToBytes(salt));
  return timingSafeEqualHex(check, hash);
}

// Exactly one admin account for this site. hasAnyAdmin() gates the bootstrap
// endpoint so it can only ever create that one account, not seed a default
// password or allow creating extras via the API.
export async function hasAnyAdmin(env) {
  const db = getDb(env);
  const row = await db.prepare('SELECT COUNT(*) as c FROM admins').get();
  return row.c > 0;
}

export async function createAdmin(env, { username, password }) {
  const { hash, salt } = await hashPassword(password);
  const db = getDb(env);
  const res = await db
    .prepare('INSERT INTO admins (username, password_hash, salt) VALUES (?, ?, ?)')
    .run(username.trim().toLowerCase(), hash, salt);
  return res.lastInsertRowid;
}

export async function verifyLogin(env, username, password) {
  const db = getDb(env);
  const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').get(username.trim().toLowerCase());
  if (!admin) return null;
  const ok = await checkPasswordHash(password, admin.password_hash, admin.salt);
  if (!ok) return null;
  await db.prepare('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);
  return admin;
}
