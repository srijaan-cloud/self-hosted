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
  setupShowcaseTab();
  setupReviewModal();

  if (!isInternalRole(state.me.role)) {
    // Viewer/guest: only the public showcase — internal tabs never even render,
    // and internal endpoints (materials/payments/dashboard/etc.) would 403 anyway.
    state.canWrite = false;
    document.querySelectorAll('.internal-tab').forEach((el) => el.classList.add('hidden'));
    document.getElementById('showcase-tab-btn').classList.add('active');
    document.getElementById('tab-showcase').classList.remove('hidden');
    await loadPublicProjectView();
    await loadShowcase();
    return;
  }

  state.canWrite = canWriteRole(state.me.role);
  if (!state.canWrite) {
    ['new-material-entry-btn', 'new-payment-btn', 'new-labor-btn', 'new-equipment-btn', 'new-funding-btn', 'new-review-btn'].forEach((id) =>
      document.getElementById(id).classList.add('hidden')
    );
  } else {
    document.querySelectorAll('.import-btn').forEach((btn) => btn.classList.remove('hidden'));
    document.getElementById('new-review-btn').classList.remove('hidden');
    document.getElementById('floor-plan-upload-wrap').classList.remove('hidden');
    document.getElementById('gallery-upload-wrap').classList.remove('hidden');
    document.getElementById('progress-upload-wrap').classList.remove('hidden');
    document.querySelectorAll('.upload-hint').forEach((el) => el.classList.remove('hidden'));
  }
  // Pricing is a core project field (PATCH /api/projects/:id), same director-only
  // gate as editing the project's name/budget/status — site_supervisors can manage
  // media/reviews for their project but not the published price.
  if (state.me.role === 'director') {
    document.getElementById('showcase-price-edit').classList.remove('hidden');
  }
  setupEditProjectModal();
  setupMaterialEntryModal();
  setupPaymentModal();
  setupLaborModal();
  setupEquipmentModal();
  setupFundingModal();
  setupImportModal();

  [state.materialTypes, state.vendors] = await Promise.all([api('/api/material-types'), api('/api/vendors')]);
  populateSelect('me-type', state.materialTypes, (t) => t.id, (t) => `${t.name} (${t.default_unit})`);
  populateSelect('mat-filter-type', state.materialTypes, (t) => t.id, (t) => t.name, true, 'All material types');
  populateSelect('me-vendor', state.vendors, (v) => v.id, (v) => v.name, true, '— None —');
  populateSelect('mat-filter-vendor', state.vendors, (v) => v.id, (v) => v.name, true, 'All vendors');
  document.getElementById('pay-mode').innerHTML = paymentModeOptionsHtml();
  document.getElementById('fd-mode').innerHTML = paymentModeOptionsHtml();

  if (state.me.role === 'director') {
    document.getElementById('edit-project-btn').classList.remove('hidden');
    document.getElementById('delete-project-btn').classList.remove('hidden');
    document.getElementById('delete-project-btn').addEventListener('click', async () => {
      if (
        !confirm(
          `Delete "${state.project.name}"? This permanently removes the project and everything in it — materials, payments, labor, equipment, funding, photos, reviews. This cannot be undone.`
        )
      )
        return;
      await api(`/api/projects/${state.projectId}`, { method: 'DELETE' });
      window.location.href = '/';
    });
  }

  await loadProject();
  await loadMaterials();
}

function populateSelect(id, items, valueFn, labelFn, withBlank, blankLabel) {
  const el = document.getElementById(id);
  const blank = withBlank ? `<option value="">${blankLabel}</option>` : '';
  el.innerHTML = blank + items.map((i) => `<option value="${valueFn(i)}">${labelFn(i)}</option>`).join('');
}

// ==================== TABS ====================

async function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-view').forEach((v) => v.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  if (tab === 'payments') await loadPayments();
  if (tab === 'labor') await loadLabor();
  if (tab === 'equipment') await loadEquipment();
  if (tab === 'funding') await loadFunding();
  if (tab === 'showcase') await loadShowcase();
}

function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

// ==================== PUBLIC SHOWCASE VIEW (viewer / guest) ====================

