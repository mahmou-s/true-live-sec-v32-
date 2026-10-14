// Vercel serverless function
// /api/sec?type=tickers
// /api/sec?type=submissions&cik=1318605
// /api/sec?type=facts&cik=1318605
// /api/sec?type=inspect&cik=937966   (تشخيص فقط)

// غيّر الإيميل ده لإيميلك الحقيقي - SEC بيطلبه
const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';

const TYPES = ['tickers', 'submissions', 'facts', 'inspect'];

// ---------- اسماء الارقام ----------
const US_TAGS = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'],
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
  eps: ['EarningsPerShareBasic', 'EarningsPerShareDiluted'],
  assets: ['Assets'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
  debt: ['LongTermDebt', 'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations', 'DebtAndCapitalLeaseObligations']
};

const IFRS_TAGS = {
  revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
  netIncome: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
  eps: ['BasicEarningsLossPerShare', 'DilutedEarningsLossPerShare'],
  assets: ['Assets'],
  cash: ['CashAndCashEquivalents']
};

const FOREIGN_FORMS = ['20-F'];

// ---------- شركات امريكية (US-GAAP / 10-K / دولار) ----------
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

// ---------- شركات اجنبية (20-F / اي عملة / US-GAAP او IFRS) ----------
// فترة سنوية تقريباً (لو الرقم ليه تاريخ بداية)
function isAnnualPeriod(u) {
  if (!u.start) return true;
  const days = (Date.parse(u.end) - Date.parse(u.start)) / 86400000;
  return days >= 340 && days <= 390;
}

// احدث قيمة سنوية لكل وحدة (عملة)
function bestByUnit(facts, taxonomy, tags, forms) {
  const res = {};
  for (const tag of tags) {
    const units = facts?.[taxonomy]?.[tag]?.units;
    if (!units) continue;
    for (const [unit, arr] of Object.entries(units)) {
      for (const u of arr) {
        if (!forms.includes(u.form) || u.fp !== 'FY' || !isAnnualPeriod(u)) continue;
        if (!res[unit] || u.end > res[unit].end) res[unit] = { val: u.val, end: u.end, form: u.form };
      }
    }
  }
  return res;
}

