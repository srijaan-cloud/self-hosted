async function requireLogin() {
  const me = await fetch('/api/auth/me').then((r) => r.json());
  if (!me.loggedIn) {
    window.location.href = '/login.html';
    return null;
  }
  document.getElementById('whoami').textContent = `Signed in as ${me.username}`;
  return me;
}

document.getElementById('logoutLink').addEventListener('click', async (e) => {
  e.preventDefault();
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---------- Availability calendar ----------

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let viewYear, viewMonth; // viewMonth is 0-indexed

function initCalendar() {
  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  document.getElementById('prevMonth').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('nextMonth').addEventListener('click', () => shiftMonth(1));
  loadCalendar();
}

function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
  if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
  loadCalendar();
}

async function loadCalendar() {
  const monthStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  document.getElementById('monthLabel').textContent =
    new Date(viewYear, viewMonth, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  let dates = [];
  try {
    const res = await fetch(`/api/admin/availability?month=${monthStr}`);
    if (res.status === 401) return window.location.href = '/login.html';
    const data = await res.json();
    dates = data.dates || [];
  } catch (err) {
    console.error('Failed to load availability', err);
  }
  const statusByDate = {};
  for (const d of dates) {
    statusByDate[d.date] = d.full_day ? 'booked' : (d.morning && d.evening) ? 'booked' : (d.morning || d.evening) ? 'half' : 'available';
  }
  renderCalendarGrid(monthStr, statusByDate);
}

function renderCalendarGrid(monthStr, statusByDate) {
  const grid = document.getElementById('calendarGrid');
  const firstDay = new Date(`${monthStr}-01T00:00:00`);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const startOffset = firstDay.getDay();

  let html = DOW.map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < startOffset; i++) html += `<div class="day blank"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
    const status = statusByDate[dateStr] || 'available';
    html += `<div class="day ${status}">${day}</div>`;
  }
  grid.innerHTML = html;
}

// ---------- Bookings ----------

async function loadBookings() {
  const res = await fetch('/api/admin/bookings');
  if (res.status === 401) return window.location.href = '/login.html';
  const { bookings } = await res.json();
  const tbody = document.querySelector('#bookingsTable tbody');
  tbody.innerHTML = bookings.length
    ? bookings.map((b) => `
      <tr>
        <td>${b.event_date}</td>
        <td>${b.session.replace('_', ' ')}</td>
        <td>${b.customer_name || ''}</td>
        <td>${b.event_type || ''}</td>
        <td><button type="button" class="secondary" data-id="${b.id}" data-action="delete-booking">Remove</button></td>
      </tr>`).join('')
    : '<tr><td colspan="5">No bookings yet.</td></tr>';
}

document.getElementById('bookingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('bookingMsg');
  msg.textContent = '';
  msg.className = 'msg';
  const body = {
    event_date: document.getElementById('eventDate').value,
    session: document.getElementById('session').value,
    customer_name: document.getElementById('customerName').value,
    event_type: document.getElementById('eventType').value,
    notes: document.getElementById('notes').value,
  };
  const res = await fetch('/api/admin/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) { msg.textContent = data.error || 'Could not create booking'; msg.classList.add('error'); return; }
  msg.textContent = 'Booking added.';
  msg.classList.add('ok');
  e.target.reset();
  loadBookings();
  loadCalendar();
});

document.querySelector('#bookingsTable tbody').addEventListener('click', async (e) => {
  if (e.target.dataset.action !== 'delete-booking') return;
  await fetch(`/api/admin/bookings/${e.target.dataset.id}`, { method: 'DELETE' });
  loadBookings();
  loadCalendar();
});

// ---------- Gallery ----------

async function loadGallery() {
  const res = await fetch('/api/gallery');
  const { photos } = await res.json();
  const tbody = document.querySelector('#galleryTable tbody');
  tbody.innerHTML = photos.length
    ? photos.map((p) => `
      <tr>
        <td><img class="thumb" src="${p.url}" alt=""></td>
        <td>${p.caption || ''}</td>
        <td><button type="button" class="secondary" data-id="${p.id}" data-action="delete-photo">Remove</button></td>
      </tr>`).join('')
    : '<tr><td colspan="3">No photos yet.</td></tr>';
}

document.getElementById('galleryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('galleryMsg');
  msg.textContent = '';
  msg.className = 'msg';
  const files = Array.from(document.getElementById('photoFile').files);
  if (!files.length) return;
  const caption = document.getElementById('photoCaption').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  let uploaded = 0;
  let failed = 0;
  for (const file of files) {
    msg.textContent = `Uploading ${uploaded + failed + 1} of ${files.length}...`;
    const form = new FormData();
    form.append('file', file);
    form.append('caption', caption);
    const res = await fetch('/api/admin/gallery', { method: 'POST', body: form });
    if (res.ok) uploaded++; else failed++;
  }

  submitBtn.disabled = false;
  if (failed === 0) {
    msg.textContent = `${uploaded} photo${uploaded === 1 ? '' : 's'} uploaded.`;
    msg.classList.add('ok');
  } else {
    msg.textContent = `${uploaded} uploaded, ${failed} failed (check file size, max 3MB each).`;
    msg.classList.add('error');
  }
  e.target.reset();
  loadGallery();
});

document.querySelector('#galleryTable tbody').addEventListener('click', async (e) => {
  if (e.target.dataset.action !== 'delete-photo') return;
  await fetch(`/api/admin/gallery/${e.target.dataset.id}`, { method: 'DELETE' });
  loadGallery();
});

(async function start() {
  const me = await requireLogin();
  if (!me) return;
  initCalendar();
  loadBookings();
  loadGallery();
})();
