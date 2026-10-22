// طبقة الدمج: بتحوّل سجلات FSIS والعضوي لشكل واحد وبتدمج نفس المنشأة (اسم معيّر + رمز بريدي)
const STOP = new Set('llc inc incorporated corp corporation co company ltd lp llp the'.split(' '));
function nameKey(s) {
  const w = String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (w.length > 1 && STOP.has(w[w.length - 1])) w.pop();
  return w.join(' ');
}
function keysOf(names, zip) {
  const z = String(zip || '').slice(0, 5), out = new Set();
  if (!z) return [];
  names.forEach((n) => String(n || '').split(/\s+(?:dba|d\/b\/a)\s+/i).forEach((p) => { const k = nameKey(p); if (k) out.add(k + '|' + z); }));
  return [...out];
}
const county = (c) => String(c || '').replace(/\s+county$/i, '').trim() || null;
const PL = { meat: 'meat', poultry: 'poultry', egg: 'egg products', rabbit: 'rabbit' };
const SCOPE = { crops: 'محاصيل', livestock: 'ثروة حيوانية', wild: 'نباتات برية', handling: 'تصنيع وتداول' };
function fromFsis(x, src) {
  const a = x.address;
  return { names: [x.name].concat(x.dbas), name: x.name, city: a.city, county: county(a.county), zip: a.zip, street: a.street, lat: a.lat, lon: a.lon,
    phone: x.phone, email: null, website: null, contact: null, certifier: null, text: [x.products.map((p) => PL[p]).join(', '), x.activities.join('; ')].filter(Boolean).join(' | '),
    tags: ['لحوم ودواجن وبيض'], from: ['fsis'], sources: [src], ids: [x.id] };
}
function fromOrg(x, src) {
  const a = x.address;
  return { names: [x.name].concat(x.dbas), name: x.name, city: a.city, county: county(a.county), zip: a.zip, street: a.street, lat: null, lon: null,
    phone: x.phone, email: x.email, website: x.website, contact: x.contact, certifier: x.certifier, text: Object.values(x.products).join(' | '),
    tags: ['عضوي'].concat(x.scopes.map((s) => SCOPE[s])), from: ['org'], sources: [src], ids: [x.id], mailing: a.type === 'mailing' };
}
function absorb(t, r) {
  ['county', 'street', 'lat', 'lon', 'phone', 'email', 'website', 'contact', 'certifier'].forEach((k) => { if (t[k] == null && r[k] != null) t[k] = r[k]; });
  if (t.mailing && !r.mailing) { t.street = r.street; t.mailing = false; }
  t.text = [t.text, r.text].filter(Boolean).join(' | ');
  r.tags.forEach((g) => { if (!t.tags.includes(g)) t.tags.push(g); });
  r.from.forEach((f) => { if (!t.from.includes(f)) t.from.push(f); });
  r.sources.forEach((s) => { if (!t.sources.some((u) => u.name === s.name)) t.sources.push(s); });
  t.names.push(...r.names); t.ids.push(...r.ids);
}
function buildAll(fsis, org) {
  const all = [], index = new Map();
  const recs = fsis.items.map((x) => fromFsis(x, fsis.source)).concat(org.items.map((x) => fromOrg(x, org.meta.source)));
  for (const r of recs) {
    const ks = keysOf(r.names, r.zip), hit = ks.map((k) => index.get(k)).find(Boolean);
    if (hit) absorb(hit, r); else all.push(r);
    const t = hit || r;
    keysOf(t.names, t.zip).forEach((k) => index.set(k, t));
  }
  all.forEach((r) => { r.hay = (r.name + ' ' + r.names.join(' ') + ' ' + r.city + ' ' + r.text).toLowerCase(); });
  return all.sort((a, b) => a.name.localeCompare(b.name));
}
