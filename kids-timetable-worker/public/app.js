const state = {
  children: [],
  selectedChildId: null,
  tasks: { fixed: [], extra: [] },
  selectedDate: todayISO(),
  monthEntries: {},
  monthYear: null,
  // Each child+date combo keeps its own independent unsaved draft, so switching
  // between Lahari and NagaSourish never forces a save/discard of the other's progress.
  drafts: {},
  passwordSet: false,
  hasCredentials: false,
  role: 'viewer',
  email: null,
};

function draftKey(childId, date) {
  return `${childId}|${date}`;
}

function currentDraft() {
  return state.drafts[draftKey(state.selectedChildId, state.selectedDate)];
}

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Runs an action that hits an admin-only endpoint, showing an alert if it fails.
// The server is the real gate (requireAdmin on every mutating route) — this is just
// consistent error handling for the UI, not a security boundary of its own.
async function runAction(actionFn) {
  try {
    await actionFn();
  } catch (e) {
    alert('Something went wrong: ' + e.message);
  }
}

// ==================== BOOT ====================

async function boot() {
  const [status, me] = await Promise.all([api('/api/auth/status'), api('/api/auth/me')]);
  state.passwordSet = status.passwordSet;
  state.hasCredentials = status.hasCredentials;
  state.role = me.role;
  state.email = me.email;
  await initApp();
}

// ==================== APP INIT ====================

async function initApp() {
  const [children, tasks] = await Promise.all([api('/api/children'), api('/api/tasks')]);
  state.children = children;
  state.tasks = tasks;
  state.selectedChildId = children[0].id;

  renderChildTabs();
  setupViewTabs();
  setupDayNav();
  setupMonthNav();
  setupSettings();
  setupSaveBar();
  setupLogout();
  applyRoleUI();

  document.getElementById('day-picker').value = state.selectedDate;
  await loadDayEntry(state.selectedDate);
}

// Viewers (anyone but an admin) can look at the tracker but never change it — the
// server enforces this on every mutating route regardless, this just keeps the UI
// from offering controls that would just 403.
function applyRoleUI() {
  const isAdmin = state.role === 'admin';
  document.querySelector('.save-bar').classList.toggle('hidden', !isAdmin);
  document.getElementById('profile-admin-section').classList.toggle('hidden', !isAdmin);
  document.getElementById('profile-email').textContent = state.email
    ? `Signed in as ${state.email} (${state.role})`
    : `Signed in with the family password (${state.role})`;
  const badge = document.getElementById('role-badge');
  if (isAdmin) {
    badge.classList.add('hidden');
  } else {
    badge.textContent = state.email ? `👀 ${state.email} — view only` : '👀 View only';
    badge.classList.remove('hidden');
  }
}

function renderChildTabs() {
  const wrap = document.getElementById('child-tabs');
  wrap.innerHTML = '';
  state.children.forEach((child) => {
    const btn = document.createElement('button');
    btn.className = 'child-tab' + (child.id === state.selectedChildId ? ' active' : '');
    btn.textContent = `${child.name} (${child.grade})`;
    btn.addEventListener('click', async () => {
      state.selectedChildId = child.id;
      renderChildTabs();
      await loadDayEntry(state.selectedDate);
      if (state.monthYear) await loadMonth(state.monthYear.year, state.monthYear.month);
    });
    wrap.appendChild(btn);
  });
}

function setupLogout() {
  document.getElementById('logout-btn').addEventListener('click', () => {
    window.location.href = '/api/auth/logout';
  });
}

function setupViewTabs() {
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.view-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.dataset.view;
      document.getElementById('view-day').classList.toggle('hidden', view !== 'day');
      document.getElementById('view-month').classList.toggle('hidden', view !== 'month');
      if (view === 'month' && !state.monthYear) {
        const [y, m] = state.selectedDate.split('-').map(Number);
        state.monthYear = { year: y, month: m };
        await loadMonth(y, m);
      }
    });
  });
}

// ==================== DAY VIEW ====================

