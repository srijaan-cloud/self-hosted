const state = {
  me: null,
  projectId: new URLSearchParams(window.location.search).get('id'),
  project: null,
  materialTypes: [],
  vendors: [],
  materialEntries: [],
};

async function boot() {
  if (!state.projectId) {
    document.getElementById('project-name').textContent = 'No project specified';
    return;
  }
  state.me = await setupHeader();
  setupTabs();
  setupEditProjectModal();
  setupMaterialEntryModal();
  setupPaymentModal();
  setupLaborModal();
  setupEquipmentModal();
  setupFundingModal();

  [state.materialTypes, state.vendors] = await Promise.all([api('/api/material-types'), api('/api/vendors')]);
  populateSelect('me-type', state.materialTypes, (t) => t.id, (t) => `${t.name} (${t.default_unit})`);
  populateSelect('mat-filter-type', state.materialTypes, (t) => t.id, (t) => t.name, true, 'All material types');
  populateSelect('me-vendor', state.vendors, (v) => v.id, (v) => v.name, true, '— None —');
  populateSelect('mat-filter-vendor', state.vendors, (v) => v.id, (v) => v.name, true, 'All vendors');
  document.getElementById('pay-mode').innerHTML = paymentModeOptionsHtml();
  document.getElementById('fd-mode').innerHTML = paymentModeOptionsHtml();

  if (state.me.role === 'director') document.getElementById('edit-project-btn').classList.remove('hidden');

  await loadProject();
  await loadMaterials();
}

function populateSelect(id, items, valueFn, labelFn, withBlank, blankLabel) {
  const el = document.getElementById(id);
  const blank = withBlank ? `<option value="">${blankLabel}</option>` : '';
  el.innerHTML = blank + items.map((i) => `<option value="${valueFn(i)}">${labelFn(i)}</option>`).join('');
}

// ==================== TABS ====================

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-view').forEach((v) => v.classList.add('hidden'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
      const tab = btn.dataset.tab;
      if (tab === 'payments') await loadPayments();
      if (tab === 'labor') await loadLabor();
      if (tab === 'equipment') await loadEquipment();
      if (tab === 'funding') await loadFunding();
    });
  });
}

// ==================== OVERVIEW ====================

