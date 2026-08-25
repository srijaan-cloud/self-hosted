const state = { me: null, dashboard: null };

async function boot() {
  state.me = await setupHeader();
  if (state.me.role === 'director') {
    document.getElementById('nav-settings').classList.remove('hidden');
    document.getElementById('new-project-btn').classList.remove('hidden');
  }
  setupNav();
  setupProjectModal();
  setupVendorModal();
  setupStaffModal();
  setupMaterialTypeModal();
  document.getElementById('export-csv-btn').addEventListener('click', exportReportsCsv);
  await loadDashboard();
}

// ==================== NAV ====================

function setupNav() {
  document.querySelectorAll('.app-nav a').forEach((link) => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      document.querySelectorAll('.app-nav a').forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
      const view = link.dataset.view;
      document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
      document.getElementById(`view-${view}`).classList.remove('hidden');
      if (view === 'vendors') await loadVendors();
      if (view === 'reports') await loadReports();
      if (view === 'settings') await loadSettings();
    });
  });
}

// ==================== DASHBOARD ====================

async function loadDashboard() {
  state.dashboard = await api('/api/dashboard');
  renderKpiRow(state.dashboard.totals);
  renderProjectGrid(state.dashboard.projects);
  renderActivityFeed(state.dashboard.recentMaterials, state.dashboard.recentPayments);
}

function renderKpiRow(totals) {
  const pendingClass = totals.balance_due > 0 ? 'warn' : 'good';
  document.getElementById('kpi-row').innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Total Budget</div><div class="kpi-value">${formatCurrency(totals.total_budget)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Funding Received</div><div class="kpi-value">${formatCurrency(totals.funding_received)}</div></div>
    <div class="kpi-card"><div class="kpi-label">Committed</div><div class="kpi-value">${formatCurrency(totals.committed)}</div></div>
    <div class="kpi-card good"><div class="kpi-label">Paid</div><div class="kpi-value">${formatCurrency(totals.paid)}</div></div>
    <div class="kpi-card ${pendingClass}"><div class="kpi-label">Balance Due</div><div class="kpi-value">${formatCurrency(totals.balance_due)}</div></div>
  `;
}

function renderProjectGrid(projects) {
  const grid = document.getElementById('project-grid');
  if (projects.length === 0) {
    grid.innerHTML = '<p class="empty-state">No projects yet. Use "New Project" to add one.</p>';
    return;
  }
  grid.innerHTML = projects
    .map((p) => {
      const pct = Math.min(p.budget_used_pct, 100);
      const barClass = p.budget_used_pct > 100 ? 'danger' : p.budget_used_pct > 85 ? 'warn' : '';
      return `
        <a class="project-card" href="project.html?id=${p.id}">
          <div class="pc-top">
            <span class="pc-name">${p.name}</span>
            <span class="status-pill status-${p.status}">${statusLabel(p.status)}</span>
          </div>
          <div class="pc-meta">${p.client_name || ''}${p.city ? ' · ' + p.city : ''}</div>
          <div class="progress-bar"><div class="progress-bar-fill ${barClass}" style="width:${pct}%"></div></div>
          <div class="pc-stats">
            <span>${formatCurrency(p.committed)} of ${formatCurrency(p.total_budget)}</span>
            <span>${p.budget_used_pct}%</span>
          </div>
          <div class="pc-stats" style="margin-top:6px;">
            <span>Paid: ${formatCurrency(p.paid)}</span>
            <span class="${p.balance_due > 0 ? 'balance-due' : 'balance-clear'}">Due: ${formatCurrency(p.balance_due)}</span>
          </div>
        </a>
      `;
    })
    .join('');
}

function renderActivityFeed(materials, payments) {
  const feed = document.getElementById('activity-feed');
  const items = [
    ...materials.map((m) => ({ date: m.date, text: `Material order: ${formatCurrency(m.amount_total)} (${m.status})`, meta: m.invoice_number || '' })),
    ...payments.map((p) => ({ date: p.date, text: `Payment: ${formatCurrency(p.amount)} via ${paymentModeLabel(p.payment_mode)}`, meta: p.paid_to || '' })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12);

  if (items.length === 0) {
    feed.innerHTML = '<p class="empty-state">No activity yet.</p>';
    return;
  }
  feed.innerHTML = items
    .map((i) => `<div class="activity-item"><span>${i.text}</span><span class="a-meta">${formatDate(i.date)}${i.meta ? ' · ' + i.meta : ''}</span></div>`)
    .join('');
}

// ==================== NEW / EDIT PROJECT ====================

function setupProjectModal() {
  document.getElementById('new-project-btn').addEventListener('click', () => {
    document.getElementById('project-modal-title').textContent = 'New Project';
    document.getElementById('pm-id').value = '';
    ['pm-name', 'pm-client', 'pm-city', 'pm-address', 'pm-start', 'pm-end', 'pm-budget', 'pm-description'].forEach(
      (id) => (document.getElementById(id).value = '')
    );
    document.getElementById('pm-status').value = 'planning';
    document.getElementById('project-modal-error').classList.add('hidden');
    openModal('project-modal');
  });

  document.getElementById('pm-save').addEventListener('click', async () => {
    const errEl = document.getElementById('project-modal-error');
    errEl.classList.add('hidden');
    const body = {
      name: document.getElementById('pm-name').value.trim(),
      client_name: document.getElementById('pm-client').value.trim(),
      city: document.getElementById('pm-city').value.trim(),
      site_address: document.getElementById('pm-address').value.trim(),
      start_date: document.getElementById('pm-start').value || null,
      expected_end_date: document.getElementById('pm-end').value || null,
      status: document.getElementById('pm-status').value,
      total_budget: parseFloat(document.getElementById('pm-budget').value) || 0,
      description: document.getElementById('pm-description').value.trim(),
    };
    if (!body.name) {
      errEl.textContent = 'Project name is required';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
      closeModal('project-modal');
      await loadDashboard();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });
}

// ==================== VENDORS ====================

async function loadVendors() {
  const vendors = await api('/api/vendors');
  const tbody = document.getElementById('vendors-tbody');
  if (vendors.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No vendors yet.</td></tr>';
    return;
  }
  tbody.innerHTML = vendors
    .map(
      (v) => `<tr>
        <td>${v.name}</td><td>${v.contact_person || '—'}</td><td>${v.phone || '—'}</td>
        <td>${v.email || '—'}</td><td>${v.gst_number || '—'}</td>
        <td><button class="btn btn-small btn-danger delete-vendor" data-id="${v.id}">Delete</button></td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('.delete-vendor').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this vendor?')) return;
      await api(`/api/vendors/${btn.dataset.id}`, { method: 'DELETE' });
      await loadVendors();
    });
  });
}

