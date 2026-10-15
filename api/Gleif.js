// Vercel serverless function - GLEIF (مرحلة تشخيص: بنرجّع الشكل الخام علشان نتأكد من البنية)
// /api/gleif?type=suggest&q=ford
// /api/gleif?type=record&lei=XXXXXXXXXXXXXXXXXXXX

const BASE = 'https://api.gleif.org/api/v1';
const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';
const TYPES = ['suggest', 'record'];

export default async function handler(req, res) {
  const type = String(req.query.type || '');
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
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
    const r = await fetch(url, {
      headers: { Accept: 'application/vnd.api+json', 'User-Agent': UA }
    });
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
