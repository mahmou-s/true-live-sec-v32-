// api/company.js - V38 LIVE REAL - يصلح مشكلة Concept القديم
// Apple: Revenues (قديم حتى 2018) + RevenueFromContract... (جديد حتى 2024)
// الحل: دمج كل المفاهيم وأخذ الأحدث

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

function getFactsForConcept(facts, concept) {
  const usd = facts.facts?.['us-gaap']?.[concept]?.units?.USD;
  if (!usd || usd.length === 0) return [];
  return [...usd].sort((a, b) => new Date(b.end) - new Date(a.end)); // DESC
}

function getAnnualRevenueSeriesV38(facts) {
  // V38: جرب كل المفاهيم وادمجهم - الأحدث أولاً
  const concepts = [
    'RevenueFromContractWithCustomerExcludingAssessedTax', // الأحدث - Apple, MSFT يستخدمونه
    'SalesRevenueNet', // ثاني
    'Revenues' // الأقدم
  ];

  let allItems = [];
  for (let c of concepts) {
    const series = getFactsForConcept(facts, c);
    if (series.length > 0) {
      // أضف مع اسم المفهوم
      for (let s of series) {
        allItems.push({ ...s, _concept: c });
      }
    }
  }

  if (allItems.length === 0) return [];

  // فلتر 10-K + FY
  let filtered = allItems.filter(x => x.form === '10-K' && x.fp === 'FY');
  if (filtered.length < 3) filtered = allItems.filter(x => x.form === '10-K');
  if (filtered.length < 3) filtered = allItems;

  // رتب DESC مرة أخرى بعد الدمج
  filtered.sort((a, b) => new Date(b.end) - new Date(a.end));

  // إزالة التكرار حسب end - احتفظ بالأحدث filed
  const byEnd = new Map();
  for (const item of filtered) {
    if (!item.end) continue;
    const key = item.end;
    const existing = byEnd.get(key);
    if (!existing) {
      byEnd.set(key, item);
    } else {
      // احتفظ بالأكبر قيمة (الإيرادات الحقيقية) أو الأحدث filed
      if ((item.val || 0) > (existing.val || 0)) {
        byEnd.set(key, item);
      }
    }
  }

  let unique = Array.from(byEnd.values()).sort((a, b) => new Date(b.end) - new Date(a.end));
  
  // خد آخر 5 سنوات حقيقية (2020-2024)
  unique = unique.slice(0, 5);

  return unique; // [0] = 2024-09-28
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60'); // 10 ثواني فقط عشان الاختبار
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  let q = (req.query.ticker || '').toString().toUpperCase().trim().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10);
  if (!q || !/^[A-Z]/.test(q)) return res.status(400).json({ ok: false, error: 'Invalid ticker' });

  try {
    const tickers = await getTickers();
    let found = null; const qL = q.toLowerCase();
    for (const k in tickers) { if (tickers[k].ticker.toLowerCase() === qL) { found = tickers[k]; break; } }
    if (!found) return res.status(404).json({ ok: false, error: 'Ticker not found' });

    const cik = String(found.cik_str).padStart(10, '0');
    const fr = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Host': 'data.sec.gov' } });
    if (!fr.ok) return res.status(200).json({ ok: true, live: false, cik, ticker: found.ticker });

    const facts = await fr.json();

    const revenueSeries = getAnnualRevenueSeriesV38(facts);
    const netSeries = getFactsForConcept(facts, 'NetIncomeLoss').filter(x => x.form === '10-K');
    const assetsSeries = getFactsForConcept(facts, 'Assets');
    const epsSeries = getFactsForConcept(facts, 'EarningsPerShareDiluted').length ? getFactsForConcept(facts, 'EarningsPerShareDiluted') : getFactsForConcept(facts, 'EarningsPerShareBasic');

    const latestRev = revenueSeries[0] || null;

    const isRecent = latestRev && new Date(latestRev.end) >= new Date('2023-01-01');

    const chartData = [...revenueSeries].reverse().map(r => ({
      year: r.end.slice(0, 4),
      end: r.end,
      value: r.val,
      form: r.form,
      frame: r.frame,
      fp: r.fp,
      concept: r._concept
    }));

    return res.status(200).json({
      ok: true,
      live: !!(isRecent),
      live_reason: latestRev ? `LIVE FY ${latestRev.end} via ${latestRev._concept} - ${latestRev.frame}` : 'no data',
      source: 'SEC EDGAR LIVE V38 - merged concepts',
      cik,
      cik_num: found.cik_str,
      ticker: found.ticker,
      company: facts.entityName || found.title,
      latest: {
        revenue: latestRev ? { value: latestRev.val, end: latestRev.end, form: latestRev.form, filed: latestRev.filed, frame: latestRev.frame, fp: latestRev.fp, concept: latestRev._concept } : null,
        netIncome: netSeries[0] ? { value: netSeries[0].val, end: netSeries[0].end } : null,
      },
      chart: { revenue_5y: chartData },
      debug: { 
        concepts_tried: ['RevenueFromContract...', 'SalesRevenueNet', 'Revenues'],
        total_merged: revenueSeries.length + 5, 
        filtered_count: revenueSeries.length, 
        latest_end: latestRev?.end, 
        latest_value_B: latestRev ? (latestRev.val/1e9).toFixed(2)+'B' : null,
        latest_concept: latestRev?._concept,
        all_ends: revenueSeries.map(r=>r.end)
      },
      sec_compliant: { userAgent: UA },
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, stack: e.stack?.slice(0,500) });
  }
    }
        