function setupDayNav() {
  document.getElementById('day-picker').addEventListener('change', async (e) => {
    state.selectedDate = e.target.value;
    await loadDayEntry(state.selectedDate);
  });
  document.getElementById('day-prev').addEventListener('click', () => shiftDay(-1));
  document.getElementById('day-next').addEventListener('click', () => shiftDay(1));
  document.getElementById('day-today').addEventListener('click', async () => {
    state.selectedDate = todayISO();
    document.getElementById('day-picker').value = state.selectedDate;
    await loadDayEntry(state.selectedDate);
  });
}

async function shiftDay(delta) {
  const d = new Date(state.selectedDate + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  state.selectedDate = d.toISOString().slice(0, 10);
  document.getElementById('day-picker').value = state.selectedDate;
  await loadDayEntry(state.selectedDate);
}

function isDirty() {
  const draft = currentDraft();
  if (!draft) return false;
  const allKeys = [...state.tasks.fixed, ...state.tasks.extra].map((t) => t.key);
  return allKeys.some((k) => !!draft.draft[k] !== !!draft.saved[k]);
}

async function loadDayEntry(date) {
  const key = draftKey(state.selectedChildId, date);
  if (!state.drafts[key]) {
    const [year, month] = date.split('-').map(Number);
    const data = await api(`/api/entries?child_id=${state.selectedChildId}&year=${year}&month=${month}`);
    const entry = data.entries[date] || emptyEntry();
    state.drafts[key] = { saved: { ...entry }, draft: { ...entry } };
  }
  renderTaskLists();
  renderPointsSummary(computeLocalPoints(currentDraft().draft));
  updateSaveBarState();
}

function emptyEntry() {
  const e = {};
  [...state.tasks.fixed, ...state.tasks.extra].forEach((t) => (e[t.key] = 0));
  return e;
}

function computeLocalPoints(entry) {
  const fixed = state.tasks.fixed.filter((t) => entry[t.key]).length;
  const extra = state.tasks.extra.filter((t) => entry[t.key]).length;
  const bonus = fixed === state.tasks.fixed.length && extra >= 1 ? 2 : 0;
  return { fixed, extra, bonus, total: fixed + extra + bonus };
}

function renderTaskLists() {
  const fixedWrap = document.getElementById('fixed-tasks');
  const extraWrap = document.getElementById('extra-tasks');
  fixedWrap.innerHTML = '';
  extraWrap.innerHTML = '';

  state.tasks.fixed.forEach((t) => {
    fixedWrap.appendChild(taskRow(t));
  });
  state.tasks.extra.forEach((t) => {
    extraWrap.appendChild(taskRow(t));
  });
}

function taskRow(task) {
  const draft = currentDraft();
  const checked = !!draft.draft[task.key];
  const isAdmin = state.role === 'admin';
  const row = document.createElement('label');
  row.className = 'task-row' + (checked ? ' checked' : '') + (isAdmin ? '' : ' readonly');
  row.innerHTML = `
    <input type="checkbox" ${checked ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} />
    <div>
      <div class="task-label">${task.label}</div>
      ${task.time ? `<div class="task-time">${task.time}</div>` : ''}
    </div>
  `;
  if (isAdmin) {
    const checkbox = row.querySelector('input');
    checkbox.addEventListener('change', () => {
      currentDraft().draft[task.key] = checkbox.checked;
      row.classList.toggle('checked', checkbox.checked);
      renderPointsSummary(computeLocalPoints(currentDraft().draft));
      updateSaveBarState();
    });
  }
  return row;
}

function renderPointsSummary(points) {
  const wrap = document.getElementById('points-summary');
  wrap.innerHTML = `
    <div class="point-pill"><div class="num">${points.fixed}/4</div><div class="lbl">Fixed</div></div>
    <div class="point-pill"><div class="num">${points.extra}</div><div class="lbl">Extras</div></div>
    <div class="point-pill bonus"><div class="num">${points.bonus}</div><div class="lbl">Bonus</div></div>
    <div class="point-pill total"><div class="num">${points.total}</div><div class="lbl">Today's Total</div></div>
  `;
}

// ==================== SAVE ====================

function updateSaveBarState() {
  const dirty = isDirty();
  document.getElementById('unsaved-indicator').classList.toggle('hidden', !dirty);
  document.getElementById('save-btn').disabled = !dirty;
  if (!dirty) {
    document.getElementById('admin-code-fallback').classList.add('hidden');
  }
}

function setupSaveBar() {
  document.getElementById('save-btn').addEventListener('click', () => runAction(saveWithTouchId));
  document.getElementById('admin-code-submit').addEventListener('click', () => runAction(saveWithAdminCode));
}

// Saving prefers whichever Touch ID device is already registered — never offers to
// register a new one here. If none are registered, or the device's WebAuthn prompt
// itself fails (some Android/Chrome + Google Password Manager combinations refuse to
// even authenticate against an existing platform credential), this falls back to
// asking for the admin code instead of just erroring out.
async function saveWithTouchId() {
  if (state.hasCredentials) {
    try {
      const optionsJSON = await api('/api/auth/webauthn/save-options');
      const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
      await api('/api/auth/webauthn/save-verify', {
        method: 'POST',
        body: JSON.stringify({ response }),
      });
      await performSave();
      return;
    } catch (e) {
      // fall through to the admin-code fallback below
    }
  }
  document.getElementById('admin-code-fallback').classList.remove('hidden');
  document.getElementById('admin-code-input').focus();
}

async function saveWithAdminCode() {
  const code = document.getElementById('admin-code-input').value;
  await api('/api/auth/admin-code-verify', { method: 'POST', body: JSON.stringify({ code }) });
  document.getElementById('admin-code-input').value = '';
  document.getElementById('admin-code-fallback').classList.add('hidden');
  await performSave();
}

async function performSave() {
  const childId = state.selectedChildId;
  const date = state.selectedDate;
  const key = draftKey(childId, date);
  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  try {
    const data = await api('/api/entries', {
      method: 'POST',
      body: JSON.stringify({
        child_id: childId,
        date,
        tasks: state.drafts[key].draft,
      }),
    });
    state.drafts[key] = { saved: { ...data.entry }, draft: { ...data.entry } };
    if (childId === state.selectedChildId && date === state.selectedDate) {
      renderPointsSummary(data.points);
    }
    if (state.monthYear) {
      const [y, m] = date.split('-').map(Number);
      if (y === state.monthYear.year && m === state.monthYear.month) {
        await loadMonth(y, m);
      }
    }
  } finally {
    if (childId === state.selectedChildId && date === state.selectedDate) {
      updateSaveBarState();
    }
  }
}

// ==================== MONTH VIEW ====================

function setupMonthNav() {
  document.getElementById('month-prev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('month-next').addEventListener('click', () => shiftMonth(1));
}

async function shiftMonth(delta) {
  let { year, month } = state.monthYear;
  month += delta;
  if (month < 1) { month = 12; year--; }
  if (month > 12) { month = 1; year++; }
  await loadMonth(year, month);
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function loadMonth(year, month) {
  state.monthYear = { year, month };
  const [entriesData, summary] = await Promise.all([
    api(`/api/entries?child_id=${state.selectedChildId}&year=${year}&month=${month}`),
    api(`/api/summary?child_id=${state.selectedChildId}&year=${year}&month=${month}`),
  ]);
  state.monthEntries = entriesData.entries;

  document.getElementById('month-label').textContent = `${MONTH_NAMES[month - 1]} ${year}`;
  document.getElementById('month-stats').innerHTML = `
    <div class="point-pill total"><div class="num">${summary.total}</div><div class="lbl">Month Total</div></div>
    <div class="point-pill bonus"><div class="num">${summary.perfectDays}</div><div class="lbl">Perfect Days</div></div>
    <div class="point-pill"><div class="num">${summary.daysLogged}</div><div class="lbl">Days Logged</div></div>
  `;

  renderCalendar(year, month);
}

function renderCalendar(year, month) {
  const grid = document.getElementById('calendar-grid');
  grid.innerHTML = '';

  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDow = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = todayISO();

  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const entry = state.monthEntries[dateStr];
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (dateStr === today ? ' today' : '') + (!entry ? ' no-entry' : '');
    cell.innerHTML = `
      <div class="cal-date">${day}</div>
      <div class="cal-points">${entry ? entry.points.total : '–'}</div>
      ${entry && entry.points.bonus > 0 ? '<div class="cal-bonus">⭐</div>' : ''}
    `;
    cell.addEventListener('click', async () => {
      state.selectedDate = dateStr;
      document.getElementById('day-picker').value = dateStr;
      document.querySelectorAll('.view-tab').forEach((t) => t.classList.remove('active'));
      document.querySelector('.view-tab[data-view="day"]').classList.add('active');
      document.getElementById('view-day').classList.remove('hidden');
      document.getElementById('view-month').classList.add('hidden');
      await loadDayEntry(dateStr);
    });
    grid.appendChild(cell);
  }
}

// ==================== SETTINGS ====================

function setupSettings() {
  document.getElementById('settings-btn').addEventListener('click', async () => {
    document.getElementById('settings-modal').classList.remove('hidden');
    if (state.role !== 'admin') return;
    await refreshCredentialsList();
    await refreshUsersList();
  });
  document.getElementById('settings-close').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('hidden');
  });

  document.getElementById('change-submit').addEventListener('click', async () => {
    const currentPassword = document.getElementById('change-current').value;
    const newPassword = document.getElementById('change-new').value;
    const errEl = document.getElementById('change-error');
    errEl.classList.add('hidden');
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      document.getElementById('change-current').value = '';
      document.getElementById('change-new').value = '';
      errEl.textContent = 'Password updated.';
      errEl.classList.remove('hidden');
      errEl.classList.remove('auth-error');
      errEl.classList.add('auth-success');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
      errEl.classList.remove('auth-success');
      errEl.classList.add('auth-error');
    }
  });

  document.getElementById('add-touchid-btn').addEventListener('click', () => runAction(addTouchIdAction));
}

