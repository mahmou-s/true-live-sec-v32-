// Vercel serverless function - بطاقة هوية وتواصل الشركة من SEC (من غير ارقام مالية)
// /api/profile?cik=320193

const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';
const ANNUAL = ['10-K', '20-F', '40-F'];

const clean = (v) => {
  const s = String(v == null ? '' : v).trim();
  return s || null;
};

const addr = (a) => a ? {
  street: [a.street1, a.street2].filter(Boolean).join(', ') || null,
  city: clean(a.city),
  state: clean(a.stateOrCountry),
  stateName: clean(a.stateOrCountryDescription),
  zip: clean(a.zipCode)
} : null;

export default async function handler(req, res) {
  const rawCik = String(req.query?.cik || '');
  if (!/^\d{1,10}$/.test(rawCik)) return res.status(400).json({ error: 'Invalid CIK' });
  const cik = rawCik.padStart(10, '0');

  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(9000)
    });
    if (!r.ok) return res.status(r.status).json({ error: `SEC ${r.status}` });
    const d = await r.json();

    // احدث تقرير سنوي اتقدم فعلا (دليل ان الشركة تشغيلية وبتقدم تقارير)
    const rec = d.filings?.recent;
    let lastAnnual = null;
    if (rec?.form) {
      for (let i = 0; i < rec.form.length; i++) {
        if (ANNUAL.includes(rec.form[i])) {
          lastAnnual = { form: rec.form[i], date: rec.filingDate?.[i] || null };
          break;
        }
      }
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      cik: String(d.cik || rawCik),
      name: clean(d.name),
      entityType: clean(d.entityType),
      tickers: Array.isArray(d.tickers) ? d.tickers : [],
      exchanges: Array.isArray(d.exchanges) ? d.exchanges : [],
      sic: clean(d.sic),
      sicDescription: clean(d.sicDescription),
      category: clean(d.category),
      description: clean(d.description),
      website: clean(d.website),
      investorWebsite: clean(d.investorWebsite),
      phone: clean(d.phone),
      business: addr(d.addresses?.business),
      mailing: addr(d.addresses?.mailing),
      stateOfIncorporation: clean(d.stateOfIncorporation),
      lastAnnual
    });
  } catch (e) {
    return res.status(500).json({ error: 'SEC request failed' });
  }
    }