// العملة الاساسية = عملة الشركة (غير الدولار لو موجودة)، والدولار كمعلومة اضافية
function pickFacts(facts, taxonomy, tags, forms) {
  const byUnit = bestByUnit(facts, taxonomy, tags, forms);
  const names = Object.keys(byUnit);
  if (!names.length) return null;
  const cur = (n) => n.split('/')[0];
  const primary = names.find((n) => cur(n) !== 'USD') || names[0];
  const usdName = names.find((n) => cur(n) === 'USD' && n !== primary);
  const usd = usdName && byUnit[usdName].end === byUnit[primary].end ? { val: byUnit[usdName].val } : null;
  return { val: byUnit[primary].val, end: byUnit[primary].end, cur: cur(primary), usd, form: byUnit[primary].form };
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

const hasAny = (o) => Object.values(o).some(Boolean);
const firstForm = (o) => Object.values(o).find(Boolean)?.form || '20-F';

// ---------- فحص شكل بيانات شركة (للتشخيص فقط) ----------
function inspectFacts(facts) {
  const re = /revenue|sales|netincome|profit|assets|cash|borrowing|debt|earningspershare|equity/i;
  const taxonomies = {};
  const formsCount = {};
  const tags = [];
  for (const tax of Object.keys(facts || {})) {
    taxonomies[tax] = Object.keys(facts[tax]).length;
    for (const tag of Object.keys(facts[tax])) {
      const units = facts[tax][tag].units || {};
      const unitNames = Object.keys(units);
      const forms = new Set();
      const fps = new Set();
      let latest = '';
      for (const un of unitNames) {
        for (const u of units[un]) {
          forms.add(u.form);
          fps.add(u.fp);
          formsCount[u.form] = (formsCount[u.form] || 0) + 1;
          if (u.end > latest) latest = u.end;
        }
      }
      if (re.test(tag)) tags.push({ t: tax + '/' + tag, u: unitNames, f: [...forms], p: [...fps], e: latest });
    }
  }
  tags.sort((a, b) => (a.e < b.e ? 1 : -1));
  return { taxonomies, forms: formsCount, shown: Math.min(tags.length, 40), total: tags.length, tags: tags.slice(0, 40) };
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
  if (type === 'facts' || type === 'inspect') url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;

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

    if (type === 'facts') {
      const g = data.facts;

      // 1) شركة امريكية: US-GAAP + 10-K + دولار
      const us = dropStale({
        revenue: latestAnnual(g, US_TAGS.revenue, 'USD'),
        netIncome: latestAnnual(g, US_TAGS.netIncome, 'USD'),
        eps: latestAnnual(g, US_TAGS.eps, 'USD/shares'),
        assets: latestAnnual(g, US_TAGS.assets, 'USD'),
        cash: latestAnnual(g, US_TAGS.cash, 'USD'),
        debt: latestAnnual(g, US_TAGS.debt, 'USD')
      });
      if (hasAny(us)) {
        return res.status(200).json({ standard: 'US-GAAP', form: '10-K', ...us });
      }

      // 2) شركة اجنبية بتقدم 20-F بمعيار US-GAAP (زي ASML) وبعملتها
      const usForeign = dropStale({
        revenue: pickFacts(g, 'us-gaap', US_TAGS.revenue, FOREIGN_FORMS),
        netIncome: pickFacts(g, 'us-gaap', US_TAGS.netIncome, FOREIGN_FORMS),
        eps: pickFacts(g, 'us-gaap', US_TAGS.eps, FOREIGN_FORMS),
        assets: pickFacts(g, 'us-gaap', US_TAGS.assets, FOREIGN_FORMS),
        cash: pickFacts(g, 'us-gaap', US_TAGS.cash, FOREIGN_FORMS),
        debt: pickFacts(g, 'us-gaap', US_TAGS.debt, FOREIGN_FORMS)
      });
      if (hasAny(usForeign)) {
        return res.status(200).json({ standard: 'US-GAAP', form: firstForm(usForeign), ...usForeign });
      }

      // 3) شركة اجنبية بمعيار IFRS (زي TSM) - الديون مش معروضة لانها مش مؤكدة
      const ifrs = dropStale({
        revenue: pickFacts(g, 'ifrs-full', IFRS_TAGS.revenue, FOREIGN_FORMS),
        netIncome: pickFacts(g, 'ifrs-full', IFRS_TAGS.netIncome, FOREIGN_FORMS),
        eps: pickFacts(g, 'ifrs-full', IFRS_TAGS.eps, FOREIGN_FORMS),
        assets: pickFacts(g, 'ifrs-full', IFRS_TAGS.assets, FOREIGN_FORMS),
        cash: pickFacts(g, 'ifrs-full', IFRS_TAGS.cash, FOREIGN_FORMS),
        debt: null
      });
      if (hasAny(ifrs)) {
        return res.status(200).json({ standard: 'IFRS', form: firstForm(ifrs), ...ifrs });
      }

      return res.status(200).json({ standard: null, form: null, ...us });
    }

    if (type === 'submissions') {
      const m = data.addresses?.mailing;
      // احدث تقرير سنوي اتقدم فعلاً (10-K / 20-F / 40-F)
      const rec = data.filings?.recent;
      let lastAnnualForm = null;
      let lastAnnualDate = null;
      if (rec?.form) {
        for (let i = 0; i < rec.form.length; i++) {
          if (['10-K', '20-F', '40-F'].includes(rec.form[i])) {
            lastAnnualForm = rec.form[i];
            lastAnnualDate = rec.filingDate?.[i] || null;
            break;
          }
        }
      }
      return res.status(200).json({
        cik: String(data.cik || rawCik),
        name: data.name,
        website: data.website,
        phone: data.phone,
        sicDescription: data.sicDescription,
        address: m ? [m.city, m.stateOrCountry].filter(Boolean).join(', ') : null,
        lastFilingDate: data.filings?.recent?.filingDate?.[0] || null,
        lastFilingForm: data.filings?.recent?.form?.[0] || null,
        lastAnnualForm,
        lastAnnualDate
      });
    }

    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
