// Vercel serverless function - شركات SEC المدرجة تحت كود SIC معين
// /api/sic?sic=2040
// ملاحظة: قايمة EDGAR حسب SIC فيها CIK والولاية بس (الاسم مش موجود)،
// فبنربطها بقايمة الرموز (tickers) علشان نجيب الاسم ونستبعد الشركات اللي مش مدرجة حاليا

const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';
const LIST = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&output=atom&count=100';
const TICKERS = 'https://www.sec.gov/files/company_tickers.json';
const MAX_PAGES = 3;

// يطلّع (cik, state) من كل <entry> في ملف Atom
export function parseEntries(xml) {
  const out = [];
  for (const block of String(xml).split('<entry').slice(1)) {
    const cik = /<cik>(\d+)<\/cik>/.exec(block)?.[1];
    if (!cik) continue;
    out.push({ cik: Number(cik), state: /<state>([^<]*)<\/state>/.exec(block)?.[1] || null });
  }
  return out;
}

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`SEC ${r.status}`);
  return r.text();
}

export default async function handler(req, res) {
  const sic = String(req.query?.sic || '').trim();
  if (!/^\d{4}$/.test(sic)) return res.status(400).json({ error: 'Invalid SIC' });

  try {
    const found = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const xml = await getText(`${LIST}&SIC=${sic}&start=${page * 100}`);
      const entries = parseEntries(xml);
      found.push(...entries);
      if (entries.length < 100) break;
    }

    const tickers = JSON.parse(await getText(TICKERS));
    const byCik = new Map(Object.values(tickers).map((t) => [Number(t.cik_str), t]));
    const seen = new Set();
    const companies = [];
    for (const e of found) {
      const t = byCik.get(e.cik);
      if (!t || seen.has(e.cik)) continue;
      seen.add(e.cik);
      companies.push({ ticker: t.ticker, name: t.title, cik: String(e.cik), state: e.state });
    }
    companies.sort((a, b) => a.name.localeCompare(b.name));

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      sic,
      total: companies.length,
      scanned: found.length,
      companies,
      note: 'listed companies only; possible interest, not confirmed buyers'
    });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
