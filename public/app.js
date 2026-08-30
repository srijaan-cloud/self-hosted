const state = { me: null, dashboard: null, allProjects: [] };

async function boot() {
  state.me = await setupHeader();
  if (state.me.role === 'director') {
    document.getElementById('nav-settings').classList.remove('hidden');
    document.getElementById('new-project-btn').classList.remove('hidden');
  }
  if (!canWriteRole(state.me.role)) {
    document.getElementById('new-vendor-btn').classList.add('hidden');
    document.getElementById('new-material-type-btn').classList.add('hidden');
  }
  // Viewers/guests get the public showcase only — Vendors/Reports are internal
  // financial pages, and "New Project" is a director action either way.
  if (!isInternalRole(state.me.role)) {
    document.getElementById('nav-vendors').classList.add('hidden');
    document.getElementById('nav-reports').classList.add('hidden');
    document.getElementById('new-project-btn').classList.add('hidden');
  }
  setupNav();
  setupProjectModal();
  setupVendorModal();
  setupStaffModal();
  setupMaterialTypeModal();
  setupBackgroundUpload();
  setupLogoUpload();
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
  if (!isInternalRole(state.me.role)) {
    await loadPublicShowcase();
    return;
  }
  state.dashboard = await api('/api/dashboard');
  renderKpiRow(state.dashboard.totals);
  renderProjectGrid(state.dashboard.projects);
}

// ==================== PUBLIC SHOWCASE (viewer / guest) ====================
// No cost/payment data — just the project portfolio, marketing-style.

