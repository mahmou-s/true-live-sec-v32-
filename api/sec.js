// Vercel serverless function
// /api/sec?type=tickers
// /api/sec?type=submissions&cik=1318605
// /api/sec?type=facts&cik=1318605

// غيّر الإيميل ده لإيميلك الحقيقي - SEC بيطلبه
const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';

const TYPES = ['tickers', 'submissions', 'facts', 'inspect', 'probe'];

// آخر قيمة سنوية (10-K / FY) من بين كل التاجات المعطاة
function latestAnnual(facts, tags, unit) {
  let best = null;
  for (const tag of tags) {
    const arr = facts?.['us-gaap']?.[tag]?.units?.[unit];
    if (!arr) continue;
    for (const u of arr) {
      if (u.form !== '10-K' || u.fp !== 'FY') continue;
      if (!best || u.end > best.end) best = { val: u.val, end: u.end };
    }
  }
  return best;
}


// مؤقت: ملخص صغير لشكل بيانات شركة (للشركات الاجنبية 20-F / IFRS)
function inspectFacts(facts) {
  const re = /revenue|sales|netincome|profit|assets|cash|borrowing|debt|earningspershare|equity/i;
  const taxonomies = {};
  const tags = [];
  for (const tax of Object.keys(facts || {})) {
    taxonomies[tax] = Object.keys(facts[tax]).length;
    for (const tag of Object.keys(facts[tax])) {
      if (!re.test(tag)) continue;
      const units = facts[tax][tag].units || {};
      const unitNames = Object.keys(units);
      const forms = new Set();
      let latest = '';
      for (const un of unitNames) {
        for (const u of units[un]) {
          forms.add(u.form);
          if (u.end > latest) latest = u.end;
        }
      }
      tags.push({ t: tax + '/' + tag, u: unitNames, f: [...forms], e: latest });
    }
  }
  tags.sort((a, b) => (a.e < b.e ? 1 : -1));
  return { taxonomies, shown: Math.min(tags.length, 60), total: tags.length, tags: tags.slice(0, 60) };
}

// مؤقت: قيم فعلية لاسماء IFRS المرشحة (تقارير 20-F فقط) علشان نتأكد من الوحدة والفترة
const PROBE_TAGS = [
  'Revenue', 'RevenueFromContractsWithCustomers',
  'ProfitLoss', 'ProfitLossAttributableToOwnersOfParent',
  'BasicEarningsLossPerShare', 'DilutedEarningsLossPerShare',
  'Assets', 'CashAndCashEquivalents',
  'Borrowings', 'LongtermBorrowings', 'NoncurrentBorrowings', 'CurrentBorrowings'
];
function probeFacts(facts) {
  const g = facts?.['ifrs-full'] || {};
  const out = {};
  for (const tag of PROBE_TAGS) {
    const units = g[tag]?.units;
    if (!units) { out[tag] = null; continue; }
    out[tag] = {};
    for (const un of Object.keys(units)) {
      const byPeriod = new Map();
      for (const u of units[un]) {
        if (u.form !== '20-F') continue;
        const key = (u.start || '') + '|' + u.end;
        const old = byPeriod.get(key);
        if (!old || (u.filed || '') > (old.filed || '')) byPeriod.set(key, u);
      }
      out[tag][un] = [...byPeriod.values()]
        .sort((a, b) => (a.end < b.end ? 1 : -1))
        .slice(0, 3)
        .map(u => ({ s: u.start, e: u.end, v: u.val, fp: u.fp, fy: u.fy }));
    }
  }
  return out;
}

export default async function handler(req, res) {
  const type = String(req.query.type || '');
  const rawCik = String(req.query.cik || '');

  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }
  if (type !== 'tickers' && !/^\d{1,10}$/.test(rawCik)) {
    return res.status(400).json({ error: 'Invalid CIK' });
  }

  const cik = rawCik.padStart(10, '0');
  let url = 'https://www.sec.gov/files/company_tickers.json';
  if (type === 'submissions') url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  if (type === 'facts' || type === 'inspect' || type === 'probe') url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `SEC ${r.status}` });
    }
    const data = await r.json();

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

    if (type === 'inspect') {
      return res.status(200).json({ name: data.entityName, ...inspectFacts(data.facts) });
    }

    if (type === 'probe') {
      return res.status(200).json({ name: data.entityName, ...{ tags: probeFacts(data.facts) } });
    }

    if (type === 'facts') {
      const g = data.facts;
      const out = {
        revenue: latestAnnual(g, [
          'Revenues',
          'RevenueFromContractWithCustomerExcludingAssessedTax',
          'SalesRevenueNet'
        ], 'USD'),
        netIncome: latestAnnual(g, ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'], 'USD'),
        eps: latestAnnual(g, ['EarningsPerShareBasic', 'EarningsPerShareDiluted'], 'USD/shares'),
        assets: latestAnnual(g, ['Assets'], 'USD'),
        cash: latestAnnual(g, ['CashAndCashEquivalentsAtCarryingValue'], 'USD'),
        debt: latestAnnual(g, ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'DebtAndCapitalLeaseObligations'], 'USD')
      };
      // لو رقم اقدم من احدث رقم بأكتر من 400 يوم نخفيه بدل ما نعرض رقم قديم مضلل
      const ends = Object.values(out).filter(Boolean).map(x => Date.parse(x.end));
      const newest = Math.max(...ends);
      for (const k of Object.keys(out)) {
        if (out[k] && newest - Date.parse(out[k].end) > 400 * 86400000) out[k] = null;
      }
      return res.status(200).json(out);
    }

    if (type === 'submissions') {
      const m = data.addresses?.mailing;
      return res.status(200).json({
        cik: String(data.cik || rawCik),
        name: data.name,
        website: data.website,
        phone: data.phone,
        sicDescription: data.sicDescription,
        address: m ? [m.city, m.stateOrCountry].filter(Boolean).join(', ') : null,
        lastFilingDate: data.filings?.recent?.filingDate?.[0] || null,
        lastFilingForm: data.filings?.recent?.form?.[0] || null
      });
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
