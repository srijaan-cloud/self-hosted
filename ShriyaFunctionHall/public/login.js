const heading = document.getElementById('heading');
const submitBtn = document.getElementById('submitBtn');
const bootstrapNote = document.getElementById('bootstrapNote');
const msg = document.getElementById('msg');
let bootstrapMode = false;

async function init() {
  const me = await fetch('/api/auth/me').then((r) => r.json());
  if (me.loggedIn) {
    window.location.href = '/admin.html';
    return;
  }
  const status = await fetch('/api/auth/bootstrap-status').then((r) => r.json());
  bootstrapMode = status.needsBootstrap;
  if (bootstrapMode) {
    heading.textContent = 'Create Admin Account';
    submitBtn.textContent = 'Create Account';
    bootstrapNote.hidden = false;
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  if (bootstrapMode) {
    const res = await fetch('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { msg.textContent = data.error || 'Could not create admin account'; return; }
  }

  const loginRes = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const loginData = await loginRes.json();
  if (!loginRes.ok) { msg.textContent = loginData.error || 'Invalid username or password'; return; }
  window.location.href = '/admin.html';
});

init();