function renderDescriptionAndTimeline(p) {
  document.getElementById('showcase-description').textContent = p.description || 'No description provided.';
  document.getElementById('showcase-timeline').innerHTML =
    `Start: ${formatDate(p.start_date)} &nbsp;·&nbsp; Expected completion: ${formatDate(p.expected_end_date)}` +
    (p.actual_end_date ? ` &nbsp;·&nbsp; Actual completion: ${formatDate(p.actual_end_date)}` : '');
}

async function loadPublicProjectView() {
  const p = await api(`/api/public/projects/${state.projectId}`);
  state.project = p;
  document.title = `${p.name} — Tapasya Constructions`;
  document.getElementById('project-name').textContent = p.name;
  document.getElementById('project-meta').innerHTML =
    `${p.client_name || ''}${p.city ? ' · ' + p.city : ''} · <span class="status-pill status-${p.status}">${statusLabel(p.status)}</span>`;
  document.getElementById('project-kpi-row').innerHTML = '';
  document.getElementById('tab-overview').classList.add('hidden');
  document.getElementById('pricing-card').classList.add('hidden');
  renderDescriptionAndTimeline(p);
}

// ==================== OVERVIEW ====================

async function loadProject() {
  state.project = await api(`/api/projects/${state.projectId}`);
  const p = state.project;
  document.title = `${p.name} — Tapasya Constructions`;
  document.getElementById('project-name').textContent = p.name;
  document.getElementById('project-meta').innerHTML =
    `${p.client_name || ''}${p.city ? ' · ' + p.city : ''} · <span class="status-pill status-${p.status}">${statusLabel(p.status)}</span>` +
    (p.owner_phone ? ` · Owner: ${p.owner_phone}` : '');
  document.getElementById('project-description').textContent = p.description || 'No description provided.';
  document.getElementById('project-timeline').innerHTML =
    `Start: ${formatDate(p.start_date)} &nbsp;·&nbsp; Expected completion: ${formatDate(p.expected_end_date)}` +
    (p.actual_end_date ? ` &nbsp;·&nbsp; Actual completion: ${formatDate(p.actual_end_date)}` : '');
  renderDescriptionAndTimeline(p);

  const dash = await api('/api/dashboard');
  const summary = dash.projects.find((x) => String(x.id) === String(p.id));
  if (summary) {
    const pendingClass = summary.balance_due > 0 ? 'warn' : 'good';
    document.getElementById('project-kpi-row').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Budget</div><div class="kpi-value">${formatCurrency(summary.total_budget)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Funding Received</div><div class="kpi-value">${formatCurrency(summary.funding_received)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Committed</div><div class="kpi-value">${formatCurrency(summary.committed)}</div></div>
      <div class="kpi-card good kpi-link" id="kpi-paid"><div class="kpi-label">Paid</div><div class="kpi-value">${formatCurrency(summary.paid)}</div></div>
      <div class="kpi-card ${pendingClass}"><div class="kpi-label">Balance Due</div><div class="kpi-value">${formatCurrency(summary.balance_due)}</div></div>
    `;
    document.getElementById('kpi-paid').addEventListener('click', () => switchTab('payments'));
  }
}

function setupEditProjectModal() {
  ['ep-price-sqft', 'ep-total-area', 'ep-extra-cost'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('input', () => autoCalcBudget('ep'));
    el.addEventListener('change', () => autoCalcBudget('ep'));
  });

  document.getElementById('ep-cover-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('ep-cover-status');
    statusEl.textContent = 'Uploading…';
    statusEl.classList.remove('hidden');
    try {
      const key = await uploadFile(file);
      const media = await api(`/api/projects/${state.projectId}/media`, {
        method: 'POST',
        body: JSON.stringify({ category: 'gallery', image_key: key }),
      });
      await api(`/api/projects/${state.projectId}/cover`, { method: 'POST', body: JSON.stringify({ media_id: media.id }) });
      state.project.cover_media_id = media.id;
      state.project.cover_image_key = key;
      document.getElementById('ep-cover-preview').src = `/uploads/${key}`;
      document.getElementById('ep-cover-preview').classList.remove('hidden');
      statusEl.textContent = 'Display photo updated.';
    } catch (err) {
      statusEl.textContent = err.message;
    }
  });

  [
    ['ep-floorplan-file', 'ep-floorplan-status', 'floor_plan'],
    ['ep-progress-file', 'ep-progress-status', 'progress'],
  ].forEach(([fileId, statusId, category]) => {
    document.getElementById(fileId).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const statusEl = document.getElementById(statusId);
      statusEl.textContent = 'Uploading…';
      statusEl.classList.remove('hidden');
      try {
        const key = await uploadFile(file);
        await api(`/api/projects/${state.projectId}/media`, { method: 'POST', body: JSON.stringify({ category, image_key: key }) });
        statusEl.textContent = 'Added.';
        e.target.value = '';
      } catch (err) {
        statusEl.textContent = err.message;
      }
    });
  });

  document.getElementById('edit-project-btn').addEventListener('click', () => {
    const p = state.project;
    document.getElementById('ep-cover-file').value = '';
    document.getElementById('ep-cover-status').classList.add('hidden');
    ['ep-floorplan-file', 'ep-progress-file'].forEach((id) => (document.getElementById(id).value = ''));
    ['ep-floorplan-status', 'ep-progress-status'].forEach((id) => document.getElementById(id).classList.add('hidden'));
    const preview = document.getElementById('ep-cover-preview');
    if (p.cover_image_key) {
      preview.src = `/uploads/${p.cover_image_key}`;
      preview.classList.remove('hidden');
    } else {
      preview.classList.add('hidden');
    }
    document.getElementById('ep-name').value = p.name || '';
    document.getElementById('ep-client').value = p.client_name || '';
    document.getElementById('ep-city').value = p.city || '';
    document.getElementById('ep-address').value = p.site_address || '';
    document.getElementById('ep-start').value = p.start_date || '';
    document.getElementById('ep-end').value = p.expected_end_date || '';
    document.getElementById('ep-status').value = p.status;
    document.getElementById('ep-budget').value = p.total_budget;
    document.getElementById('ep-description').value = p.description || '';
    document.getElementById('ep-owner-phone').value = p.owner_phone || '';
    document.getElementById('ep-price-sqft').value = p.price_per_sqft || '';
    document.getElementById('ep-total-area').value = p.total_area_sqft || '';
    document.getElementById('ep-extra-cost').value = p.extra_cost || '';
    document.getElementById('ep-extra-cost-notes').value = p.extra_cost_notes || '';
    document.getElementById('ep-sold-price').value = p.sold_price_total || '';
    document.getElementById('ep-amenities').value = p.amenities || '';
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
      owner_phone: document.getElementById('ep-owner-phone').value.trim(),
      price_per_sqft: parseFloat(document.getElementById('ep-price-sqft').value) || null,
      total_area_sqft: parseFloat(document.getElementById('ep-total-area').value) || null,
      extra_cost: parseFloat(document.getElementById('ep-extra-cost').value) || 0,
      extra_cost_notes: document.getElementById('ep-extra-cost-notes').value.trim(),
      sold_price_total: parseFloat(document.getElementById('ep-sold-price').value) || null,
      amenities: document.getElementById('ep-amenities').value.trim(),
    };
    await api(`/api/projects/${state.projectId}`, { method: 'PATCH', body: JSON.stringify(body) });
    closeModal('edit-project-modal');
    await loadProject();
    renderDescriptionAndTimeline(state.project);
    if (document.getElementById('showcase-price-view')) renderPriceSummary(state.project);
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
        <td>${state.canWrite ? `<button class="btn btn-small btn-secondary edit-material" data-id="${m.id}">Edit</button>` : ''}</td>
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
      const key = await uploadFile(file);
      document.getElementById('me-bill-file').dataset.key = key;
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
        <td>${
          state.canWrite
            ? `<button class="btn btn-small btn-secondary edit-payment" data-id="${p.id}">Edit</button>
               <button class="btn btn-small btn-danger delete-payment" data-id="${p.id}">Delete</button>`
            : ''
        }</td>
      </tr>`;
    })
    .join('');
  tbody.querySelectorAll('.edit-payment').forEach((btn) => {
    btn.addEventListener('click', () => openPaymentModal(filtered.find((p) => p.id === Number(btn.dataset.id))));
  });
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

function openPaymentModal(payment) {
  document.getElementById('payment-modal-title').textContent = payment ? 'Edit Payment' : 'Add Payment';
  document.getElementById('pay-id').value = payment ? payment.id : '';
  document.getElementById('pay-date').value = payment ? payment.date : new Date().toISOString().slice(0, 10);
  document.getElementById('pay-amount').value = payment ? payment.amount : '';
  document.getElementById('pay-category').value = payment ? payment.category : 'material';
  document.getElementById('pay-mode').value = payment ? payment.payment_mode : 'cash';
  document.getElementById('pay-transaction-id').value = payment ? payment.transaction_id || '' : '';
  document.getElementById('pay-cheque-number').value = payment ? payment.cheque_number || '' : '';
  document.getElementById('pay-bank-name').value = payment ? payment.bank_name || '' : '';
  document.getElementById('pay-paid-to').value = payment ? payment.paid_to || '' : '';
  document.getElementById('pay-paid-to-account').value = payment ? payment.paid_to_account || '' : '';
  document.getElementById('pay-paid-by').value = payment ? payment.paid_by || '' : '';
  document.getElementById('pay-remarks').value = payment ? payment.remarks || '' : '';
  document.getElementById('pay-material-entry').value = payment && payment.material_entry_id ? payment.material_entry_id : '';
  document.getElementById('pay-receipt-file').value = '';
  delete document.getElementById('pay-receipt-file').dataset.key;
  document.getElementById('pay-upload-status').classList.add('hidden');
  document.getElementById('payment-modal-error').classList.add('hidden');
  togglePaymentModeFields();
  openModal('payment-modal');
}

function setupPaymentModal() {
  document.getElementById('new-payment-btn').addEventListener('click', () => openPaymentModal(null));

  document.getElementById('pay-mode').addEventListener('change', togglePaymentModeFields);

  document.getElementById('pay-receipt-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('pay-upload-status');
    statusEl.textContent = 'Uploading…';
    statusEl.classList.remove('hidden');
    try {
      const key = await uploadFile(file);
      document.getElementById('pay-receipt-file').dataset.key = key;
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
      paid_to_account: document.getElementById('pay-paid-to-account').value.trim(),
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
      const id = document.getElementById('pay-id').value;
      if (id) {
        await api(`/api/payments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/api/payments', { method: 'POST', body: JSON.stringify(body) });
      }
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
        <td>${
          state.canWrite
            ? `<button class="btn btn-small btn-secondary edit-labor" data-id="${l.id}">Edit</button>
               <button class="btn btn-small btn-danger delete-labor" data-id="${l.id}">Delete</button>`
            : ''
        }</td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('.edit-labor').forEach((btn) => {
    btn.addEventListener('click', () => openLaborModal(rows.find((l) => l.id === Number(btn.dataset.id))));
  });
  tbody.querySelectorAll('.delete-labor').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this labor entry?')) return;
      await api(`/api/labor-entries/${btn.dataset.id}`, { method: 'DELETE' });
      await loadLabor();
    });
  });
}

function openLaborModal(entry) {
  document.getElementById('labor-modal-title').textContent = entry ? 'Edit Labor Entry' : 'Add Labor Entry';
  document.getElementById('lb-id').value = entry ? entry.id : '';
  document.getElementById('lb-date').value = entry ? entry.date : new Date().toISOString().slice(0, 10);
  document.getElementById('lb-trade').value = entry ? entry.trade : 'mason';
  document.getElementById('lb-contractor').value = entry ? entry.contractor_name || '' : '';
  document.getElementById('lb-count').value = entry ? entry.worker_count : '';
  document.getElementById('lb-rate').value = entry ? entry.wage_rate : '';
  document.getElementById('lb-total').value = entry ? entry.amount_total : '';
  document.getElementById('lb-paid').value = entry ? entry.amount_paid : '';
  document.getElementById('lb-notes').value = entry ? entry.notes || '' : '';
  document.getElementById('labor-modal-error').classList.add('hidden');
  openModal('labor-modal');
}

function setupLaborModal() {
  document.getElementById('new-labor-btn').addEventListener('click', () => openLaborModal(null));
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
    const id = document.getElementById('lb-id').value;
    if (id) {
      await api(`/api/labor-entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await api('/api/labor-entries', { method: 'POST', body: JSON.stringify(body) });
    }
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
        <td>${
          state.canWrite
            ? `<button class="btn btn-small btn-secondary edit-equipment" data-id="${e.id}">Edit</button>
               <button class="btn btn-small btn-danger delete-equipment" data-id="${e.id}">Delete</button>`
            : ''
        }</td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('.edit-equipment').forEach((btn) => {
    btn.addEventListener('click', () => openEquipmentModal(rows.find((e) => e.id === Number(btn.dataset.id))));
  });
  tbody.querySelectorAll('.delete-equipment').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this equipment entry?')) return;
      await api(`/api/equipment-entries/${btn.dataset.id}`, { method: 'DELETE' });
      await loadEquipment();
    });
  });
}

function openEquipmentModal(entry) {
  document.getElementById('equipment-modal-title').textContent = entry ? 'Edit Equipment Entry' : 'Add Equipment Entry';
  document.getElementById('eq-id').value = entry ? entry.id : '';
  document.getElementById('eq-name').value = entry ? entry.equipment_name : '';
  document.getElementById('eq-vendor').value = entry ? entry.vendor || '' : '';
  document.getElementById('eq-from').value = entry ? entry.date_from || '' : '';
  document.getElementById('eq-to').value = entry ? entry.date_to || '' : '';
  document.getElementById('eq-rate').value = entry ? entry.rate : '';
  document.getElementById('eq-rate-unit').value = entry ? entry.rate_unit : 'per_day';
  document.getElementById('eq-total').value = entry ? entry.amount_total : '';
  document.getElementById('eq-paid').value = entry ? entry.amount_paid : '';
  document.getElementById('eq-notes').value = entry ? entry.notes || '' : '';
  document.getElementById('equipment-modal-error').classList.add('hidden');
  openModal('equipment-modal');
}

function setupEquipmentModal() {
  document.getElementById('new-equipment-btn').addEventListener('click', () => openEquipmentModal(null));
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
    const id = document.getElementById('eq-id').value;
    if (id) {
      await api(`/api/equipment-entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await api('/api/equipment-entries', { method: 'POST', body: JSON.stringify(body) });
    }
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
        <td>${
          state.canWrite
            ? `<button class="btn btn-small btn-secondary edit-funding" data-id="${f.id}">Edit</button>
               <button class="btn btn-small btn-danger delete-funding" data-id="${f.id}">Delete</button>`
            : ''
        }</td>
      </tr>`
    )
    .join('');
  tbody.querySelectorAll('.edit-funding').forEach((btn) => {
    btn.addEventListener('click', () => openFundingModal(rows.find((f) => f.id === Number(btn.dataset.id))));
  });
  tbody.querySelectorAll('.delete-funding').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this funding entry?')) return;
      await api(`/api/project-funding/${btn.dataset.id}`, { method: 'DELETE' });
      await loadFunding();
      await loadProject();
    });
  });
}

