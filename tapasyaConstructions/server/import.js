// Generic "import from Google Sheet / Excel" pipeline, usable for any project and
// any of the tracked entity types. Column matching is by normalized header name
// (aliases below), not fixed position, so it tolerates real-world sheets that don't
// exactly match our schema.
import ExcelJS from 'exceljs';

export function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

export async function parseXlsxBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row) => {
    // row.values is 1-indexed with a leading empty slot — drop it.
    const vals = row.values.slice(1).map((v) => {
      if (v instanceof Date) return v;
      if (v && typeof v === 'object' && 'text' in v) return v.text; // rich text
      if (v && typeof v === 'object' && 'result' in v) return v.result; // formula
      return v;
    });
    rows.push(vals);
  });
  return rows;
}

// Extracts { id, gid, sheetName } from a pasted Google Sheets URL.
export function parseSheetUrl(url) {
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;
  const id = idMatch[1];
  const gidMatch = url.match(/[?&#]gid=(\d+)/);
  return { id, gid: gidMatch ? gidMatch[1] : null };
}

export async function fetchGoogleSheetCsv(url, sheetName) {
  const info = parseSheetUrl(url);
  if (!info) throw new Error('Not a recognizable Google Sheets URL');
  const exportUrl = sheetName
    ? `https://docs.google.com/spreadsheets/d/${info.id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
    : `https://docs.google.com/spreadsheets/d/${info.id}/export?format=csv${info.gid ? `&gid=${info.gid}` : ''}`;
  const res = await fetch(exportUrl);
  if (!res.ok) throw new Error(`Could not fetch sheet (HTTP ${res.status}) — make sure it's shared as "Anyone with the link can view"`);
  const text = await res.text();
  if (/^<!DOCTYPE html/i.test(text.trim())) throw new Error('Sheet is not publicly viewable — share it as "Anyone with the link can view" and try again');
  return text;
}

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function excelDateToISO(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parses "DD/MM/YYYY"-ish strings with the same day>12/month>12 disambiguation
// used for the real bank-statement import, defaulting to DD/MM when ambiguous
// (matches how these sheets are typically produced in India).
function parseDateString(str) {
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { iso: s.slice(0, 10), ambiguous: false };
  const parts = s.split(/[/-]/);
  if (parts.length !== 3) return null;
  let [a, b, year] = parts.map((p) => p.trim());
  a = parseInt(a, 10); b = parseInt(b, 10);
  if (!a || !b || !year) return null;
  if (year.length === 2) year = '20' + year;
  let day, month, ambiguous = false;
  if (a > 12) { day = a; month = b; }
  else if (b > 12) { month = a; day = b; }
  else { day = a; month = b; ambiguous = true; }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, ambiguous };
}

function toDateISO(value) {
  if (value instanceof Date) return { iso: excelDateToISO(value), ambiguous: false };
  if (value == null || value === '') return null;
  return parseDateString(value);
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  const n = parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function inferPaymentMode(hintText) {
  const s = String(hintText || '').toLowerCase();
  if (!s || s === 'cash') return 'cash';
  if (s.includes('gpay') || s.includes('g-pay') || s.includes('google pay')) return 'gpay';
  if (s.includes('phonepe')) return 'phonepe';
  if (s.includes('cheque') || s.includes('check')) return 'cheque';
  if (s.includes('card')) return 'card';
  if (s.includes('netbank')) return 'netbanking';
  return 'bank_transfer';
}

function inferCategory(text) {
  const p = String(text || '').toLowerCase();
  if (/steel|cement|rmc|granite|tiles?|brick|putty|sand|marble/.test(p)) return 'material';
  if (/site engineer|site supervisor|engineer|supervisor|centring|labor|labour|mason|carpenter|worker|structural/.test(p)) return 'labor';
  if (/transport/.test(p)) return 'transport';
  if (/advance/.test(p)) return 'advance';
  return 'misc';
}

// Each entity schema: `fields` maps our column name -> array of header aliases
// (normalized) to match against. `build(get)` returns the row to insert, or null
// to skip; `get(field)` returns the matched raw cell value for that field, or
// undefined; `getRaw(...aliases)` looks up any header by alias directly (used for
// inference sources that aren't stored fields, like "To Account Number").
const ENTITY_SCHEMAS = {
  payments: {
    table: 'payments',
    fields: {
      date: ['date'],
      amount: ['amount', 'amt'],
      paid_by: ['fromaccountname', 'paidby', 'from', 'paidfrom'],
      paid_to: ['toaccountname', 'paidto', 'to'],
      remarks: ['purpose', 'remarks', 'description', 'narration', 'notes'],
      transaction_id: ['txnid', 'transactionid', 'reference', 'utr', 'refno'],
      payment_mode: ['paymentmode', 'mode'],
      category: ['category'],
      cheque_number: ['chequenumber', 'chequeno'],
      bank_name: ['bankname', 'bank'],
      paid_to_account: ['toaccountnumber', 'accountnumber'],
    },
    build(get, getRaw, warn) {
      const date = toDateISO(get('date'));
      const amount = toNumber(get('amount'));
      if (!date || !amount) return null;
      if (date.ambiguous) warn('ambiguous date format, assumed DD/MM');
      const txn = get('transaction_id');
      const account = get('paid_to_account');
      return {
        date: date.iso,
        amount,
        category: get('category') || inferCategory(get('remarks')),
        payment_mode: get('payment_mode') || inferPaymentMode(account),
        transaction_id: txn && String(txn).trim().toLowerCase() !== 'cash' ? String(txn).trim() : null,
        cheque_number: get('cheque_number') || null,
        bank_name: get('bank_name') || null,
        paid_by: get('paid_by') || null,
        paid_to: get('paid_to') || null,
        paid_to_account: account && String(account).trim().toLowerCase() !== 'cash' ? String(account).trim() : null,
        remarks: get('remarks') || null,
      };
    },
  },
  material_entries: {
    table: 'material_entries',
    fields: {
      date: ['date'],
      material_type: ['materialtype', 'material', 'item', 'type'],
      vendor: ['vendor', 'supplier', 'vendorname'],
      quantity_ordered: ['quantity', 'quantityordered', 'qty'],
      unit: ['unit', 'uom'],
      rate_per_unit: ['rate', 'rateperunit', 'price'],
      amount_total: ['amount', 'amounttotal', 'total'],
      invoice_number: ['invoice', 'invoicenumber', 'billno'],
      notes: ['notes', 'remarks'],
    },
    build(get, getRaw, warn) {
      const date = toDateISO(get('date'));
      const amount = toNumber(get('amount_total'));
      if (!date) return null;
      if (date.ambiguous) warn('ambiguous date format, assumed DD/MM');
      return {
        date: date.iso,
        material_type: get('material_type') || 'Other',
        vendor: get('vendor') || null,
        quantity_ordered: toNumber(get('quantity_ordered')) ?? 0,
        unit: get('unit') || null,
        rate_per_unit: toNumber(get('rate_per_unit')) ?? 0,
        amount_total: amount ?? 0,
        invoice_number: get('invoice_number') || null,
        notes: get('notes') || null,
      };
    },
  },
  labor_entries: {
    table: 'labor_entries',
    fields: {
      date: ['date'],
      trade: ['trade', 'role'],
      contractor_name: ['contractor', 'contractorname', 'name'],
      worker_count: ['workers', 'workercount', 'count'],
      wage_rate: ['wagerate', 'rate', 'wage'],
      amount_total: ['amount', 'amounttotal', 'total'],
      amount_paid: ['paid', 'amountpaid'],
      notes: ['notes', 'remarks'],
    },
    build(get, getRaw, warn) {
      const date = toDateISO(get('date'));
      if (!date) return null;
      if (date.ambiguous) warn('ambiguous date format, assumed DD/MM');
      return {
        date: date.iso,
        trade: get('trade') || 'other',
        contractor_name: get('contractor_name') || null,
        worker_count: toNumber(get('worker_count')) ?? 1,
        wage_rate: toNumber(get('wage_rate')) ?? 0,
        amount_total: toNumber(get('amount_total')) ?? 0,
        amount_paid: toNumber(get('amount_paid')) ?? 0,
        notes: get('notes') || null,
      };
    },
  },
  equipment_entries: {
    table: 'equipment_entries',
    fields: {
      equipment_name: ['equipment', 'equipmentname', 'name'],
      vendor: ['vendor', 'supplier'],
      date_from: ['datefrom', 'from', 'startdate'],
      date_to: ['dateto', 'to', 'enddate'],
      rate: ['rate'],
      rate_unit: ['rateunit', 'unit'],
      amount_total: ['amount', 'amounttotal', 'total'],
      amount_paid: ['paid', 'amountpaid'],
      notes: ['notes', 'remarks'],
    },
    build(get, getRaw, warn) {
      const from = toDateISO(get('date_from'));
      if (!from) return null;
      if (from.ambiguous) warn('ambiguous date format, assumed DD/MM');
      const to = toDateISO(get('date_to'));
      return {
        equipment_name: get('equipment_name') || 'Equipment',
        vendor: get('vendor') || null,
        date_from: from.iso,
        date_to: to ? to.iso : from.iso,
        rate: toNumber(get('rate')) ?? 0,
        rate_unit: get('rate_unit') || 'per_day',
        amount_total: toNumber(get('amount_total')) ?? 0,
        amount_paid: toNumber(get('amount_paid')) ?? 0,
        notes: get('notes') || null,
      };
    },
  },
  project_funding: {
    table: 'project_funding',
    fields: {
      date: ['date'],
      source: ['source', 'from'],
      amount: ['amount'],
      payment_mode: ['paymentmode', 'mode'],
      transaction_id: ['txnid', 'transactionid', 'reference'],
      remarks: ['remarks', 'notes', 'purpose'],
    },
    build(get, getRaw, warn) {
      const date = toDateISO(get('date'));
      const amount = toNumber(get('amount'));
      if (!date || !amount) return null;
      if (date.ambiguous) warn('ambiguous date format, assumed DD/MM');
      return {
        date: date.iso,
        source: get('source') || 'client',
        amount,
        payment_mode: get('payment_mode') || 'bank_transfer',
        transaction_id: get('transaction_id') || null,
        remarks: get('remarks') || null,
      };
    },
  },
};

export const IMPORTABLE_ENTITY_TYPES = Object.keys(ENTITY_SCHEMAS);

function buildHeaderIndex(headerRow, schema) {
  const normalized = headerRow.map(normalizeHeader);
  const fieldIndex = {};
  for (const [field, aliases] of Object.entries(schema.fields)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) fieldIndex[field] = idx;
  }
  const inferenceIndex = {};
  for (const [name, aliases] of Object.entries(schema.inferenceAliases || {})) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) inferenceIndex[name] = idx;
  }
  return { fieldIndex, inferenceIndex };
}

