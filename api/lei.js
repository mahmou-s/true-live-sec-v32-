// Vercel serverless function - GLEIF (مرحلة تشخيص)
// /api/lei?type=probe&q=ford      (يجرّب كذا طريقة بحث ويرجّع ملخص صغير)
// /api/lei?type=suggest&q=ford    (الرد الخام)
// /api/lei?type=record&lei=XXXXXXXXXXXXXXXXXXXX

const BASE = 'https://api.gleif.org/api/v1';
const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';
const TYPES = ['suggest', 'record', 'probe'];
const HEADERS = { Accept: 'application/vnd.api+json', 'User-Agent': UA };

function summarize(j) {
  const d = j && j.data;
  const arr = Array.isArray(d) ? d : d ? [d] : [];
  const f = arr[0];
  return {
    n: arr.length,
    total: j?.meta?.pagination?.total ?? null,
    first: f
      ? {
          id: f.id,
          type: f.type,
          attrKeys: Object.keys(f.attributes || {}).slice(0, 12),
          name: f.attributes?.entity?.legalName?.name ?? f.attributes?.value ?? null,
          relKeys: Object.keys(f.relationships || {}).slice(0, 8)
        }
      : null
  };
}

async function tryUrl(label, url) {
  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return { label, status: r.status };
    const j = await r.json();
    return { label, status: r.status, ...summarize(j) };
  } catch (e) {
    return { label, error: String(e.message || e).slice(0, 120) };
  }
}

export default async function handler(req, res) {
  const type = String(req.query.type || '');
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  if (type === 'probe') {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.status(400).json({ error: 'q too short' });
    const e = encodeURIComponent(q);
    const tests = [
      ['fuzzy entity.legalName', `${BASE}/fuzzycompletions?field=entity.legalName&q=${e}`],
      ['fuzzy fulltext', `${BASE}/fuzzycompletions?field=fulltext&q=${e}`],
      ['auto fullName', `${BASE}/autocompletions?field=fullName&q=${e}`],
      ['auto entity.legalName', `${BASE}/autocompletions?field=entity.legalName&q=${e}`],
      ['records fulltext', `${BASE}/lei-records?filter%5Bfulltext%5D=${e}&page%5Bsize%5D=5`],
      ['records legalName exact', `${BASE}/lei-records?filter%5Bentity.legalName%5D=${e}&page%5Bsize%5D=5`]
    ];
    const results = await Promise.all(tests.map(([l, u]) => tryUrl(l, u)));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ q, results });
  }

  let url;
  if (type === 'suggest') {
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q.length < 2) return res.status(400).json({ error: 'q too short' });
    url = `${BASE}/fuzzycompletions?field=entity.legalName&q=${encodeURIComponent(q)}`;
  } else {
    const lei = String(req.query.lei || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{20}$/.test(lei)) return res.status(400).json({ error: 'Invalid LEI' });
    url = `${BASE}/lei-records/${lei}`;
  }

  try {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) {
      return res.status(r.status).json({ error: `GLEIF ${r.status}` });
    }
    const data = await r.json();

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

    if (type === 'suggest') {
      const cut = (x, n) => (Array.isArray(x) ? x.slice(0, n) : x);
      return res.status(200).json({ raw: { ...data, data: cut(data.data, 8), included: cut(data.included, 5) } });
    }
    return res.status(200).json({ raw: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
