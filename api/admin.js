module.exports = async (req, res) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) { res.status(500).json({ error: 'الخادم غير مُعد بشكل صحيح' }); return; }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'لازم تسجّل دخول' }); return; }

  const svHeaders = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

  const userResp = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token }
  });
  if (!userResp.ok) { res.status(401).json({ error: 'الجلسة منتهية' }); return; }
  const user = await userResp.json();

  const adminResp = await fetch(SUPABASE_URL + '/rest/v1/admins?user_id=eq.' + user.id + '&select=user_id', { headers: svHeaders });
  const adminRows = await adminResp.json();
  if (!adminResp.ok || !Array.isArray(adminRows) || adminRows.length === 0) {
    res.status(403).json({ error: 'الصفحة دي للأدمن بس' });
    return;
  }

  if (req.method === 'GET') {
    const claimsResp = await fetch(
      SUPABASE_URL + '/rest/v1/company_claims?status=eq.pending&select=id,company_id,user_id,claim_email,verification_method,requester_role,created_at,companies(name,city,country,website,source)&order=created_at.asc',
      { headers: svHeaders }
    );
    const claims = await claimsResp.json();
    if (!claimsResp.ok) { res.status(500).json({ error: 'تعذّر تحميل الطلبات' }); return; }
    res.status(200).json({ claims: claims });
    return;
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const { claim_id, decision } = body || {};
    if (!claim_id || (decision !== 'approved' && decision !== 'rejected')) {
      res.status(400).json({ error: 'طلب غير صالح' });
      return;
    }

    const getClaimResp = await fetch(SUPABASE_URL + '/rest/v1/company_claims?id=eq.' + claim_id + '&select=*', { headers: svHeaders });
    const claimRows = await getClaimResp.json();
    if (!getClaimResp.ok || !claimRows[0]) { res.status(404).json({ error: 'الطلب مش موجود' }); return; }
    const claim = claimRows[0];

    await fetch(SUPABASE_URL + '/rest/v1/company_claims?id=eq.' + claim_id, {
      method: 'PATCH', headers: svHeaders,
      body: JSON.stringify({ status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    });

    if (decision === 'approved') {
      await fetch(SUPABASE_URL + '/rest/v1/companies?id=eq.' + claim.company_id, {
        method: 'PATCH', headers: svHeaders,
        body: JSON.stringify({ claimed_by: claim.user_id, claim_status: 'verified' })
      });
    } else {
      await fetch(SUPABASE_URL + '/rest/v1/companies?id=eq.' + claim.company_id + '&claimed_by=eq.' + claim.user_id + '&claim_status=eq.pending_review', {
        method: 'PATCH', headers: svHeaders,
        body: JSON.stringify({ claimed_by: null, claim_status: 'unclaimed' })
      });
    }

    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