async function addTouchIdAction() {
  const errEl = document.getElementById('webauthn-error');
  const okEl = document.getElementById('webauthn-success');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');
  try {
    const optionsJSON = await api('/api/auth/webauthn/register-options');
    const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });
    const deviceName = guessDeviceName();
    await api('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body: JSON.stringify({ response, deviceName }),
    });
    okEl.textContent = 'Touch ID added for this device.';
    okEl.classList.remove('hidden');
    await refreshCredentialsList();
  } catch (e) {
    errEl.textContent = 'Could not add Touch ID: ' + e.message;
    errEl.classList.remove('hidden');
  }
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return 'Mac (Touch ID)';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  return 'This device';
}

async function refreshCredentialsList() {
  const creds = await api('/api/auth/credentials');
  state.hasCredentials = creds.length > 0;
  updateSaveBarState();
  const wrap = document.getElementById('credentials-list');
  if (creds.length === 0) {
    wrap.innerHTML = '<p style="color:var(--ink-soft); font-size:0.85rem;">No Touch ID devices registered yet.</p>';
    return;
  }
  wrap.innerHTML = '';
  creds.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'credential-row';
    row.innerHTML = `<span>${c.device_name}</span><button>Remove</button>`;
    row.querySelector('button').addEventListener('click', () => {
      runAction(async () => {
        await api(`/api/auth/credentials/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
        await refreshCredentialsList();
      });
    });
    wrap.appendChild(row);
  });
}

// ==================== USERS (admin management) ====================

async function refreshUsersList() {
  const wrap = document.getElementById('users-list');
  const errEl = document.getElementById('users-error');
  errEl.classList.add('hidden');
  try {
    const { users, seedAdminEmail } = await api('/api/admin/users');
    if (users.length === 0) {
      wrap.innerHTML = '<p style="color:var(--ink-soft); font-size:0.85rem;">No one has signed in with Google or an email code yet.</p>';
      return;
    }
    wrap.innerHTML = '';
    users.forEach((u) => {
      const isSeed = u.email === seedAdminEmail;
      const isMe = u.email === state.email;
      const row = document.createElement('div');
      row.className = 'credential-row';
      const label = `${u.email}${isMe ? ' (you)' : ''}${isSeed ? ' 👑' : ''} — ${u.role}`;
      row.innerHTML = `<span>${label}</span>`;
      if (!isSeed) {
        const btn = document.createElement('button');
        btn.textContent = u.role === 'admin' ? 'Make Viewer' : 'Make Admin';
        btn.addEventListener('click', () => runAction(async () => {
          await api(`/api/admin/users/${encodeURIComponent(u.email)}/role`, {
            method: 'POST',
            body: JSON.stringify({ role: u.role === 'admin' ? 'viewer' : 'admin' }),
          });
          await refreshUsersList();
        }));
        row.appendChild(btn);
      }
      wrap.appendChild(row);
    });
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
}

boot();
