module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    res.status(500).json({ error: 'الخادم غير مُعد بشكل صحيح' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'لازم تسجّل دخول الأول' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { source, name, city, website, claim_email } = body || {};
  if (!source || !name || !city || !claim_email) {
    res.status(400).json({ error: 'بيانات ناقصة' });
    return;
  }

  const userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
  });
  if (!userResp.ok) {
    res.status(401).json({ error: 'جلسة الدخول منتهية، سجّل دخول تاني' });
    return;
  }
  const user = await userResp.json();

  const external_id = (source + '|' + name + '|' + city).toLowerCase().trim();
  const svHeaders = {
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json'
  };

  const upsertResp = await fetch(
    SUPABASE_URL + '/rest/v1/companies?on_conflict=external_id',
    {
      method: 'POST',
      headers: Object.assign({}, svHeaders, { Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify([{ source, external_id, name, city }])
    }
  );
  const upsertText = await upsertResp.text();
  let upserted;
  try { upserted = JSON.parse(upsertText); } catch (e) { res.status(500).json({ error: 'رد غير متوقع عند حفظ الشركة: ' + upsertText.slice(0, 300) }); return; }
  if (!upsertResp.ok || !Array.isArray(upserted) || !upserted[0]) {
    res.status(500).json({ error: 'تعذّر حفظ سجل الشركة (status ' + upsertResp.status + '): ' + upsertText.slice(0, 300) });
    return;
  }
  const company = upserted[0];

  if (company.claim_status === 'verified' && company.claimed_by && company.claimed_by !== user.id) {
    res.status(409).json({ error: 'الشركة دي اتأكدت ملكيتها من حساب تاني بالفعل' });
    return;
  }

  let verified = false;
  if (website) {
    const webDomain = String(website).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const emailDomain = (String(claim_email).toLowerCase().split('@')[1] || '');
    if (webDomain && emailDomain && webDomain === emailDomain) verified = true;
  }

  const claimResp = await fetch(SUPABASE_URL + '/rest/v1/company_claims', {
    method: 'POST',
    headers: svHeaders,
    body: JSON.stringify([{
      company_id: company.id,
      user_id: user.id,
      claim_email: claim_email,
      verification_method: verified ? 'domain_email' : 'manual',
      status: verified ? 'approved' : 'pending',
      reviewed_at: verified ? new Date().toISOString() : null
    }])
  });
  if (!claimResp.ok) {
    const claimErrText = await claimResp.text();
    res.status(500).json({ error: 'تعذّر تسجيل طلب المطالبة (status ' + claimResp.status + '): ' + claimErrText.slice(0, 300) });
    return;
  }

  const patchResp = await fetch(SUPABASE_URL + '/rest/v1/companies?id=eq.' + company.id, {
    method: 'PATCH',
    headers: svHeaders,
    body: JSON.stringify({
      claimed_by: user.id,
      claim_status: verified ? 'verified' : 'pending_review'
    })
  });
  if (!patchResp.ok) {
    const patchErrText = await patchResp.text();
    res.status(500).json({ error: 'الطلب اتسجّل لكن تعذّر تحديث حالة الشركة (status ' + patchResp.status + '): ' + patchErrText.slice(0, 300) });
    return;
  }

  res.status(200).json({ status: verified ? 'verified' : 'pending' });
};