function setupVendorModal() {
  document.getElementById('new-vendor-btn').addEventListener('click', () => {
    ['vm-name', 'vm-contact', 'vm-phone', 'vm-email', 'vm-gst', 'vm-address'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('vendor-modal-error').classList.add('hidden');
    openModal('vendor-modal');
  });
  document.getElementById('vm-save').addEventListener('click', async () => {
    const errEl = document.getElementById('vendor-modal-error');
    errEl.classList.add('hidden');
    const body = {
      name: document.getElementById('vm-name').value.trim(),
      contact_person: document.getElementById('vm-contact').value.trim(),
      phone: document.getElementById('vm-phone').value.trim(),
      email: document.getElementById('vm-email').value.trim(),
      gst_number: document.getElementById('vm-gst').value.trim(),
      address: document.getElementById('vm-address').value.trim(),
    };
    if (!body.name) {
      errEl.textContent = 'Vendor name is required';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      await api('/api/vendors', { method: 'POST', body: JSON.stringify(body) });
      closeModal('vendor-modal');
      await loadVendors();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });
}

// ==================== REPORTS ====================

async function loadReports() {
  if (!state.dashboard) await loadDashboard();
  const tbody = document.getElementById('reports-tbody');
  tbody.innerHTML = state.dashboard.projects
    .map(
      (p) => `<tr>
        <td>${p.name}</td><td><span class="status-pill status-${p.status}">${statusLabel(p.status)}</span></td>
        <td class="num">${formatCurrency(p.total_budget)}</td>
        <td class="num">${formatCurrency(p.funding_received)}</td>
        <td class="num">${formatCurrency(p.committed)}</td>
        <td class="num">${formatCurrency(p.paid)}</td>
        <td class="num ${p.balance_due > 0 ? 'balance-due' : 'balance-clear'}">${formatCurrency(p.balance_due)}</td>
      </tr>`
    )
    .join('');
}

function exportReportsCsv() {
  if (!state.dashboard) return;
  const header = ['Project', 'Status', 'Budget', 'Funding Received', 'Committed', 'Paid', 'Balance Due'];
  const rows = state.dashboard.projects.map((p) => [
    p.name, statusLabel(p.status), p.total_budget, p.funding_received, p.committed, p.paid, p.balance_due,
  ]);
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tapasya-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== SETTINGS ====================

async function loadSettings() {
  await Promise.all([loadStaff(), loadMaterialTypesTable()]);
}

async function loadStaff() {
  const staff = await api('/api/staff');
  document.getElementById('staff-tbody').innerHTML = staff
    .map((s) => `<tr><td>${s.name}</td><td>${s.username}</td><td>${roleLabel(s.role)}</td><td>${formatDate(s.created_at?.slice(0, 10))}</td></tr>`)
    .join('');
}

function setupStaffModal() {
  document.getElementById('new-staff-btn').addEventListener('click', () => {
    ['sm-name', 'sm-username', 'sm-password'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('sm-role').value = 'site_engineer';
    document.getElementById('staff-modal-error').classList.add('hidden');
    openModal('staff-modal');
  });
  document.getElementById('sm-save').addEventListener('click', async () => {
    const errEl = document.getElementById('staff-modal-error');
    errEl.classList.add('hidden');
    const body = {
      name: document.getElementById('sm-name').value.trim(),
      username: document.getElementById('sm-username').value.trim(),
      password: document.getElementById('sm-password').value,
      role: document.getElementById('sm-role').value,
    };
    try {
      await api('/api/staff', { method: 'POST', body: JSON.stringify(body) });
      closeModal('staff-modal');
      await loadStaff();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });
}

async function loadMaterialTypesTable() {
  const types = await api('/api/material-types');
  document.getElementById('material-types-tbody').innerHTML = types
    .map((t) => `<tr><td>${t.name}</td><td>${t.default_unit}</td></tr>`)
    .join('');
}

function setupMaterialTypeModal() {
  document.getElementById('new-material-type-btn').addEventListener('click', () => {
    document.getElementById('mtm-name').value = '';
    document.getElementById('mtm-unit').value = '';
    document.getElementById('material-type-modal-error').classList.add('hidden');
    openModal('material-type-modal');
  });
  document.getElementById('mtm-save').addEventListener('click', async () => {
    const errEl = document.getElementById('material-type-modal-error');
    errEl.classList.add('hidden');
    const body = {
      name: document.getElementById('mtm-name').value.trim(),
      default_unit: document.getElementById('mtm-unit').value.trim(),
    };
    if (!body.name || !body.default_unit) {
      errEl.textContent = 'Name and unit are both required';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      await api('/api/material-types', { method: 'POST', body: JSON.stringify(body) });
      closeModal('material-type-modal');
      await loadMaterialTypesTable();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });
}

boot();
