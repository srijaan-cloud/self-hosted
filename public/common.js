async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const MAX_UPLOAD_BYTES = 1024 * 1024;

// Downscales + re-encodes an image as JPEG, stepping down quality (and, if
// still too big, dimensions) until it's under the 1MB server cap. Non-images
// (PDFs, etc.) are returned as-is — the server will reject them if they're
// still too large, since there's no easy way to compress those in-browser.
async function compressImageIfNeeded(file, maxBytes = MAX_UPLOAD_BYTES) {
  if (!file.type.startsWith('image/') || file.size <= maxBytes) return file;

  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  const maxDim = 1920;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const quality = Math.max(0.9 - attempt * 0.15, 0.15);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && (blob.size <= maxBytes || attempt === 5)) {
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    }
    width = Math.round(width * 0.75);
    height = Math.round(height * 0.75);
  }
  return file;
}

// Shared upload path for every photo/document input in the app — compresses
// images client-side first, then posts to /api/uploads. Returns the R2 key.
async function uploadFile(file) {
  const compressed = await compressImageIfNeeded(file);
  const form = new FormData();
  form.append('file', compressed);
  const res = await fetch('/api/uploads', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.key;
}

function formatCurrency(n) {
  n = Number(n) || 0;
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'gpay', label: 'GPay' },
  { value: 'phonepe', label: 'PhonePe' },
  { value: 'upi_other', label: 'UPI (Other)' },
  { value: 'netbanking', label: 'Net Banking' },
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

function paymentModeLabel(value) {
  return (PAYMENT_MODES.find((m) => m.value === value) || {}).label || value;
}

function paymentModeOptionsHtml(selected) {
  return PAYMENT_MODES.map(
    (m) => `<option value="${m.value}" ${m.value === selected ? 'selected' : ''}>${m.label}</option>`
  ).join('');
}

function roleLabel(role) {
  return { director: 'Director', site_supervisor: 'Site Supervisor', auditor: 'Auditor', viewer: 'Viewer' }[role] || role;
}

function canWriteRole(role) {
  return role === 'director' || role === 'site_supervisor';
}

// viewer (default self-service login, and the anonymous guest skip) gets the
// public showcase only — no cost/payment data. Everyone else (director/
// site_supervisor/auditor) is internal staff.
function isInternalRole(role) {
  return role !== 'viewer';
}

function starRating(n) {
  n = Math.max(0, Math.min(5, Math.round(n || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function statusLabel(status) {
  return { planning: 'Planning', ongoing: 'Ongoing', on_hold: 'On Hold', completed: 'Completed' }[status] || status;
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
document.addEventListener('click', (e) => {
  if (e.target.matches('.modal-close')) closeModal(e.target.dataset.modal);
});

// Shared header wiring (role badge + logout). Each page decides its own
// director-only element visibility using the returned user.
async function setupHeader() {
  const me = await api('/api/auth/me');
  const badge = document.getElementById('role-badge');
  if (badge) badge.textContent = `${me.name} · ${roleLabel(me.role)}`;
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      window.location.href = '/api/auth/logout';
    });
  }
  return me;
}
