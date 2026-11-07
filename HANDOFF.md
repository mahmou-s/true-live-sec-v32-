# MSMMK — ملف تسليم كامل (2026-11-07)

## الهوية
- **الاسم:** MSMMK (Many Societies Merge, Manifesting Knowledge — مجتمعات متعددة تتكامل، فتُجسّد المعرفة)
- **الدومين:** msmmk.com (مُسجَّل، موثّق عند ICANN، مربوط بـVercel وشغال)
- **الريبو:** github.com/mahmou-s/true-live-sec-v32- (فرع main)
- **الاستضافة:** Vercel مجاني (حساب zarwa3)، **مفيش هوستنج تقليدية ولا اشتراك سنوي مطلوب**

## البنية التحتية (كلها شغالة ومتأكد منها)
- **Supabase:** مشروع `msmmk`، URL: `https://migckovlfckdnsanemkd.supabase.co`
- **Resend:** متصل بالدومين، Verified، بيبعت من `noreply@msmmk.com`
- **مفاتيح Supabase:** Supabase بتلغي مفاتيح `anon`/`service_role` القديمة (شكل `eyJ...`) بحلول آخر 2026، والبديل الدائم هو `sb_publishable_...` و`sb_secret_...`. **لازم نتأكد إن متغيرات Vercel (`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) بالصيغة الجديدة**، ومتغيرات Vercel دي محفوظة Secret فمش بتظهر، فلازم نفتحها ونحدّثها يدويًا لو لسه بالصيغة القديمة.

## قاعدة البيانات (Supabase، كل الجداول مُنشأة ومتحقق منها بالـSQL)
- `companies` — 14 عمود: البيانات الأصلية (source, external_id, name, city) + claim fields (claimed_by, claim_status) + حقول "شركة جديدة" (country, state_region, street, neighborhood, official_email, official_phone, website)
- `accounts`, `admins` (محمود أدمن حاليًا، قابل للتغيير لاحقًا)
- `company_claims` — فيها `requester_role` (owner_founder/authorized_representative/employee_management)
- `company_overlay`, `correction_requests`, `audit_log` (trigger تلقائي على companies وcompany_claims وcompany_overlay وcorrection_requests وcompany_goals)
- `company_goals` — 9 أهداف ثابتة + other_detail، RLS مفعّلة

كل الـMigrations إضافية وقابلة للتراجع، ومفيش بيانات اتمسحت من CD-1 (california.html وملفات الـJSON الأصلية).

## الملفات المضافة (غير ملفات CD-1 الأصلية)
- `CD2-DESIGN.md`, `UPDATE-SCHEDULE.md` — توثيق القرارات والتحديثات الدورية
- `claim.html` — بوابة "My Company": Existing Company (بحث بنفس منطق الدمج بتاع california.html عن طريق استدعاء merge2.js) / New Company (فورم كامل). إنجليزي افتراضي + زرار تبديل عربي RTL. فيها Supabase Auth (تسجيل/دخول بإيميل وباسوورد)
- `api/claim.js` — مطالبة بشركة موجودة: يتحقق تلقائي لو إيميل المستخدم على نفس دومين موقع الشركة، وإلا يحوّل لمراجعة يدوية
- `api/register-company.js` — تسجيل شركة جديدة كليًا، دايمًا محتاجة مراجعة يدوية
- `api/admin.js` + `admin.html` — لوحة مراجعة الأدمن (قايمة الطلبات المعلّقة، موافقة/رفض)
- `nav.js` اتحدّث بإضافة رابط "My Company"

## آخر حاجة كانت شغالة وقت التوقف
`admin.html` بعد كذا محاولة فيها أخطاء لصق (تكرار السطر، مفتاح ناقص) **اتصلحت وبقت شغالة** (ظهرت شاشة تسجيل الدخول صح). **الخطوة الناقصة:** سجّل دخول في `https://msmmk.com/admin.html`، وشوف هل طلب "Acevedos, FLC" المعلّق ظهر، ودوس "موافقة"، وتأكد من قاعدة البيانات إن حالته بقت `verified`:
```sql
select name, claim_status from public.companies where name ilike '%Acevedos%';