async function loadProject() {
  state.project = await api(`/api/projects/${state.projectId}`);
  const p = state.project;
  document.title = `${p.name} — Tapasya Constructions`;
  document.getElementById('project-name').textContent = p.name;
  document.getElementById('project-meta').innerHTML =
    `${p.client_name || ''}${p.city ? ' · ' + p.city : ''} · <span class="status-pill status-${p.status}">${statusLabel(p.status)}</span>`;
  document.getElementById('project-description').textContent = p.description || 'No description provided.';
  document.getElementById('project-timeline').innerHTML =
    `Start: ${formatDate(p.start_date)} &nbsp;·&nbsp; Expected completion: ${formatDate(p.expected_end_date)}` +
    (p.actual_end_date ? ` &nbsp;·&nbsp; Actual completion: ${formatDate(p.actual_end_date)}` : '');

  const dash = await api('/api/dashboard');
  const summary = dash.projects.find((x) => String(x.id) === String(p.id));
  if (summary) {
    const pendingClass = summary.balance_due > 0 ? 'warn' : 'good';
    document.getElementById('project-kpi-row').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Budget</div><div class="kpi-value">${formatCurrency(summary.total_budget)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Funding Received</div><div class="kpi-value">${formatCurrency(summary.funding_received)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Committed</div><div class="kpi-value">${formatCurrency(summary.committed)}</div></div>
      <div class="kpi-card good"><div class="kpi-label">Paid</div><div class="kpi-value">${formatCurrency(summary.paid)}</div></div>
      <div class="kpi-card ${pendingClass}"><div class="kpi-label">Balance Due</div><div class="kpi-value">${formatCurrency(summary.balance_due)}</div></div>
    `;
  }
}

function setupEditProjectModal() {
  document.getElementById('edit-project-btn').addEventListener('click', () => {
    const p = state.project;
    document.getElementById('ep-name').value = p.name || '';
    document.getElementById('ep-client').value = p.client_name || '';
    document.getElementById('ep-city').value = p.city || '';
    document.getElementById('ep-address').value = p.site_address || '';
    document.getElementById('ep-start').value = p.start_date || '';
    document.getElementById('ep-end').value = p.expected_end_date || '';
    document.getElementById('ep-status').value = p.status;
    document.getElementById('ep-budget').value = p.total_budget;
    document.getElementById('ep-description').value = p.description || '';
    openModal('edit-project-modal');
  });
  document.getElementById('ep-save').addEventListener('click', async () => {
    const body = {
      name: document.getElementById('ep-name').value.trim(),
      client_name: document.getElementById('ep-client').value.trim(),
      city: document.getElementById('ep-city').value.trim(),
      site_address: document.getElementById('ep-address').value.trim(),
      start_date: document.getElementById('ep-start').value || null,
      expected_end_date: document.getElementById('ep-end').value || null,
      status: document.getElementById('ep-status').value,
      total_budget: parseFloat(document.getElementById('ep-budget').value) || 0,
      description: document.getElementById('ep-description').value.trim(),
    };
    await api(`/api/projects/${state.projectId}`, { method: 'PATCH', body: JSON.stringify(body) });
    closeModal('edit-project-modal');
    await loadProject();
  });
}

// ==================== MATERIALS ====================

async function loadMaterials() {
  state.materialEntries = await api(`/api/material-entries?project_id=${state.projectId}`);
  renderMaterialsTable();
  populateSelect(
    'pay-material-entry',
    state.materialEntries,
    (m) => m.id,
    (m) => `#${m.id} — ${formatDate(m.date)} — ${materialTypeName(m.material_type_id)} — ${formatCurrency(m.amount_total)}`,
    true,
    '— Not linked —'
  );
}

function materialTypeName(id) {
  return (state.materialTypes.find((t) => t.id === id) || {}).name || '—';
}
function vendorName(id) {
  return (state.vendors.find((v) => v.id === id) || {}).name || '—';
}

function renderMaterialsTable() {
  const typeFilter = document.getElementById('mat-filter-type').value;
  const vendorFilter = document.getElementById('mat-filter-vendor').value;
  const rows = state.materialEntries.filter(
    (m) =>
      (!typeFilter || String(m.material_type_id) === typeFilter) &&
      (!vendorFilter || String(m.vendor_id) === vendorFilter)
  );
  const tbody = document.getElementById('materials-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-state">No material entries yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (m) => `<tr>
        <td>${formatDate(m.date)}</td><td>${materialTypeName(m.material_type_id)}</td><td>${vendorName(m.vendor_id)}</td>
        <td class="num">${m.quantity_ordered}</td><td class="num">${m.quantity_received}</td><td>${m.unit}</td>
        <td class="num">${formatCurrency(m.rate_per_unit)}</td><td class="num">${formatCurrency(m.amount_total)}</td>
        <td class="num">${formatCurrency(m.amount_paid)}</td>
        <td class="num ${m.amount_balance > 0 ? 'balance-due' : 'balance-clear'}">${formatCurrency(m.amount_balance)}</td>
        <td>${m.status}</td><td>${m.invoice_number || '—'}</td>
        <td><button class="btn btn-small btn-secondary edit-material" data-id="${m.id}">Edit</button></td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('.edit-material').forEach((btn) => {
    btn.addEventListener('click', () => openMaterialEntryModal(state.materialEntries.find((m) => m.id === Number(btn.dataset.id))));
  });
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'mat-filter-type' || e.target.id === 'mat-filter-vendor') renderMaterialsTable();
});

function setupMaterialEntryModal() {
  document.getElementById('new-material-entry-btn').addEventListener('click', () => openMaterialEntryModal(null));

  document.getElementById('me-type').addEventListener('change', (e) => {
    const t = state.materialTypes.find((x) => String(x.id) === e.target.value);
    if (t && !document.getElementById('me-unit').value) document.getElementById('me-unit').value = t.default_unit;
  });
  ['me-qty-received', 'me-rate'].forEach((id) =>
    document.getElementById(id).addEventListener('input', () => {
      const qty = parseFloat(document.getElementById('me-qty-received').value) || 0;
      const rate = parseFloat(document.getElementById('me-rate').value) || 0;
      if (qty && rate) document.getElementById('me-total').value = (qty * rate).toFixed(2);
    })
  );

  document.getElementById('me-bill-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('me-upload-status');
    statusEl.textContent = 'Uploading…';
    statusEl.classList.remove('hidden');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/uploads', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      document.getElementById('me-bill-file').dataset.key = data.key;
      statusEl.textContent = `Attached: ${file.name}`;
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  document.getElementById('me-save').addEventListener('click', async () => {
    const errEl = document.getElementById('material-entry-modal-error');
    errEl.classList.add('hidden');
    const body = {
      project_id: Number(state.projectId),
      material_type_id: Number(document.getElementById('me-type').value),
      vendor_id: document.getElementById('me-vendor').value ? Number(document.getElementById('me-vendor').value) : null,
      date: document.getElementById('me-date').value,
      quantity_ordered: parseFloat(document.getElementById('me-qty-ordered').value) || 0,
      quantity_received: parseFloat(document.getElementById('me-qty-received').value) || 0,
      unit: document.getElementById('me-unit').value.trim(),
      rate_per_unit: parseFloat(document.getElementById('me-rate').value) || 0,
      amount_total: parseFloat(document.getElementById('me-total').value) || 0,
      invoice_number: document.getElementById('me-invoice').value.trim(),
      status: document.getElementById('me-status').value,
      notes: document.getElementById('me-notes').value.trim(),
      created_by: state.me.name,
    };
    const key = document.getElementById('me-bill-file').dataset.key;
    if (key) body.bill_attachment_key = key;
    if (!body.date || !body.material_type_id) {
      errEl.textContent = 'Date and material type are required';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      const id = document.getElementById('me-id').value;
      if (id) {
        await api(`/api/material-entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/api/material-entries', { method: 'POST', body: JSON.stringify(body) });
      }
      closeModal('material-entry-modal');
      await loadMaterials();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });
}

function openMaterialEntryModal(entry) {
  document.getElementById('material-entry-modal-title').textContent = entry ? 'Edit Material Entry' : 'Add Material Entry';
  document.getElementById('me-id').value = entry ? entry.id : '';
  document.getElementById('me-date').value = entry ? entry.date : new Date().toISOString().slice(0, 10);
  document.getElementById('me-type').value = entry ? entry.material_type_id : '';
  document.getElementById('me-vendor').value = entry ? entry.vendor_id || '' : '';
  document.getElementById('me-unit').value = entry ? entry.unit : '';
  document.getElementById('me-qty-ordered').value = entry ? entry.quantity_ordered : '';
  document.getElementById('me-qty-received').value = entry ? entry.quantity_received : '';
  document.getElementById('me-rate').value = entry ? entry.rate_per_unit : '';
  document.getElementById('me-total').value = entry ? entry.amount_total : '';
  document.getElementById('me-invoice').value = entry ? entry.invoice_number || '' : '';
  document.getElementById('me-status').value = entry ? entry.status : 'ordered';
  document.getElementById('me-notes').value = entry ? entry.notes || '' : '';
  document.getElementById('me-bill-file').value = '';
  delete document.getElementById('me-bill-file').dataset.key;
  document.getElementById('me-upload-status').classList.add('hidden');
  document.getElementById('material-entry-modal-error').classList.add('hidden');
  openModal('material-entry-modal');
}

// ==================== PAYMENTS ====================

async function loadPayments() {
  const category = document.getElementById('pay-filter-category').value;
  const url = `/api/payments?project_id=${state.projectId}` + (category ? `&category=${category}` : '');
  const rows = await api(url);
  const filtered = category ? rows.filter((r) => r.category === category) : rows;
  const tbody = document.getElementById('payments-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No payments recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map((p) => {
      const ref = p.payment_mode === 'cheque' ? `Cheque #${p.cheque_number || '—'} (${p.bank_name || '—'})` : p.transaction_id || '—';
      return `<tr>
        <td>${formatDate(p.date)}</td><td>${p.category}</td><td class="num">${formatCurrency(p.amount)}</td>
        <td><span class="mode-pill">${paymentModeLabel(p.payment_mode)}</span></td><td>${ref}</td>
        <td>${p.paid_to || '—'}</td><td>${p.paid_by || '—'}</td><td>${p.remarks || '—'}</td>
        <td><button class="btn btn-small btn-danger delete-payment" data-id="${p.id}">Delete</button></td>
      </tr>`;
    })
    .join('');
  tbody.querySelectorAll('.delete-payment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this payment?')) return;
      await api(`/api/payments/${btn.dataset.id}`, { method: 'DELETE' });
      await loadPayments();
      await loadMaterials();
    });
  });
}