function openFundingModal(entry) {
  document.getElementById('funding-modal-title').textContent = entry ? 'Edit Funding Entry' : 'Add Funding Entry';
  document.getElementById('fd-id').value = entry ? entry.id : '';
  document.getElementById('fd-date').value = entry ? entry.date : new Date().toISOString().slice(0, 10);
  document.getElementById('fd-source').value = entry ? entry.source : 'client';
  document.getElementById('fd-amount').value = entry ? entry.amount : '';
  document.getElementById('fd-mode').value = entry ? entry.payment_mode : 'netbanking';
  document.getElementById('fd-transaction-id').value = entry ? entry.transaction_id || '' : '';
  document.getElementById('fd-remarks').value = entry ? entry.remarks || '' : '';
  document.getElementById('funding-modal-error').classList.add('hidden');
  openModal('funding-modal');
}

function setupFundingModal() {
  document.getElementById('new-funding-btn').addEventListener('click', () => openFundingModal(null));
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
    const id = document.getElementById('fd-id').value;
    if (id) {
      await api(`/api/project-funding/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await api('/api/project-funding', { method: 'POST', body: JSON.stringify(body) });
    }
    closeModal('funding-modal');
    await loadFunding();
    await loadProject();
  });
}

// ==================== SHOWCASE / PUBLIC PAGE ====================
// Shown to everyone (internal staff managing it, and viewers/guests reading it).
// Ongoing projects emphasize floor plans + progress photos; completed projects
// add customer reviews and the sold price / price-per-sqft summary.

function isCompleted() {
  return state.project && state.project.status === 'completed';
}

async function loadShowcase() {
  const p = state.project;
  renderPriceSummary(p);

  document.getElementById('progress-section').classList.toggle('hidden', isCompleted());
  document.getElementById('reviews-section').classList.toggle('hidden', !isCompleted());

  const [floorPlans, gallery, progress] = await Promise.all([
    api(`/api/projects/${state.projectId}/media?category=floor_plan`),
    api(`/api/projects/${state.projectId}/media?category=gallery`),
    api(`/api/projects/${state.projectId}/media?category=progress`),
  ]);
  renderMediaGallery('floor-plans-gallery', floorPlans);
  renderMediaGallery('gallery-photos-gallery', gallery);
  renderMediaGallery('progress-gallery', progress);

  if (isCompleted()) {
    const reviews = await api(`/api/projects/${state.projectId}/reviews`);
    renderReviews(reviews);
  }
}

function renderPriceSummary(p) {
  const items = [];
  if (p.price_per_sqft) items.push(['Price per Sq.ft', formatCurrency(p.price_per_sqft)]);
  if (p.total_area_sqft) items.push(['Total Area', `${p.total_area_sqft.toLocaleString('en-IN')} sq.ft`]);
  if (isCompleted() && p.sold_price_total) items.push(['Sold Price', formatCurrency(p.sold_price_total)]);
  const view = document.getElementById('showcase-price-view');
  view.innerHTML =
    items.length === 0
      ? '<p class="empty-state">No pricing published yet.</p>'
      : items.map(([label, value]) => `<div class="ps-item"><div class="ps-label">${label}</div><div class="ps-value">${value}</div></div>`).join('');
  if (p.amenities) {
    view.innerHTML += `<div class="ps-item full" style="grid-column:1/-1;"><div class="ps-label">Amenities</div><div class="ps-value" style="font-size:0.9rem;">${p.amenities}</div></div>`;
  }
  if (document.getElementById('sh-price-sqft')) {
    document.getElementById('sh-price-sqft').value = p.price_per_sqft || '';
    document.getElementById('sh-total-area').value = p.total_area_sqft || '';
    document.getElementById('sh-sold-price').value = p.sold_price_total || '';
    document.getElementById('sh-amenities').value = p.amenities || '';
  }
}

function renderMediaGallery(containerId, items) {
  const el = document.getElementById(containerId);
  if (items.length === 0) {
    el.innerHTML = '<p class="empty-state">None uploaded yet.</p>';
    return;
  }
  const coverId = state.project.cover_media_id;
  el.innerHTML = items
    .map((m) => {
      const isCover = coverId && Number(coverId) === m.id;
      return `<div class="media-item">
        <img src="/uploads/${m.image_key}" alt="${m.title || ''}" style="${isCover ? `outline:3px solid var(--accent); outline-offset:-3px;` : ''}" />
        ${state.canWrite ? `<button class="media-remove remove-media" data-id="${m.id}">✕</button>` : ''}
        ${
          state.canWrite
            ? isCover
              ? `<div class="media-caption" style="color:var(--accent); font-weight:600;">★ Display Photo</div>`
              : `<button class="btn btn-small btn-secondary set-cover" data-id="${m.id}" style="margin-top:6px;">Set as Display Photo</button>`
            : ''
        }
        ${m.caption ? `<div class="media-caption">${m.caption}</div>` : ''}
      </div>`;
    })
    .join('');
  el.querySelectorAll('.remove-media').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this image?')) return;
      await api(`/api/projects/${state.projectId}/media/${btn.dataset.id}`, { method: 'DELETE' });
      await loadShowcase();
    });
  });
  el.querySelectorAll('.set-cover').forEach((btn) => {
    btn.addEventListener('click', () => setCoverPhoto(Number(btn.dataset.id)));
  });
}

async function setCoverPhoto(mediaId) {
  await api(`/api/projects/${state.projectId}/cover`, { method: 'POST', body: JSON.stringify({ media_id: mediaId }) });
  state.project = await api(`/api/projects/${state.projectId}`);
  await loadShowcase();
}

function renderReviews(reviews) {
  const el = document.getElementById('reviews-list');
  if (reviews.length === 0) {
    el.innerHTML = '<p class="empty-state">No reviews yet.</p>';
    return;
  }
  el.innerHTML = reviews
    .map(
      (r) => `<div class="review-card">
        <div class="rc-top">
          <span class="rc-name">${r.customer_name}${r.date ? ' — ' + formatDate(r.date) : ''}</span>
          <span class="rc-stars">${starRating(r.rating)}</span>
        </div>
        ${r.review_text ? `<div class="rc-text">${r.review_text}</div>` : ''}
        ${state.canWrite ? `<button class="btn btn-small btn-danger remove-review" data-id="${r.id}" style="margin-top:8px;">Delete</button>` : ''}
      </div>`
    )
    .join('');
  el.querySelectorAll('.remove-review').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this review?')) return;
      await api(`/api/projects/${state.projectId}/reviews/${btn.dataset.id}`, { method: 'DELETE' });
      await loadShowcase();
    });
  });
}

async function uploadMedia(fileInput, category) {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const key = await uploadFile(file);
    await api(`/api/projects/${state.projectId}/media`, {
      method: 'POST',
      body: JSON.stringify({ category, image_key: key }),
    });
  } catch (err) {
    alert(err.message);
    return;
  }
  fileInput.value = '';
  await loadShowcase();
}

function setupShowcaseTab() {
  const floorPlanInput = document.getElementById('floor-plan-file');
  if (floorPlanInput) floorPlanInput.addEventListener('change', () => uploadMedia(floorPlanInput, 'floor_plan'));
  const galleryInput = document.getElementById('gallery-file');
  if (galleryInput) galleryInput.addEventListener('change', () => uploadMedia(galleryInput, 'gallery'));
  const progressInput = document.getElementById('progress-file');
  if (progressInput) progressInput.addEventListener('change', () => uploadMedia(progressInput, 'progress'));

  const priceSave = document.getElementById('sh-price-save');
  if (priceSave) {
    priceSave.addEventListener('click', async () => {
      await api(`/api/projects/${state.projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          price_per_sqft: parseFloat(document.getElementById('sh-price-sqft').value) || null,
          total_area_sqft: parseFloat(document.getElementById('sh-total-area').value) || null,
          sold_price_total: parseFloat(document.getElementById('sh-sold-price').value) || null,
          amenities: document.getElementById('sh-amenities').value.trim(),
        }),
      });
      state.project = await api(`/api/projects/${state.projectId}`);
      renderPriceSummary(state.project);
    });
  }
}

