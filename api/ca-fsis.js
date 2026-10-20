// Vercel serverless function - منشآت كاليفورنيا من ملف FSIS MPI (ملف CSV الموجود في الريبو)
// /api/ca-fsis   (وبيتفتح كمان من /ca-fsis.json عن طريق vercel.json)
// لما يتحدّث ملف الـCSV: غيّر التواريخ في SOURCE تحت

const BASE = 'https://true-live-sec-v32.vercel.app';
const FILES = ['MPI_Directory_by_Establishment_Number.csv', 'MPI_Directory_by_Establishment_Name.csv'];
const SOURCE = {
  name: 'USDA FSIS MPI Directory',
  url: 'https://www.fsis.usda.gov/inspection/establishments/meat-poultry-and-egg-product-inspection-directory',
  license: 'CC0 (as listed on data.gov)',
  dataDate: '2026-10-19',
  collectedAt: '2026-10-20'
};
const PRODUCER = /slaughter|processing|egg product/i;

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const list = (v) => v.split(';').map((t) => t.trim()).filter(Boolean);

export function toRecords(rows) {
  const h = rows[0].map((x) => x.trim());
  const items = [];
  for (const r of rows.slice(1)) {
    const o = {};
    h.forEach((k, i) => { o[k] = (r[i] || '').trim(); });
    if (o.state !== 'CA') continue;
    const acts = list(o.activities), s = acts.join(' ').toLowerCase();
    items.push({
      id: 'fsis:' + o.establishment_id,
      name: o.establishment_name,
      dbas: list(o.dbas),
      kind: acts.some((t) => PRODUCER.test(t)) ? 'producer' : 'service',
      activities: acts,
      products: ['meat', 'poultry', 'rabbit', 'egg'].filter((p) => s.includes(p)),
      size: o.size === '' || o.size === 'N / A' ? null : o.size,
      phone: o.phone || null,
      address: { street: o.street, city: o.city, state: 'CA', zip: o.zip, county: o.county, fips: o.fips_code, lat: num(o.latitude), lon: num(o.longitude) },
      establishmentNumber: o.establishment_number,
      duns: o.duns_number || null,
      grantDate: o.grant_date || null,
      status: 'Discovered',
      source: SOURCE
    });
  }
  return items;
  }
