async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showError(message) {
  const el = document.getElementById('login-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

async function boot() {
  const pending = await api('/api/auth/pending-verification');
  if (pending.email) {
    document.getElementById('primary-login').classList.add('hidden');
    document.getElementById('more-options').classList.add('hidden');
    document.getElementById('verify-form').classList.remove('hidden');
    document.getElementById('verify-email').textContent = pending.email;
    return;
  }

  const status = await api('/api/auth/status');
  document.getElementById('setup-form').classList.toggle('hidden', status.passwordSet);
  document.getElementById('login-form').classList.toggle('hidden', !status.passwordSet);
  document.getElementById('touchid-btn').classList.toggle('hidden', !status.hasCredentials);

  // No password has ever been set — this is the very first visit to the whole app.
  // Surface setup directly instead of hiding it behind "More sign-in options".
  if (!status.passwordSet) {
    document.getElementById('more-options').classList.remove('hidden');
    document.getElementById('more-options-link').classList.add('hidden');
  }
}

document.getElementById('more-options-link').addEventListener('click', () => {
  document.getElementById('more-options').classList.toggle('hidden');
});

document.getElementById('verify-submit').addEventListener('click', async () => {
  const code = document.getElementById('verify-code').value.trim();
  document.getElementById('login-error').classList.add('hidden');
  try {
    await api('/api/auth/verify-first-login', { method: 'POST', body: JSON.stringify({ code }) });
    window.location.href = '/';
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById('verify-resend').addEventListener('click', async () => {
  document.getElementById('login-error').classList.add('hidden');
  try {
    await api('/api/auth/pending-verification/resend', { method: 'POST' });
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById('setup-submit').addEventListener('click', async () => {
  const pw = document.getElementById('setup-password').value;
  const pw2 = document.getElementById('setup-password-confirm').value;
  if (pw !== pw2) return showError('Passwords do not match');
  if (!pw || pw.length < 4) return showError('Password must be at least 4 characters');
  try {
    await api('/api/auth/setup', { method: 'POST', body: JSON.stringify({ password: pw }) });
    window.location.href = '/';
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById('login-submit').addEventListener('click', async () => {
  const password = document.getElementById('login-password').value;
  try {
    await api('/api/auth/login-password', { method: 'POST', body: JSON.stringify({ password }) });
    window.location.href = '/';
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById('otp-request-btn').addEventListener('click', async () => {
  const email = document.getElementById('otp-email').value.trim();
  const btn = document.getElementById('otp-request-btn');
  document.getElementById('login-error').classList.add('hidden');
  btn.disabled = true;
  try {
    await api('/api/auth/otp/request', { method: 'POST', body: JSON.stringify({ email }) });
    document.getElementById('otp-code-row').classList.remove('hidden');
    document.getElementById('otp-verify-btn').classList.remove('hidden');
    document.getElementById('otp-email').disabled = true;
    btn.textContent = 'Resend Code';
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('otp-verify-btn').addEventListener('click', async () => {
  const email = document.getElementById('otp-email').value.trim();
  const code = document.getElementById('otp-code').value.trim();
  document.getElementById('login-error').classList.add('hidden');
  try {
    await api('/api/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
    window.location.href = '/';
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById('touchid-btn').addEventListener('click', async () => {
  try {
    const optionsJSON = await api('/api/auth/webauthn/login-options');
    const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
    await api('/api/auth/webauthn/login-verify', { method: 'POST', body: JSON.stringify({ response }) });
    window.location.href = '/';
  } catch (e) {
    showError('Touch ID sign-in failed: ' + e.message);
  }
});

document.getElementById('forgot-password-link').addEventListener('click', () => {
  document.getElementById('password-reset-form').classList.toggle('hidden');
});

document.getElementById('reset-send-btn').addEventListener('click', async () => {
  const email = document.getElementById('reset-email').value.trim();
  const btn = document.getElementById('reset-send-btn');
  document.getElementById('login-error').classList.add('hidden');
  btn.disabled = true;
  try {
    await api('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) });
    document.getElementById('reset-fields').classList.remove('hidden');
    btn.textContent = 'Resend Code';
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('reset-submit-btn').addEventListener('click', async () => {
  const email = document.getElementById('reset-email').value.trim();
  const code = document.getElementById('reset-code').value.trim();
  const newPassword = document.getElementById('reset-new-password').value;
  document.getElementById('login-error').classList.add('hidden');
  try {
    await api('/api/auth/password-reset/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, newPassword }),
    });
    window.location.href = '/';
  } catch (e) {
    showError(e.message);
  }
});

boot();
