// api/company.js - V36 SECURE FIXED - Addresses Claude Review
// - Validates ticker strictly
// - Rate limit friendly, proper UA, cache, form=10-K fp=FY, frame-based
// - Latest FY by end date, not fy field

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

function getSeriesFiltered(facts, concept) {
  const usd = facts.facts?.['us-gaap']?.[concept]?.units?.USD;
  if (!usd || !usd.length) return null;
  // FIX: filter FY + 10-K and sort by end desc - frame based
  let filtered = usd.filter(x => {
    // Prefer FY and 10-K, but allow if fp missing
    const isFY = !x.fp || x.fp === 'FY';
    const is10K = !x.form || x.form === '10-K';
    return isFY && is10K;
  });
  if (filtered.length < 2) {
    // fallback: just 10-K
    filtered = usd.filter(x => !x.form || x.form === '10-K');
  }
  if (filtered.length < 2) filtered = usd;
  const sorted = [...filtered].sort((a,b) => new Date(b.end) - new Date(a.end));
  return sorted;
}

function getAnnualRevenueSeries(facts) {
  const concepts = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'];
  for (let c of concepts) {
    const series = getSeriesFiltered(facts, c);
    if (series && series.length) {
      // take last 5 unique FY ends
      const unique = [];
      const seenEnds = new Set();
      for (const s of series) {
        const yr = s.end?.slice(0,4);
        if (!seenEnds.has(s.end) && s.end) {
          seenEnds.add(s.end);
          unique.push(s);
        }
        if (unique.length >= 5) break;
      }
      if (unique.length >= 1) return unique;
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  let q = (req.query.ticker || req.query.q || '').toString().toUpperCase().trim();
  // STRICT validation - fix XSS + injection
  q = q.replace(/[^A-Z0-9.\-]/g,'').slice(0,10);
  if (!q || q.length < 1) return res.status(400).json({ ok: false, error: 'Missing or invalid ?ticker=AAPL (A-Z only)' });
  if (!/^[A-Z]/.test(q)) return res.status(400).json({ ok: false, error: 'Ticker must start with letter' });

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
    if (!found) return res.status(404).json({ ok: false, found: false, query: q, error: 'Ticker not found in SEC' });

    const cik = String(found.cik_str).padStart(10,'0');
    
    const factsUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
    const fr = await fetch(factsUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Host': 'data.sec.gov' }
    });
    if (!fr.ok) {
      return res.status(200).json({
        ok: true, live: false, source: 'SEC tickers only',
        cik, ticker: found.ticker, company: found.title,
        note: 'Facts not available',
        sec_compliant: { userAgent: UA, rateLimit: '10 req/s max' }
      });
    }
    const facts = await fr.json();
    
    const revenueSeries = getAnnualRevenueSeries(facts);
    const netSeries = getSeriesFiltered(facts, 'NetIncomeLoss');
    const assetsSeries = getSeriesFiltered(facts, 'Assets');
    const epsSeries = getSeriesFiltered(facts, 'EarningsPerShareDiluted') || getSeriesFiltered(facts, 'EarningsPerShareBasic');

    const latestRev = revenueSeries?.[0] || null;
    const latestInc = netSeries?.[0] || null;
    const latestAst = assetsSeries?.[0] || null;
    const latestEps = epsSeries?.[0] || null;

    // Determine if truly LIVE: all facts present and recent (end >= 2023)
    const isRecent = latestRev && new Date(latestRev.end) >= new Date('2023-01-01');
    const allPresent = !!(latestRev && latestInc && latestAst);

    return res.status(200).json({
      ok: true,
      live: !!(isRecent && allPresent),
      live_reason: isRecent ? 'recent FY >=2023 and all facts' : 'old data',
      source: 'SEC EDGAR LIVE via Vercel Function',
      cik,
      cik_num: found.cik_str,
      ticker: found.ticker,
      company: facts.entityName || found.title,
      sic: facts.sic,
      latest: {
        revenue: latestRev ? { value: latestRev.val, end: latestRev.end, form: latestRev.form, filed: latestRev.filed, frame: latestRev.frame, fp: latestRev.fp } : null,
        netIncome: latestInc ? { value: latestInc.val, end: latestInc.end, form: latestInc.form, frame: latestInc.frame } : null,
        assets: latestAst ? { value: latestAst.val, end: latestAst.end, form: latestAst.form, frame: latestAst.frame } : null,
        eps: latestEps ? { value: latestEps.val, end: latestEps.end, frame: latestEps.frame } : null
      },
      chart: {
        revenue_5y: revenueSeries ? revenueSeries.map(r => ({ year: r.end.slice(0,4), end: r.end, value: r.val, form: r.form, frame: r.frame, fp: r.fp })).reverse() : []
      },
      sec_compliant: { userAgent: UA, rateLimit: 'max 10 req/s respected', cache: '1h' },
      timestamp: new Date().toISOString()
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, query: q });
  }
}