document.getElementById('pay-filter-category').addEventListener('change', loadPayments);

function togglePaymentModeFields() {
  const mode = document.getElementById('pay-mode').value;
  document.getElementById('pay-cheque-wrap').classList.toggle('hidden', mode !== 'cheque');
  document.getElementById('pay-bank-wrap').classList.toggle('hidden', mode !== 'cheque');
  document.getElementById('pay-transaction-wrap').classList.toggle('hidden', mode === 'cash' || mode === 'cheque');
}

function setupPaymentModal() {
  document.getElementById('new-payment-btn').addEventListener('click', () => {
    document.getElementById('pay-date').value = new Date().toISOString().slice(0, 10);
    ['pay-amount', 'pay-transaction-id', 'pay-cheque-number', 'pay-bank-name', 'pay-paid-to', 'pay-paid-by', 'pay-remarks'].forEach(
      (id) => (document.getElementById(id).value = '')
    );
    document.getElementById('pay-category').value = 'material';
    document.getElementById('pay-mode').value = 'cash';
    document.getElementById('pay-material-entry').value = '';
    document.getElementById('pay-receipt-file').value = '';
    delete document.getElementById('pay-receipt-file').dataset.key;
    document.getElementById('pay-upload-status').classList.add('hidden');
    document.getElementById('payment-modal-error').classList.add('hidden');
    togglePaymentModeFields();
    openModal('payment-modal');
  });

  document.getElementById('pay-mode').addEventListener('change', togglePaymentModeFields);

  document.getElementById('pay-receipt-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('pay-upload-status');
    statusEl.textContent = 'Uploading…';
    statusEl.classList.remove('hidden');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/uploads', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      document.getElementById('pay-receipt-file').dataset.key = data.key;
      statusEl.textContent = `Attached: ${file.name}`;
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  document.getElementById('pay-save').addEventListener('click', async () => {
    const errEl = document.getElementById('payment-modal-error');
    errEl.classList.add('hidden');
    const body = {
      project_id: Number(state.projectId),
      material_entry_id: document.getElementById('pay-material-entry').value ? Number(document.getElementById('pay-material-entry').value) : null,
      category: document.getElementById('pay-category').value,
      date: document.getElementById('pay-date').value,
      amount: parseFloat(document.getElementById('pay-amount').value) || 0,
      payment_mode: document.getElementById('pay-mode').value,
      transaction_id: document.getElementById('pay-transaction-id').value.trim(),
      cheque_number: document.getElementById('pay-cheque-number').value.trim(),
      bank_name: document.getElementById('pay-bank-name').value.trim(),
      paid_to: document.getElementById('pay-paid-to').value.trim(),
      paid_by: document.getElementById('pay-paid-by').value.trim(),
      remarks: document.getElementById('pay-remarks').value.trim(),
    };
    const key = document.getElementById('pay-receipt-file').dataset.key;
    if (key) body.receipt_attachment_key = key;
    if (!body.date || !body.amount) {
      errEl.textContent = 'Date and amount are required';
      errEl.classList.remove('hidden');
      return;
    }
    try {
      await api('/api/payments', { method: 'POST', body: JSON.stringify(body) });
      closeModal('payment-modal');
      await loadPayments();
      await loadMaterials();
      await loadProject();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  });
}

// ==================== LABOR ====================

async function loadLabor() {
  const rows = await api(`/api/labor-entries?project_id=${state.projectId}`);
  const tbody = document.getElementById('labor-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No labor entries yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (l) => `<tr>
        <td>${formatDate(l.date)}</td><td>${l.trade}</td><td>${l.contractor_name || '—'}</td>
        <td class="num">${l.worker_count}</td><td class="num">${formatCurrency(l.wage_rate)}</td>
        <td class="num">${formatCurrency(l.amount_total)}</td><td class="num">${formatCurrency(l.amount_paid)}</td>
        <td class="num ${l.amount_balance > 0 ? 'balance-due' : 'balance-clear'}">${formatCurrency(l.amount_balance)}</td>
        <td><button class="btn btn-small btn-danger delete-labor" data-id="${l.id}">Delete</button></td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('.delete-labor').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this labor entry?')) return;
      await api(`/api/labor-entries/${btn.dataset.id}`, { method: 'DELETE' });
      await loadLabor();
    });
  });
}

