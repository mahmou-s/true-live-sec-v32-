// Vercel serverless function
// /api/sec?type=tickers
// /api/sec?type=submissions&cik=1318605
// /api/sec?type=facts&cik=1318605

// غيّر الإيميل ده لإيميلك الحقيقي - SEC بيطلبه
const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';

const TYPES = ['tickers', 'submissions', 'facts'];

// ---------- شركات امريكية (US-GAAP / 10-K) ----------
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

// ---------- شركات اجنبية (IFRS / 20-F) ----------
const IFRS_TAGS = {
  revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
  netIncome: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
  eps: ['BasicEarningsLossPerShare', 'DilutedEarningsLossPerShare'],
  assets: ['Assets'],
  cash: ['CashAndCashEquivalents']
};

// فترة سنوية تقريباً (لو الرقم ليه تاريخ بداية)
function isAnnualPeriod(u) {
  if (!u.start) return true;
  const days = (Date.parse(u.end) - Date.parse(u.start)) / 86400000;
  return days >= 340 && days <= 390;
}

// احدث قيمة سنوية 20-F لكل وحدة (عملة)
function bestByUnit(facts, tags) {
  const res = {};
  for (const tag of tags) {
    const units = facts?.['ifrs-full']?.[tag]?.units;
    if (!units) continue;
    for (const [unit, arr] of Object.entries(units)) {
      for (const u of arr) {
        if (u.form !== '20-F' || u.fp !== 'FY' || !isAnnualPeriod(u)) continue;
        if (!res[unit] || u.end > res[unit].end) res[unit] = { val: u.val, end: u.end };
      }
    }
  }
  return res;
}

// العملة الاساسية = عملة الشركة (غير الدولار لو موجودة)، والدولار كمعلومة اضافية
function pickIfrs(facts, tags) {
  const byUnit = bestByUnit(facts, tags);
  const names = Object.keys(byUnit);
  if (!names.length) return null;
  const cur = (n) => n.split('/')[0];
  const primary = names.find((n) => cur(n) !== 'USD') || names[0];
  const usdName = names.find((n) => cur(n) === 'USD' && n !== primary);
  const usd = usdName && byUnit[usdName].end === byUnit[primary].end ? { val: byUnit[usdName].val } : null;
  return { val: byUnit[primary].val, end: byUnit[primary].end, cur: cur(primary), usd };
}

// لو رقم اقدم من احدث رقم بأكتر من 400 يوم نخفيه بدل ما نعرض رقم قديم مضلل
function dropStale(out) {
  const ends = Object.values(out).filter(Boolean).map((x) => Date.parse(x.end));
  if (!ends.length) return out;
  const newest = Math.max(...ends);
  for (const k of Object.keys(out)) {
    if (out[k] && newest - Date.parse(out[k].end) > 400 * 86400000) out[k] = null;
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
  if (type === 'facts') url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: `SEC ${r.status}` });
    }
    const data = await r.json();

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');

    if (type === 'facts') {
      const g = data.facts;

      const us = dropStale({
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
      });
      if (Object.values(us).some(Boolean)) {
        return res.status(200).json({ standard: 'US-GAAP', form: '10-K', ...us });
      }

      // مفيش ارقام امريكية: نجرب IFRS / 20-F (الديون مش معروضة لهذه الشركات حالياً لانها مش مؤكدة)
      const ifrs = dropStale({
        revenue: pickIfrs(g, IFRS_TAGS.revenue),
        netIncome: pickIfrs(g, IFRS_TAGS.netIncome),
        eps: pickIfrs(g, IFRS_TAGS.eps),
        assets: pickIfrs(g, IFRS_TAGS.assets),
        cash: pickIfrs(g, IFRS_TAGS.cash),
        debt: null
      });
      if (Object.values(ifrs).some(Boolean)) {
        return res.status(200).json({ standard: 'IFRS', form: '20-F', ...ifrs });
      }

      return res.status(200).json({ standard: null, form: null, ...us });
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
