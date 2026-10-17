// Vercel serverless function - شركات SEC المدرجة تحت كود SIC معين
// /api/sic?sic=2040          (شركات أمريكية بس)
// /api/sic?sic=2040&all=1    (يشمل الشركات غير الأمريكية)
// ملاحظة: قايمة EDGAR حسب SIC فيها CIK والولاية بس (الاسم مش موجود)،
// فبنربطها بقايمة الرموز (tickers) علشان نجيب الاسم ونستبعد الشركات اللي مش مدرجة حاليا

const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';
const LIST = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&output=atom&count=100';
const TICKERS = 'https://www.sec.gov/files/company_tickers.json';
const MAX_PAGES = 3;

// رموز الولايات الامريكية (والمقاطعات) في SEC. اي رمز تاني (زي F4) معناه خارج امريكا
const US_STATES = new Set(('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP').split(' '));

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

// يربط الشركات بالاسم والرمز. لو للشركة اكتر من رمز (اسهم وضمانات) بناخد الاقصر
export function pickCompanies(found, tickers, usOnly) {
  const byCik = new Map();
  for (const t of Object.values(tickers)) {
    const cur = byCik.get(Number(t.cik_str));
    if (!cur || t.ticker.length < cur.ticker.length) byCik.set(Number(t.cik_str), t);
  }
  const seen = new Set();
  const companies = [];
  let nonUs = 0;
  for (const e of found) {
    const t = byCik.get(e.cik);
    if (!t || seen.has(e.cik)) continue;
    seen.add(e.cik);
    if (usOnly && !US_STATES.has(e.state)) { nonUs++; continue; }
    companies.push({ ticker: t.ticker, name: t.title, cik: String(e.cik), state: e.state });
  }
  companies.sort((a, b) => a.name.localeCompare(b.name));
  return { companies, nonUs };
}

async function getText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`SEC ${r.status}`);
  return r.text();
}

export default async function handler(req, res) {
  const sic = String(req.query?.sic || '').trim();
  if (!/^\d{4}$/.test(sic)) return res.status(400).json({ error: 'Invalid SIC' });
  const usOnly = String(req.query?.all || '') !== '1';

  try {
    const found = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const entries = parseEntries(await getText(`${LIST}&SIC=${sic}&start=${page * 100}`));
      found.push(...entries);
      if (entries.length < 100) break;
    }
    const tickers = JSON.parse(await getText(TICKERS));
    const { companies, nonUs } = pickCompanies(found, tickers, usOnly);

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      sic,
      total: companies.length,
      scanned: found.length,
      nonUsExcluded: nonUs,
      companies,
      note: 'listed companies only; possible interest, not confirmed buyers'
    });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