function setupLaborModal() {
  document.getElementById('new-labor-btn').addEventListener('click', () => {
    document.getElementById('lb-date').value = new Date().toISOString().slice(0, 10);
    ['lb-contractor', 'lb-count', 'lb-rate', 'lb-total', 'lb-paid', 'lb-notes'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('lb-trade').value = 'mason';
    document.getElementById('labor-modal-error').classList.add('hidden');
    openModal('labor-modal');
  });
  ['lb-count', 'lb-rate'].forEach((id) =>
    document.getElementById(id).addEventListener('input', () => {
      const count = parseFloat(document.getElementById('lb-count').value) || 0;
      const rate = parseFloat(document.getElementById('lb-rate').value) || 0;
      if (count && rate) document.getElementById('lb-total').value = (count * rate).toFixed(2);
    })
  );
  document.getElementById('lb-save').addEventListener('click', async () => {
    const errEl = document.getElementById('labor-modal-error');
    errEl.classList.add('hidden');
    const body = {
      project_id: Number(state.projectId),
      date: document.getElementById('lb-date').value,
      trade: document.getElementById('lb-trade').value,
      contractor_name: document.getElementById('lb-contractor').value.trim(),
      worker_count: parseInt(document.getElementById('lb-count').value) || 0,
      wage_rate: parseFloat(document.getElementById('lb-rate').value) || 0,
      amount_total: parseFloat(document.getElementById('lb-total').value) || 0,
      amount_paid: parseFloat(document.getElementById('lb-paid').value) || 0,
      notes: document.getElementById('lb-notes').value.trim(),
    };
    if (!body.date) {
      errEl.textContent = 'Date is required';
      errEl.classList.remove('hidden');
      return;
    }
    await api('/api/labor-entries', { method: 'POST', body: JSON.stringify(body) });
    closeModal('labor-modal');
    await loadLabor();
    await loadProject();
  });
}

// ==================== EQUIPMENT ====================

async function loadEquipment() {
  const rows = await api(`/api/equipment-entries?project_id=${state.projectId}`);
  const tbody = document.getElementById('equipment-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No equipment entries yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (e) => `<tr>
        <td>${e.equipment_name}</td><td>${e.vendor || '—'}</td><td>${formatDate(e.date_from)}</td><td>${formatDate(e.date_to)}</td>
        <td class="num">${formatCurrency(e.rate)}/${e.rate_unit.replace('per_', '')}</td>
        <td class="num">${formatCurrency(e.amount_total)}</td><td class="num">${formatCurrency(e.amount_paid)}</td>
        <td class="num ${e.amount_balance > 0 ? 'balance-due' : 'balance-clear'}">${formatCurrency(e.amount_balance)}</td>
        <td><button class="btn btn-small btn-danger delete-equipment" data-id="${e.id}">Delete</button></td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('.delete-equipment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this equipment entry?')) return;
      await api(`/api/equipment-entries/${btn.dataset.id}`, { method: 'DELETE' });
      await loadEquipment();
    });
  });
}

