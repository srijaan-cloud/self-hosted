async function api(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
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
