// api/company.js — TRUE LIVE SEC (Vercel Node function)
// Env var required: SEC_CONTACT = "Your Name your@email.com"  (SEC fair-access policy)

const DAY = 864e5;
const TICKERS_TTL = DAY;           // refresh the SEC ticker list daily
const STALE_AFTER_DAYS = 460;      // latest annual report older than this => stale
let tickers = null, tickersAt = 0; // per-instance cache

async function sec(url) {
  const contact = process.env.SEC_CONTACT;
  if (!contact) throw new Error('SEC_CONTACT env var missing');
  const r = await fetch(url, {
    headers: { 'User-Agent': contact, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('SEC responded ' + r.status);
  return r.json();
}

async function getTickers() {
  if (tickers && Date.now() - tickersAt < TICKERS_TTL) return tickers;
  const raw = await sec('https://www.sec.gov/files/company_tickers.json');
  tickers = new Map(Object.values(raw).map((r) => [String(r.ticker).toUpperCase(), r]));
  tickersAt = Date.now();
  return tickers;
}

// Annual (10-K, FY) values only, merged across tags, one per period end, newest first.
// Duration filter drops the quarterly figures that 10-K filings also carry under fp=FY.
function annual(facts, tags, unit = 'USD', instant = false) {
  const byEnd = new Map();
  for (const tag of tags) {
    for (const x of facts.facts?.['us-gaap']?.[tag]?.units?.[unit] || []) {
      if (x.form !== '10-K' || x.fp !== 'FY' || !x.end) continue;
      if (!instant) {
        if (!x.start) continue;
        const d = (new Date(x.end) - new Date(x.start)) / DAY;
        if (d < 350 || d > 380) continue; // covers 52/53-week years
      }
      const prev = byEnd.get(x.end);
      if (!prev || x.filed > prev.filed) byEnd.set(x.end, x);
    }
  }
  return [...byEnd.values()].sort((a, b) => (a.end < b.end ? 1 : -1));
}

const pick = (s) => (s[0] ? { value: s[0].val, end: s[0].end, filed: s[0].filed, form: s[0].form } : null);

export default async function handler(req, res) {
  const q = String(req.query.ticker || '').toUpperCase().trim().replace(/\./g, '-');
  if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(q)) return res.status(400).json({ ok: false, error: 'Invalid ticker' });

  try {
    const map = await getTickers();
    const row = map.get(q);
    if (!row) return res.status(404).json({ ok: false, error: 'Not found' });

    const cik = String(row.cik_str).padStart(10, '0');
    const facts = await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);

    const rev = annual(facts, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet']);
    const net = annual(facts, ['NetIncomeLoss', 'ProfitLoss']);
    const assets = annual(facts, ['Assets'], 'USD', true);
    const eps = annual(facts, ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'USD/shares');

    const asOf = rev[0]?.end || null;
    const stale = !asOf || (Date.now() - new Date(asOf)) / DAY > STALE_AFTER_DAYS;
    const latest = { revenue: pick(rev), netIncome: pick(net), assets: pick(assets), eps: pick(eps) };
    const complete = Object.values(latest).every(Boolean);

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      ok: true,
      live: !stale && complete, // fresh annual data from SEC and all four figures present
      stale,
      asOf,
      source: 'SEC EDGAR (XBRL companyfacts)',
      fetchedAt: new Date().toISOString(),
      cik,
      ticker: row.ticker,
      company: facts.entityName || row.title,
      latest,
      chart: {
        revenue_5y: rev.slice(0, 5).reverse().map((r) => ({ year: r.end.slice(0, 4), end: r.end, value: r.val })),
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ ok: false, error: 'SEC unavailable, try again later' });
  }
}
