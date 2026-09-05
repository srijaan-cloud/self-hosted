// Email OTP as a second factor after Google sign-in confirms the account is
// ADMIN_EMAIL — matching a Google account alone isn't enough to grant admin
// access; the signer also has to prove they can read that inbox right now.
// Same code/storage pattern as tapasyaConstructions/server/auth.js's OTP
// functions, trimmed down (no user table — there's only one admin here).

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
  if (!env.RESEND_API_KEY) throw new Error('Email verification is not configured yet');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [email],
      subject: `Your admin sign-in code: ${code}`,
      html: `<p>Your HostNMaintain admin sign-in code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px;">${code}</p><p>This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Could not send the sign-in code (status ${res.status})`);
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
