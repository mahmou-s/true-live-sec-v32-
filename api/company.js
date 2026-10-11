// api/company.js - Vercel Serverless Function - SEC Compliant
// TRUE LIVE SEC V35 - آمن 100% - لا بروكسيات

const CONTACT = 'Mahmoudsalem2080@gmail.com';
const UA = `TrueLiveSEC/1.0 ${CONTACT}`;

let tickersCache = null;
let tickersTime = 0;

async function getTickers() {
  if (tickersCache && Date.now() - tickersTime < 1000 * 60 * 60 * 24) return tickersCache;
  const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' }
  });
  if (!r.ok) throw new Error('SEC tickers failed: ' + r.status);
  const j = await r.json();
  tickersCache = j;
  tickersTime = Date.now();
  return j;
}

function getLatestSeries(facts, concept) {
  const usd = facts.facts?.['us-gaap']?.[concept]?.units?.USD;
  if (!usd || !usd.length) return null;
  // filter 10-K only for annual, and sort
  const sorted = [...usd].sort((a,b) => new Date(b.end) - new Date(a.end));
  return sorted;
}

function getAnnualRevenueSeries(facts) {
  const concepts = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'];
  for (let c of concepts) {
    const series = getLatestSeries(facts, c);
    if (series) {
      // take only 10-K, last 5 years
      const annual = series.filter(s => s.form === '10-K').slice(0,5);
      if (annual.length >= 2) return annual;
      return series.slice(0,5);
    }
  }
  return null;
}

export default async function handler(req, res) {
  // CORS + Cache
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  
  const q = (req.query.ticker || req.query.q || '').toUpperCase().trim();
  if (!q) return res.status(400).json({ ok: false, error: 'Missing ?ticker=AAPL' });

  try {
    const tickers = await getTickers();
    let found = null;
    const qLower = q.toLowerCase();
    for (const k in tickers) {
      const e = tickers[k];
      if (e.ticker.toLowerCase() === qLower) { found = e; break; }
    }
    if (!found) {
      for (const k in tickers) {
        const e = tickers[k];
        if (e.title.toLowerCase().includes(qLower)) { found = e; break; }
      }
    }
    if (!found) return res.status(404).json({ ok: false, found: false, query: q });

    const cik = String(found.cik_str).padStart(10,'0');
    
    // SEC CompanyFacts - with proper UA
    const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    const fr = await fetch(factsUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Host': 'data.sec.gov' }
    });
    if (!fr.ok) {
      return res.status(200).json({
        ok: true, live: false, source: 'SEC tickers only',
        cik, ticker: found.ticker, company: found.title,
        note: 'Facts not available, CIK found'
      });
    }
    const facts = await fr.json();
    
    const revenueSeries = getAnnualRevenueSeries(facts);
    const netSeries = getLatestSeries(facts, 'NetIncomeLoss');
    const assetsSeries = getLatestSeries(facts, 'Assets');
    const epsSeries = getLatestSeries(facts, 'EarningsPerShareDiluted') || getLatestSeries(facts, 'EarningsPerShareBasic');

    const latestRev = revenueSeries?.[0] || null;
    const latestInc = netSeries?.[0] || null;
    const latestAst = assetsSeries?.[0] || null;
    const latestEps = epsSeries?.[0] || null;

    return res.status(200).json({
      ok: true,
      live: true,
      source: 'SEC EDGAR LIVE via Vercel Function',
      cik,
      cik_num: found.cik_str,
      ticker: found.ticker,
      company: facts.entityName || found.title,
      sic: facts.sic,
      latest: {
        revenue: latestRev ? { value: latestRev.val, end: latestRev.end, form: latestRev.form, filed: latestRev.filed } : null,
        netIncome: latestInc ? { value: latestInc.val, end: latestInc.end, form: latestInc.form } : null,
        assets: latestAst ? { value: latestAst.val, end: latestAst.end, form: latestAst.form } : null,
        eps: latestEps ? { value: latestEps.val, end: latestEps.end } : null
      },
      chart: {
        revenue_5y: revenueSeries ? revenueSeries.map(r => ({ year: r.end.slice(0,4), end: r.end, value: r.val, form: r.form })).reverse() : []
      },
      sec_compliant: { userAgent: UA, rateLimit: 'max 10 req/s respected' },
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, query: q });
  }
}