// rowsAoA: array of arrays, first row is the header. Returns mapped records plus
// per-row warnings/skips for the caller to report back to the user.
export function mapRows(rowsAoA, entityType) {
  const schema = ENTITY_SCHEMAS[entityType];
  if (!schema) throw new Error(`Unknown import type: ${entityType}`);
  if (!rowsAoA.length) return { records: [], skipped: [], matchedFields: [], unmatchedHeaders: [] };
  const [headerRow, ...dataRows] = rowsAoA;
  const { fieldIndex, inferenceIndex } = buildHeaderIndex(headerRow, schema);
  const matchedFields = Object.keys(fieldIndex);
  const unmatchedHeaders = headerRow.filter((_, i) => !Object.values(fieldIndex).includes(i) && !Object.values(inferenceIndex).includes(i));

  const records = [];
  const skipped = [];
  dataRows.forEach((row, i) => {
    if (row.every((v) => v == null || v === '')) return; // blank row
    const warnings = [];
    const get = (field) => (field in fieldIndex ? row[fieldIndex[field]] : undefined);
    const getRaw = (name) => (name in inferenceIndex ? row[inferenceIndex[name]] : undefined);
    const warn = (msg) => warnings.push(msg);
    let rec;
    try {
      rec = schema.build(get, getRaw, warn);
    } catch (e) {
      skipped.push({ row: i + 2, reason: e.message });
      return;
    }
    if (!rec) { skipped.push({ row: i + 2, reason: 'missing required fields (date/amount)' }); return; }
    records.push({ rec, warnings, row: i + 2 });
  });

  return { records, skipped, matchedFields, unmatchedHeaders, table: schema.table };
}
