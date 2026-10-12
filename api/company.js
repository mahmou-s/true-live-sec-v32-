// api/company.js - V37 LIVE FIX - يصلح bug 2018 ويجيب 2024-2025 LIVE
const CONTACT = 'Mahmoudsalem2080@gmail.com';
const UA = `TrueLiveSEC/1.0 ${CONTACT}`;

let tickersCache = null;
let tickersTime = 0;
async function getTickers() {
  if (tickersCache && Date.now() - tickersTime < 86400000) return tickersCache;
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': UA }});
  if (!r.ok) throw new Error('SEC tickers failed: ' + r.status);
  const j = await r.json(); tickersCache = j; tickersTime = Date.now(); return j;
}

function getLatestFacts(facts, concept) {
  const usd = facts.facts?.['us-gaap']?.[concept]?.units?.USD;
  if (!usd || usd.length === 0) return [];
  // FIX V37: Sort DESC - الأحدث أولاً
  const sorted = [...usd].sort((a, b) => {
    const da = new Date(a.end).getTime() || 0;
    const db = new Date(b.end).getTime() || 0;
    return db - da; // DESC: 2024, 2023, 2022...
  });
  return sorted;
}

function getAnnualRevenueSeriesV37(facts) {
  const concepts = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'];
  let allSeries = [];
  for (let c of concepts) {
    const series = getLatestFacts(facts, c);
    if (series.length > 0) {
      allSeries = series;
      break;
    }
  }
  if (allSeries.length === 0) return [];

  // فلتر: 10-K + FY فقط، مع fallback
  let filtered = allSeries.filter(x => x.form === '10-K' && x.fp === 'FY');
  if (filtered.length < 2) filtered = allSeries.filter(x => x.form === '10-K');
  if (filtered.length < 2) filtered = allSeries;

  // إزالة التكرار بنفس تاريخ الانتهاء - نحتفظ بأحدث Filed
  const byEnd = new Map();
  for (const item of filtered) {
    if (!item.end) continue;
    const existing = byEnd.get(item.end);
    if (!existing) {
      byEnd.set(item.end, item);
    } else {
      // احتفظ بالأحدث Filed
      const eFiled = new Date(existing.filed || 0).getTime();
      const nFiled = new Date(item.filed || 0).getTime();
      if (nFiled > eFiled) byEnd.set(item.end, item);
    }
  }

  // حول لـ array ورتب DESC مرة أخرى - الأحدث أولاً
  let unique = Array.from(byEnd.values()).sort((a, b) => new Date(b.end) - new Date(a.end));

  // خد آخر 5 سنوات فقط
  unique = unique.slice(0, 5);

  return unique; // [0] = 2024/2025 = الأحدث
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300'); // قلل الكاش لـ 60 ثانية عشان يبان LIVE بسرعة
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  let q = (req.query.ticker || '').toString().toUpperCase().trim().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10);
  if (!q || !/^[A-Z]/.test(q)) return res.status(400).json({ ok: false, error: 'Invalid ticker' });

  try {
    const tickers = await getTickers();
    let found = null; const qL = q.toLowerCase();
    for (const k in tickers) { if (tickers[k].ticker.toLowerCase() === qL) { found = tickers[k]; break; } }
    if (!found) return res.status(404).json({ ok: false, error: 'Ticker not found', query: q });

    const cik = String(found.cik_str).padStart(10, '0');
    const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    const fr = await fetch(factsUrl, { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Host': 'data.sec.gov' } });
    if (!fr.ok) return res.status(200).json({ ok: true, live: false, cik, ticker: found.ticker, note: 'Facts not available' });

    const facts = await fr.json();

    const revenueSeries = getAnnualRevenueSeriesV37(facts);
    const netSeries = getLatestFacts(facts, 'NetIncomeLoss').filter(x => x.form === '10-K');
    const assetsSeries = getLatestFacts(facts, 'Assets');
    const epsSeries = getLatestFacts(facts, 'EarningsPerShareDiluted').length ? getLatestFacts(facts, 'EarningsPerShareDiluted') : getLatestFacts(facts, 'EarningsPerShareBasic');

    const latestRev = revenueSeries[0] || null; // الأحدث - 2024
    const latestInc = netSeries[0] || null;
    const latestAst = assetsSeries[0] || null;
    const latestEps = epsSeries[0] || null;

    const isRecent = latestRev && new Date(latestRev.end) >= new Date('2023-01-01');
    const allPresent = !!(latestRev);

    // تشارت: من الأقدم للأحدث للرسم
    const chartData = [...revenueSeries].reverse().map(r => ({
      year: r.end.slice(0, 4),
      end: r.end,
      value: r.val,
      form: r.form,
      frame: r.frame,
      fp: r.fp,
      filed: r.filed
    }));

    return res.status(200).json({
      ok: true,
      live: !!(isRecent && allPresent),
      live_reason: isRecent ? `LIVE FY ${latestRev.end} - ${latestRev.frame}` : `old data ${latestRev?.end}`,
      source: 'SEC EDGAR LIVE via Vercel Function V37',
      cik,
      cik_num: found.cik_str,
      ticker: found.ticker,
      company: facts.entityName || found.title,
      latest: {
        revenue: latestRev ? { value: latestRev.val, end: latestRev.end, form: latestRev.form, filed: latestRev.filed, frame: latestRev.frame, fp: latestRev.fp } : null,
        netIncome: latestInc ? { value: latestInc.val, end: latestInc.end, form: latestInc.form, frame: latestInc.frame } : null,
        assets: latestAst ? { value: latestAst.val, end: latestAst.end, form: latestAst.form } : null,
        eps: latestEps ? { value: latestEps.val, end: latestEps.end, frame: latestEps.frame } : null
      },
      chart: { revenue_5y: chartData },
      debug: { total_facts: facts.facts?.['us-gaap']?.Revenues?.units?.USD?.length || 0, filtered_count: revenueSeries.length, latest_end: latestRev?.end, latest_frame: latestRev?.frame },
      sec_compliant: { userAgent: UA, rateLimit: '10 req/s', cache: '60s' },
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, query: q });
  }
}
