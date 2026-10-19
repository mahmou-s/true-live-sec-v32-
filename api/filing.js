// Vercel serverless function - موقع وإيميلات عامة ومقتطف النشاط من آخر تقرير سنوي (10-K / 20-F)
// /api/filing?cik=320193
// بيقرا اول جزء من التقرير بس (حد اقصى 1.6MB) علشان السرعة

const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';
const LIMIT = 1600000;
const SKIP = /(^|\.)(sec\.gov|xbrl\.org|xbrl\.us|fasb\.org|w3\.org|ifrs\.org|nasdaq\.com|nyse\.com)$|\.gov$/;
const TLD = 'com|net|org|io|ai|co|us|biz|info|bio|tech';
const ROLES = [
  ['procurement', /procure|purchas|suppl|sourc|vendor/],
  ['partnership', /partner|bizdev|businessdev|alliance/],
  ['investor', /^ir$|investor/],
  ['general', /^(info|contact|sales|support|hello|media|press)$/]
];

export function toText(html) {
  let h = html.slice(0, html.lastIndexOf('>') + 1);
  h = h.replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  return h.replace(/<\/(p|div|tr|li|h[1-6])>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ').replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-').replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function findWebsites(text) {
  const re = new RegExp('(?:https?:\\/\\/)?(?:www\\.)?[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:' + TLD + ')\\b', 'gi');
  const found = {};
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const pre = text.slice(Math.max(0, m.index - 160), m.index);
    const hasProto = /^(https?:\/\/|www\.)/i.test(raw);
    const ctx = /web\s?site|home\s?page|internet site|online at/i.test(pre);
    if (text[m.index - 1] === '@' || (!hasProto && !ctx)) continue;
    const d = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (SKIP.test(d)) continue;
    found[d] = (found[d] || 0) + (ctx ? 5 : 1);
  }
  return Object.entries(found).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([domain, score]) => ({ domain, score }));
}

export function findEmails(text) {
  const all = [...new Set((text.match(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi) || []).map((e) => e.toLowerCase()))];
  const emails = [];
  let hidden = 0;
  for (const e of all) {
    const [local, domain] = e.split('@');
    if (SKIP.test(domain)) continue;
    const role = ROLES.find((r) => r[1].test(local));
    if (role) emails.push({ address: e, type: role[0] });
    else hidden++;
  }
  return { emails: emails.slice(0, 8), hiddenOther: hidden };
}

export function business(text, form) {
  const is20 = form === '20-F';
  const start = new RegExp(is20 ? '^\\s*item\\s*4\\s*[.\\-:]?\\s*information\\s+on\\s+the\\s+company' : '^\\s*item\\s*1\\s*[.\\-:]?\\s*business\\b', 'gim');
  const next = new RegExp(is20 ? 'item\\s*4a\\b|item\\s*5\\b' : 'item\\s*1a\\b|item\\s*1b\\b|item\\s*2\\b', 'gi');
  let m;
  while ((m = start.exec(text))) {
    const at = m.index + m[0].length;
    next.lastIndex = at;
    const n = next.exec(text);
    if ((n ? n.index : text.length) - at >= 800) {
      const cut = text.slice(at, at + 1500).replace(/\s+/g, ' ').trim();
      const dot = cut.lastIndexOf('. ');
      return dot > 400 ? cut.slice(0, dot + 1) : cut;
    }
  }
  return null;
  }
async function readLimited(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let out = '', bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: out, bytes, truncated: false };
    bytes += value.length;
    out += dec.decode(value, { stream: true });
    if (bytes >= LIMIT) { await reader.cancel().catch(() => {}); return { text: out, bytes, truncated: true }; }
  }
}

export default async function handler(req, res) {
  const rawCik = String(req.query?.cik || '');
  if (!/^\d{1,10}$/.test(rawCik)) return res.status(400).json({ error: 'Invalid CIK' });
  const H = { 'User-Agent': UA };
  try {
    const s = await fetch(`https://data.sec.gov/submissions/CIK${rawCik.padStart(10, '0')}.json`, { headers: H, signal: AbortSignal.timeout(3500) });
    if (!s.ok) return res.status(s.status).json({ error: `SEC ${s.status}` });
    const rec = (await s.json()).filings?.recent;
    const i = (rec?.form || []).findIndex((f) => f === '10-K' || f === '20-F');
    if (i < 0) return res.status(200).json({ cik: rawCik, found: false, note: 'no 10-K or 20-F in recent filings' });
    const form = rec.form[i], acc = rec.accessionNumber[i].replace(/-/g, '');
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(rawCik)}/${acc}/${rec.primaryDocument[i]}`;
    const d = await fetch(url, { headers: H, signal: AbortSignal.timeout(5000) });
    if (!d.ok) return res.status(502).json({ error: `Filing ${d.status}` });
    const { text: html, bytes, truncated } = await readLimited(d);
    const text = toText(html);
    const sites = findWebsites(text), em = findEmails(text);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      cik: rawCik, found: true, form, filingDate: rec.filingDate?.[i] || null, url, bytes, truncated,
      website: sites[0] ? 'https://' + sites[0].domain : null, websiteCandidates: sites,
      emails: em.emails, hiddenOtherEmails: em.hiddenOther, business: business(text, form)
    });
  } catch (e) {
    return res.status(500).json({ error: 'Filing request failed' });
  }
      }