function setupEquipmentModal() {
  document.getElementById('new-equipment-btn').addEventListener('click', () => {
    ['eq-name', 'eq-vendor', 'eq-from', 'eq-to', 'eq-rate', 'eq-total', 'eq-paid', 'eq-notes'].forEach(
      (id) => (document.getElementById(id).value = '')
    );
    document.getElementById('eq-rate-unit').value = 'per_day';
    document.getElementById('equipment-modal-error').classList.add('hidden');
    openModal('equipment-modal');
  });
  document.getElementById('eq-save').addEventListener('click', async () => {
    const errEl = document.getElementById('equipment-modal-error');
    errEl.classList.add('hidden');
    const body = {
      project_id: Number(state.projectId),
      equipment_name: document.getElementById('eq-name').value.trim(),
      vendor: document.getElementById('eq-vendor').value.trim(),
      date_from: document.getElementById('eq-from').value || null,
      date_to: document.getElementById('eq-to').value || null,
      rate: parseFloat(document.getElementById('eq-rate').value) || 0,
      rate_unit: document.getElementById('eq-rate-unit').value,
      amount_total: parseFloat(document.getElementById('eq-total').value) || 0,
      amount_paid: parseFloat(document.getElementById('eq-paid').value) || 0,
      notes: document.getElementById('eq-notes').value.trim(),
    };
    if (!body.equipment_name) {
      errEl.textContent = 'Equipment name is required';
      errEl.classList.remove('hidden');
      return;
    }
    await api('/api/equipment-entries', { method: 'POST', body: JSON.stringify(body) });
    closeModal('equipment-modal');
    await loadEquipment();
    await loadProject();
  });
}