function setupReviewModal() {
  const btn = document.getElementById('new-review-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    document.getElementById('rv-name').value = '';
    document.getElementById('rv-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('rv-rating').value = '5';
    document.getElementById('rv-text').value = '';
    document.getElementById('review-modal-error').classList.add('hidden');
    openModal('review-modal');
  });
  document.getElementById('rv-save').addEventListener('click', async () => {
    const errEl = document.getElementById('review-modal-error');
    errEl.classList.add('hidden');
    const body = {
      customer_name: document.getElementById('rv-name').value.trim(),
      date: document.getElementById('rv-date').value,
      rating: Number(document.getElementById('rv-rating').value),
      review_text: document.getElementById('rv-text').value.trim(),
    };
    if (!body.customer_name) {
      errEl.textContent = 'Customer name is required';
      errEl.classList.remove('hidden');
      return;
    }
    await api(`/api/projects/${state.projectId}/reviews`, { method: 'POST', body: JSON.stringify(body) });
    closeModal('review-modal');
    await loadShowcase();
  });
}

// ==================== IMPORT (Google Sheet / Excel / CSV) ====================
// One shared modal reused from every tab's "Import from Sheet / Excel" button —
// the entity type comes from the button that opened it, so the same backend
// endpoint and UI work for materials, payments, labor, equipment, or funding.

