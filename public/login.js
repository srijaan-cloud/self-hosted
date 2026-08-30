async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function showError(message) {
  const el = document.getElementById('auth-error');
  el.textContent = message;
  el.classList.remove('hidden');
}

async function boot() {
  const pending = await api('/api/auth/pending-verification');
  if (pending.email) {
    document.getElementById('primary-login').classList.add('hidden');
    document.getElementById('verify-form').classList.remove('hidden');
    document.getElementById('verify-email').textContent = pending.email;
    return;
  }
  const status = await api('/api/auth/status');
  document.getElementById('bootstrap-form').classList.toggle('hidden', status.hasAnyStaffUser);
  document.getElementById('login-form').classList.toggle('hidden', !status.hasAnyStaffUser);
}


document.getElementById('verify-submit').addEventListener('click', async () => {
  const code = document.getElementById('verify-code').value.trim();
  document.getElementById('auth-error').classList.add('hidden');
  try {
    await api('/api/auth/verify-first-login', { method: 'POST', body: JSON.stringify({ code }) });
    window.location.href = '/';
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById('verify-resend').addEventListener('click', async () => {
  document.getElementById('auth-error').classList.add('hidden');
  try {
    await api('/api/auth/pending-verification/resend', { method: 'POST' });
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById('bs-submit').addEventListener('click', async () => {
  const name = document.getElementById('bs-name').value.trim();
  const username = document.getElementById('bs-username').value.trim();
  const password = document.getElementById('bs-password').value;
  try {
    await api('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ name, username, password }) });
    window.location.href = '/';
  } catch (e) {
    showError(e.message);
  }
});

document.getElementById('login-submit').addEventListener('click', async () => {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    window.location.href = '/';
  } catch (e) {
    showError(e.message);
  }
});

boot();