async function loadPublicShowcase() {
  const projects = await api('/api/public/projects');
  const kpiRow = document.getElementById('kpi-row');
  kpiRow.style.display = 'block';
  kpiRow.innerHTML = `
    <div class="showcase-hero">
      <div class="eyebrow" style="text-align:center;">Construction &amp; Development</div>
      <h1 class="hero-headline">Building <em>Timeless</em> Spaces, Together</h1>
      <p class="auth-sub" style="font-size:0.95rem; max-width:520px; margin-left:auto; margin-right:auto;">
        Explore Tapasya Constructions' ongoing and completed developments.
      </p>
    </div>
  `;

  const grid = document.getElementById('project-grid');
  grid.className = 'showcase-grid';
  if (projects.length === 0) {
    grid.innerHTML = '<p class="empty-state">No projects published yet.</p>';
    return;
  }
  grid.innerHTML = projects
    .map((p) => {
      const img = p.cover_image_key ? `background-image:url('/uploads/${p.cover_image_key}')` : '';
      const priceLine =
        p.status === 'completed' && p.sold_price_total
          ? `Sold: ${formatCurrency(p.sold_price_total)}`
          : p.price_per_sqft
          ? `From ${formatCurrency(p.price_per_sqft)}/sq.ft`
          : '';
      return `
        <a class="showcase-card" href="project.html?id=${p.id}">
          <div class="sc-image" style="${img}"></div>
          <div class="sc-body">
            <div class="sc-name">${p.name}</div>
            <div class="sc-meta">${p.city || ''} · <span class="status-pill status-${p.status}">${statusLabel(p.status)}</span></div>
            ${priceLine ? `<div class="sc-price">${priceLine}</div>` : ''}
          </div>
        </a>
      `;
    })
    .join('');
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
  const isDirector = state.me.role === 'director';
  grid.innerHTML = projects
    .map((p) => {
      const pct = Math.min(p.budget_used_pct, 100);
      const barClass = p.budget_used_pct > 100 ? 'danger' : p.budget_used_pct > 85 ? 'warn' : '';
      return `
        <a class="project-card" href="project.html?id=${p.id}">
          <div class="pc-top">
            <span class="pc-name">${p.name}</span>
            <div style="display:flex; align-items:center; gap:6px;">
              ${
                isDirector
                  ? `<button class="icon-btn edit-project-card" data-id="${p.id}" title="Edit project" style="padding:4px 8px; font-size:0.85rem;">✎</button>
                     <button class="icon-btn delete-project-card" data-id="${p.id}" title="Delete project" style="padding:4px 8px; font-size:0.85rem;">🗑</button>`
                  : ''
              }
              <span class="status-pill status-${p.status}">${statusLabel(p.status)}</span>
            </div>
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

  grid.querySelectorAll('.edit-project-card').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = projects.find((x) => x.id === Number(btn.dataset.id));
      openEditProjectModal(p);
    });
  });
  grid.querySelectorAll('.delete-project-card').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = projects.find((x) => x.id === Number(btn.dataset.id));
      deleteProject(p);
    });
  });
}

// ==================== NEW / EDIT PROJECT ====================

function setupProjectModal() {
  ['pm-price-sqft', 'pm-total-area', 'pm-extra-cost'].forEach((id) =>
    document.getElementById(id).addEventListener('input', () => autoCalcBudget('pm'))
  );

  document.getElementById('new-project-btn').addEventListener('click', () => {
    document.getElementById('project-modal-title').textContent = 'New Project';
    document.getElementById('pm-id').value = '';
    [
      'pm-name', 'pm-client', 'pm-city', 'pm-address', 'pm-start', 'pm-end', 'pm-budget', 'pm-description',
      'pm-owner-phone', 'pm-price-sqft', 'pm-total-area', 'pm-extra-cost', 'pm-extra-cost-notes', 'pm-sold-price', 'pm-amenities',
    ].forEach((id) => (document.getElementById(id).value = ''));
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
      owner_phone: document.getElementById('pm-owner-phone').value.trim(),
      price_per_sqft: parseFloat(document.getElementById('pm-price-sqft').value) || null,
      total_area_sqft: parseFloat(document.getElementById('pm-total-area').value) || null,
      extra_cost: parseFloat(document.getElementById('pm-extra-cost').value) || 0,
      extra_cost_notes: document.getElementById('pm-extra-cost-notes').value.trim(),
      sold_price_total: parseFloat(document.getElementById('pm-sold-price').value) || null,
      amenities: document.getElementById('pm-amenities').value.trim(),
    };
    if (!body.name) {
      errEl.textContent = 'Project name is required';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      const id = document.getElementById('pm-id').value;
      if (id) {
        await api(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/api/projects', { method: 'POST', body: JSON.stringify(body) });
      }
      closeModal('project-modal');
      await loadDashboard();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });
}

function openEditProjectModal(p) {
  document.getElementById('project-modal-title').textContent = 'Edit Project';
  document.getElementById('pm-id').value = p.id;
  document.getElementById('pm-name').value = p.name || '';
  document.getElementById('pm-client').value = p.client_name || '';
  document.getElementById('pm-city').value = p.city || '';
  document.getElementById('pm-address').value = p.site_address || '';
  document.getElementById('pm-start').value = p.start_date || '';
  document.getElementById('pm-end').value = p.expected_end_date || '';
  document.getElementById('pm-status').value = p.status;
  document.getElementById('pm-budget').value = p.total_budget;
  document.getElementById('pm-description').value = p.description || '';
  document.getElementById('pm-owner-phone').value = p.owner_phone || '';
  document.getElementById('pm-price-sqft').value = p.price_per_sqft || '';
  document.getElementById('pm-total-area').value = p.total_area_sqft || '';
  document.getElementById('pm-extra-cost').value = p.extra_cost || '';
  document.getElementById('pm-extra-cost-notes').value = p.extra_cost_notes || '';
  document.getElementById('pm-sold-price').value = p.sold_price_total || '';
  document.getElementById('pm-amenities').value = p.amenities || '';
  document.getElementById('project-modal-error').classList.add('hidden');
  openModal('project-modal');
}

async function deleteProject(p) {
  if (!confirm(`Delete "${p.name}"? This permanently removes the project and everything in it — materials, payments, labor, equipment, funding, photos, reviews. This cannot be undone.`)) return;
  await api(`/api/projects/${p.id}`, { method: 'DELETE' });
  await loadDashboard();
}

// ==================== VENDORS ====================

async function loadVendors() {
  const summary = await api('/api/vendor-payment-summary');
  const container = document.getElementById('vendors-list');
  if (summary.length === 0) {
    container.innerHTML = '<p class="empty-state">No vendors or payments recorded yet.</p>';
    return;
  }
  const canWrite = canWriteRole(state.me.role);
  container.innerHTML = summary
    .map((v) => {
      const contactBits = v.vendor
        ? [v.vendor.contact_person, v.vendor.phone, v.vendor.email, v.vendor.gst_number ? `GST ${v.vendor.gst_number}` : null]
            .filter(Boolean)
            .join(' · ')
        : '';
      const rows = v.payments
        .map(
          (p) => `<tr>
            <td>${formatDate(p.date)}</td><td>${p.project_name}</td><td class="num">${formatCurrency(p.amount)}</td>
            <td><span class="mode-pill">${paymentModeLabel(p.payment_mode)}</span></td>
            <td>${p.paid_to_account || '—'}</td><td>${p.transaction_id || '—'}</td><td>${p.remarks || '—'}</td>
          </tr>`
        )
        .join('');
      return `
        <details class="section-card vendor-card">
          <summary>
            <span class="vendor-name">${v.name}</span>
            ${contactBits ? `<span class="auth-sub vendor-contact">${contactBits}</span>` : ''}
            <span class="vendor-total">${formatCurrency(v.total)}${v.payments.length ? ` · ${v.payments.length} payment(s)` : ''}</span>
            ${canWrite && v.vendor ? `<button class="btn btn-small btn-danger delete-vendor" data-id="${v.vendor.id}">Delete</button>` : ''}
          </summary>
          ${
            v.payments.length
              ? `<div class="table-wrap" style="margin-top:12px;">
                  <table>
                    <thead><tr><th>Date</th><th>Project</th><th class="num">Amount</th><th>Mode</th><th>Account</th><th>Reference</th><th>Remarks</th></tr></thead>
                    <tbody>${rows}</tbody>
                  </table>
                </div>`
              : '<p class="auth-sub" style="margin-top:10px;">No payments recorded yet.</p>'
          }
        </details>`;
    })
    .join('');
  container.querySelectorAll('.delete-vendor').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!confirm('Delete this vendor record? (Their payment history stays intact.)')) return;
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
  if (state.allProjects.length === 0) state.allProjects = await api('/api/projects');
  await Promise.all([loadUsers(), loadMaterialTypesTable()]);
}

async function loadUsers() {
  const users = await api('/api/users');
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = users
    .map((u) => {
      const isMe = u.id === state.me.userId;
      const needsScope = u.role === 'site_supervisor' || u.role === 'auditor';
      const scopeControl = needsScope
        ? `<label style="display:flex; align-items:center; gap:6px; font-size:0.82rem;">
             <input type="checkbox" class="all-projects-toggle" data-id="${u.id}" style="width:auto; margin:0;" ${u.all_projects_access ? 'checked' : ''} /> All projects
           </label>
           ${!u.all_projects_access ? `<button class="btn btn-small btn-secondary manage-access" data-id="${u.id}" data-name="${u.name}">Manage Projects</button>` : ''}`
        : '<span style="color:var(--ink-soft);">—</span>';
      return `<tr>
        <td>${u.name}${isMe ? ' (you)' : ''}</td>
        <td>${u.email || u.username || '—'}</td>
        <td>
          <select class="role-select" data-id="${u.id}" ${isMe ? 'disabled' : ''}>
            ${['director', 'site_supervisor', 'auditor', 'viewer'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}
          </select>
        </td>
        <td>${scopeControl}</td>
        <td>${u.last_login ? formatDate(u.last_login.slice(0, 10)) : formatDate(u.created_at?.slice(0, 10))}</td>
      </tr>`;
    })
    .join('');

  tbody.querySelectorAll('.role-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await api(`/api/users/${sel.dataset.id}/role`, { method: 'PATCH', body: JSON.stringify({ role: sel.value, all_projects_access: false }) });
      await loadUsers();
    });
  });
  tbody.querySelectorAll('.all-projects-toggle').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const role = tbody.querySelector(`.role-select[data-id="${cb.dataset.id}"]`).value;
      await api(`/api/users/${cb.dataset.id}/role`, { method: 'PATCH', body: JSON.stringify({ role, all_projects_access: cb.checked }) });
      await loadUsers();
    });
  });
  tbody.querySelectorAll('.manage-access').forEach((btn) => {
    btn.addEventListener('click', () => openProjectAccessModal(btn.dataset.id, btn.dataset.name));
  });
}

async function openProjectAccessModal(userId, userName) {
  document.getElementById('pa-user-name').textContent = `${userName} — project access`;
  const assigned = await api(`/api/users/${userId}/assignments`);
  const assignedSet = new Set(assigned.map(String));
  document.getElementById('pa-project-list').innerHTML = state.allProjects
    .map(
      (p) => `<label style="display:flex; align-items:center; gap:8px; padding:6px 0;">
        <input type="checkbox" class="pa-checkbox" data-project="${p.id}" style="width:auto; margin:0;" ${assignedSet.has(String(p.id)) ? 'checked' : ''} />
        ${p.name}
      </label>`
    )
    .join('');
  document.querySelectorAll('.pa-checkbox').forEach((cb) => {
    cb.addEventListener('change', async () => {
      if (cb.checked) {
        await api(`/api/users/${userId}/assignments`, { method: 'POST', body: JSON.stringify({ project_id: Number(cb.dataset.project) }) });
      } else {
        await api(`/api/users/${userId}/assignments/${cb.dataset.project}`, { method: 'DELETE' });
      }
    });
  });
  openModal('project-access-modal');
}

function setupStaffModal() {
  document.getElementById('new-staff-btn').addEventListener('click', () => {
    ['sm-name', 'sm-username', 'sm-password'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('sm-role').value = 'site_supervisor';
    document.getElementById('sm-all-projects').checked = false;
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
      all_projects_access: document.getElementById('sm-all-projects').checked,
    };
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
      closeModal('staff-modal');
      await loadUsers();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });
}

function setupBackgroundUpload() {
  const input = document.getElementById('bg-file-input');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('bg-upload-status');
    statusEl.textContent = 'Uploading…';
    statusEl.classList.remove('hidden');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/settings/background', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      statusEl.textContent = 'Background updated.';
      document.querySelectorAll('.bg-layer').forEach((el) => {
        el.style.backgroundImage = `url('/api/settings/background-image?t=${Date.now()}')`;
      });
    } catch (e) {
      statusEl.textContent = e.message;
    }
  });
}

function setupLogoUpload() {
  const input = document.getElementById('logo-file-input');
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const statusEl = document.getElementById('logo-upload-status');
    statusEl.textContent = 'Uploading…';
    statusEl.classList.remove('hidden');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/settings/logo', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      statusEl.textContent = 'Logo updated.';
      document.querySelectorAll('#site-logo').forEach((el) => {
        el.src = `/api/settings/logo-image?t=${Date.now()}`;
        el.classList.remove('hidden');
      });
    } catch (e) {
      statusEl.textContent = e.message;
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