// ==================== FUNDING ====================

async function loadFunding() {
  const rows = await api(`/api/project-funding?project_id=${state.projectId}`);
  const tbody = document.getElementById('funding-tbody');
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No funding recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(
      (f) => `<tr>
        <td>${formatDate(f.date)}</td><td>${f.source}</td><td class="num">${formatCurrency(f.amount)}</td>
        <td><span class="mode-pill">${paymentModeLabel(f.payment_mode)}</span></td><td>${f.transaction_id || '—'}</td>
        <td>${f.remarks || '—'}</td>
        <td><button class="btn btn-small btn-danger delete-funding" data-id="${f.id}">Delete</button></td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('.delete-funding').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this funding entry?')) return;
      await api(`/api/project-funding/${btn.dataset.id}`, { method: 'DELETE' });
      await loadFunding();
      await loadProject();
    });
  });
}

function setupFundingModal() {
  document.getElementById('new-funding-btn').addEventListener('click', () => {
    document.getElementById('fd-date').value = new Date().toISOString().slice(0, 10);
    ['fd-amount', 'fd-transaction-id', 'fd-remarks'].forEach((id) => (document.getElementById(id).value = ''));
    document.getElementById('fd-source').value = 'client';
    document.getElementById('fd-mode').value = 'netbanking';
    document.getElementById('funding-modal-error').classList.add('hidden');
    openModal('funding-modal');
  });
  document.getElementById('fd-save').addEventListener('click', async () => {
    const errEl = document.getElementById('funding-modal-error');
    errEl.classList.add('hidden');
    const body = {
      project_id: Number(state.projectId),
      date: document.getElementById('fd-date').value,
      source: document.getElementById('fd-source').value,
      amount: parseFloat(document.getElementById('fd-amount').value) || 0,
      payment_mode: document.getElementById('fd-mode').value,
      transaction_id: document.getElementById('fd-transaction-id').value.trim(),
      remarks: document.getElementById('fd-remarks').value.trim(),
    };
    if (!body.date || !body.amount) {
      errEl.textContent = 'Date and amount are required';
      errEl.classList.remove('hidden');
      return;
    }
    await api('/api/project-funding', { method: 'POST', body: JSON.stringify(body) });
    closeModal('funding-modal');
    await loadFunding();
    await loadProject();
  });
}

boot();
