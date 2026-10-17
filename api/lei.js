// Vercel serverless function - GLEIF (سجل الكيانات القانونية العالمي)
// /api/lei?type=search&q=Ford%20Motor%20Company   (قائمة نتائج مرتبة)
// /api/lei?type=record&lei=XXXXXXXXXXXXXXXXXXXX   (بطاقة هوية)

const BASE = 'https://api.gleif.org/api/v1';
const UA = 'TrueLiveSEC/1.0 (mahmoudsalem2080@gmail.com)';
const TYPES = ['search', 'record'];
const HEADERS = { Accept: 'application/vnd.api+json', 'User-Agent': UA };

// مفتاح مقارنة للعنوان (مش للعرض): كل اجزاء العنوان في GLEIF بما فيها رقم المبنى والرمز البريدي والولاية
function addrKey(a) {
  return [
    ...(Array.isArray(a.addressLines) ? a.addressLines : []),
    a.addressNumber,
    a.addressNumberWithinBuilding,
    a.mailRouting,
    a.city,
    a.region,
    a.postalCode,
    a.country
  ].filter(Boolean).join('|');
}

// تبسيط سجل GLEIF الى حقول بسيطة
function normRecord(d) {
  const a = d?.attributes || {};
  const e = a.entity || {};
  const reg = a.registration || {};
  const addr = e.legalAddress || {};
  const hq = e.headquartersAddress || {};
  return {
    lei: a.lei || d?.id || null,
    name: e.legalName?.name || null,
    status: e.status || null,
    regStatus: reg.status || null,
    country: addr.country || null,
    city: addr.city || null,
    region: addr.region || null,
    address: Array.isArray(addr.addressLines) && addr.addressLines.length ? addr.addressLines.join(', ') : null,
    postal: addr.postalCode || null,
    legalKey: addrKey(addr) || null,
    hqCountry: hq.country || null,
    hqCity: hq.city || null,
    hqAddress: Array.isArray(hq.addressLines) && hq.addressLines.length ? hq.addressLines.join(', ') : null,
    hqKey: addrKey(hq) || null,
    jurisdiction: e.jurisdiction || null,
    registeredAs: e.registeredAs || null,
    registeredAt: e.registeredAt?.id || null,
    legalForm: e.legalForm?.id || null,
    category: e.category || null,
    created: e.creationDate || null,
    updated: reg.lastUpdateDate || null,
    renewal: reg.nextRenewalDate || null
  };
}

// ترتيب: اسم مطابق تماما، ثم يبدأ بالكلمة، ثم باقي النتائج. والنشط اولا داخل كل مجموعة
function rank(items, q) {
  const needle = q.trim().toLowerCase();
  const score = (it) => {
    const n = (it.name || '').toLowerCase();
    const g = n === needle ? 0 : n.startsWith(needle) ? 1 : 2;
    return g * 2 + (it.status === 'ACTIVE' ? 0 : 1);
  };
  return items
    .map((it, i) => ({ it, i, s: score(it) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.it);
}

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`GLEIF ${r.status}`);
  return r.json();
}
export default async function handler(req, res) {
  const type = String(req.query.type || '');
  if (!TYPES.includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  try {
    if (type === 'search') {
      const q = String(req.query.q || '').trim().slice(0, 100);
      if (q.length < 2) return res.status(400).json({ error: 'q too short' });
      const enc = encodeURIComponent(q);
      const legalUrl = `${BASE}/lei-records?filter%5Bentity.legalName%5D=${enc}&page%5Bsize%5D=30`;
      const fullUrl = `${BASE}/lei-records?filter%5Bfulltext%5D=${enc}&page%5Bsize%5D=30`;

      // 1) بحث بالاسم القانوني. 2) لو النتايج قليلة نضيف بحث نصي (يشمل الاسماء البديلة) وندمج من غير تكرار
      const first = await getJson(legalUrl);
      const publishDate = first?.meta?.goldenCopy?.publishDate || null;
      let total = first?.meta?.pagination?.total ?? null;
      const seen = new Set();
      const list = [];
      const add = (data) => {
        for (const d of Array.isArray(data?.data) ? data.data : []) {
          const x = normRecord(d);
          if (x.lei && !seen.has(x.lei)) {
            seen.add(x.lei);
            list.push(x);
          }
        }
      };
      add(first);
      if (list.length < 10) {
        try {
          const second = await getJson(fullUrl);
          add(second);
          if (total == null) total = second?.meta?.pagination?.total ?? null;
        } catch (e) {
          // البحث النصي اضافي، لو فشل نكمل بنتايج البحث الاول
        }
      }

      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
      const items = rank(list, q).map((x) => ({
        lei: x.lei,
        name: x.name,
        status: x.status,
        country: x.country,
        city: x.city,
        jurisdiction: x.jurisdiction,
        category: x.category
      }));
      return res.status(200).json({
        q,
        total,
        shown: items.length,
        publishDate,
        items
      });
    }

    const lei = String(req.query.lei || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{20}$/.test(lei)) return res.status(400).json({ error: 'Invalid LEI' });
    const data = await getJson(`${BASE}/lei-records/${lei}`);
    const publishDate = data?.meta?.goldenCopy?.publishDate || null;
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ publishDate, record: normRecord(data.data) });
  } catch (e) {
    const m = /^GLEIF (\d+)$/.exec(e.message || '');
    return res.status(m ? Number(m[1]) : 500).json({ error: e.message });
  }
           }
