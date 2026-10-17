// Vercel serverless function - USDA NASS Quick Stats
// /api/nass?state=IA&county=POLK&commodity=CORN
// المفتاح من متغير البيئة NASS_API_KEY (مش داخل الكود)

const BASE = 'https://quickstats.nass.usda.gov/api/api_GET/';
const METRICS = ['AREA HARVESTED', 'AREA PLANTED', 'PRODUCTION', 'YIELD'];
const ATTRIBUTION = 'This product uses the NASS API but is not endorsed or certified by NASS.';
const TEXT = /^[A-Z0-9 .,'&()-]{2,60}$/;

const num = (v) => {
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// لكل وصف (short_desc) نحتفظ باحدث سنة، وعند التساوي نفضل الاستطلاع (SURVEY) على التعداد (CENSUS)
function pickLatest(rows) {
  const best = {};
  for (const r of rows) {
    if (r.domain_desc !== 'TOTAL' || !METRICS.includes(r.statisticcat_desc)) continue;
    const value = num(r.Value);
    if (value === null) continue; // (D) و (Z) معناها بيانات محجوبة
    const year = Number(r.year);
    const cur = best[r.short_desc];
    if (!cur || year > cur.year || (year === cur.year && r.source_desc === 'SURVEY' && cur.source !== 'SURVEY')) {
      best[r.short_desc] = { metric: r.statisticcat_desc, desc: r.short_desc, value, unit: r.unit_desc, year, source: r.source_desc };
    }
  }
  return Object.values(best).sort((a, b) => b.year - a.year).slice(0, 8);
}

export default async function handler(req, res) {
  // ننضف المفتاح من اي مسافات او رموز اتجاه مخفية (بتيجي احيانا لما المفتاح يتنسخ من ايميل عربي)
  const key = String(process.env.NASS_API_KEY || '').replace(/[^A-Za-z0-9-]/g, '');
  if (!key) return res.status(500).json({ error: 'NASS key not configured' });

  const state = String(req.query.state || '').trim().toUpperCase();
  const county = String(req.query.county || '').trim().toUpperCase();
  const commodity = String(req.query.commodity || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) return res.status(400).json({ error: 'Invalid state' });
  if (!TEXT.test(county)) return res.status(400).json({ error: 'Invalid county' });
  if (!TEXT.test(commodity)) return res.status(400).json({ error: 'Invalid commodity' });

  const params = new URLSearchParams({
    key,
    format: 'JSON',
    agg_level_desc: 'COUNTY',
    state_alpha: state,
    county_name: county,
    commodity_desc: commodity,
    year__GE: '2017'
  });

  try {
    const r = await fetch(`${BASE}?${params}`, { signal: AbortSignal.timeout(9000) });
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    const base = { state, county, commodity, attribution: ATTRIBUTION };
    // NASS بيرجع 400 لما مفيش سجلات مطابقة
    if (r.status === 400) return res.status(200).json({ ...base, items: [], note: 'No matching NASS records' });
    if (!r.ok) return res.status(502).json({ error: `NASS ${r.status}` });
    const data = await r.json();
    const items = pickLatest(Array.isArray(data?.data) ? data.data : []);
    return res.status(200).json({ ...base, items });
  } catch (e) {
    return res.status(500).json({ error: 'NASS request failed' });
  }
    }