const IMPORT_RELOADERS = {
  material_entries: loadMaterials,
  payments: loadPayments,
  labor_entries: loadLabor,
  equipment_entries: loadEquipment,
  project_funding: loadFunding,
};
const IMPORT_ENTITY_LABELS = {
  material_entries: 'Material Entries',
  payments: 'Payments',
  labor_entries: 'Labor Entries',
  equipment_entries: 'Equipment Entries',
  project_funding: 'Funding',
};

function setupImportModal() {
  let currentEntity = null;

  document.querySelectorAll('.import-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentEntity = btn.dataset.entity;
      document.getElementById('import-modal-title').textContent = `Import ${IMPORT_ENTITY_LABELS[currentEntity]}`;
      document.getElementById('im-sheet-url').value = '';
      document.getElementById('im-sheet-tab').value = '';
      document.getElementById('im-file').value = '';
      document.getElementById('import-modal-error').classList.add('hidden');
      document.getElementById('import-result').classList.add('hidden');
      openModal('import-modal');
    });
  });

  document.getElementById('im-run').addEventListener('click', async () => {
    const errEl = document.getElementById('import-modal-error');
    const resultEl = document.getElementById('import-result');
    errEl.classList.add('hidden');
    resultEl.classList.add('hidden');

    const sheetUrl = document.getElementById('im-sheet-url').value.trim();
    const sheetTab = document.getElementById('im-sheet-tab').value.trim();
    const file = document.getElementById('im-file').files[0];
    if (!sheetUrl && !file) {
      errEl.textContent = 'Paste a Google Sheet link or choose a file to upload';
      errEl.classList.remove('hidden');
      return;
    }

    const form = new FormData();
    form.append('entity_type', currentEntity);
    if (file) form.append('file', file);
    else {
      form.append('sheet_url', sheetUrl);
      if (sheetTab) form.append('sheet_tab', sheetTab);
    }

    const runBtn = document.getElementById('im-run');
    runBtn.disabled = true;
    runBtn.textContent = 'Importing…';
    try {
      const res = await fetch(`/api/projects/${state.projectId}/import`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Import failed');

      const parts = [`Imported ${data.imported} row(s).`];
      if (data.skipped.length) parts.push(`Skipped ${data.skipped.length} row(s) (missing required fields).`);
      if (data.warnings.length) parts.push(`${data.warnings.length} row(s) had an ambiguous date and were assumed DD/MM.`);
      if (data.createdMaterialTypes?.length) parts.push(`New material types: ${data.createdMaterialTypes.join(', ')}.`);
      if (data.createdVendors?.length) parts.push(`New vendors: ${data.createdVendors.join(', ')}.`);
      resultEl.textContent = parts.join(' ');
      resultEl.classList.remove('hidden');

      await IMPORT_RELOADERS[currentEntity]();
      if (currentEntity === 'material_entries') {
        [state.materialTypes, state.vendors] = await Promise.all([api('/api/material-types'), api('/api/vendors')]);
        populateSelect('me-type', state.materialTypes, (t) => t.id, (t) => `${t.name} (${t.default_unit})`);
        populateSelect('mat-filter-type', state.materialTypes, (t) => t.id, (t) => t.name, true, 'All material types');
        populateSelect('me-vendor', state.vendors, (v) => v.id, (v) => v.name, true, '— None —');
        populateSelect('mat-filter-vendor', state.vendors, (v) => v.id, (v) => v.name, true, 'All vendors');
      }
      await loadProject();
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Import';
    }
  });
}

boot();
