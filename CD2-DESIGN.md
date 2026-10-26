# تصميم CD-2: حسابات الشركات

آخر تحديث: 2026-10-26
الحالة: معتمد، جاهز للتنفيذ

## المبدأ
بيانات المصادر الرسمية (FSIS, GAP, العضوي, CDFA, الألبان) ثابتة ولا تتعدّل مباشرة. الشركة بتضيف طبقة بيانات فوقها، وأي طلب تصحيح لبيانات المصدر نفسها يحتاج مراجعة قبل التنفيذ.

## الجداول

### تعديل على جدول الشركات
- `claimed_by`: فاضي افتراضيًا.
- `claim_status`: `unclaimed` (افتراضي) / `pending_review` / `verified`.

### `accounts`
- `id`, `email`, `created_at`.

### `admins`
- `user_id` (مرجع لـ`accounts`). تغيير المسؤول = تعديل سطر هنا، مش تغيير كود.

### `company_claims`
- `company_id`, `user_id`, `claim_email`, `verification_method` (`domain_email` / `manual`), `status` (`pending`/`approved`/`rejected`), `reviewed_by`, `reviewed_at`.

### `company_overlay` (طبقة بيانات الشركة فوق المصدر الرسمي)
- `company_id` (فريد لكل شركة)
- `description`, `logo_url`
- `extra_phone`, `extra_email`, `updated_website`
- `updated_by`, `updated_at`

### `correction_requests` (تصحيح بيانات المصدر الرسمي)
- `company_id`, `field_name`, `requested_value`, `requested_by`
- `status` (`pending`/`approved`/`rejected`), `reviewed_by`, `reviewed_at`

### `audit_log`
- `table_name`, `record_id`, `user_id`, `action`, `changed_fields`, `created_at`. تلقائي، بيتعبّى من النظام عند أي تعديل.

## تدفق المطالبة بشركة
1. زرار "دي شركتي" على كارت الشركة.
2. المستخدم يكتب إيميله.
3. لو دومين الإيميل بيطابق دومين `website` المسجّل للشركة: رابط تحقق، وبعد الضغط عليه `claim_status` يبقى `verified` فورًا.
4. غير كده: الطلب `pending_review`، يظهر في قايمة مراجعة الـ`admin`.
5. بعد التحقق أو الموافقة، الحساب يقدر يعدّل في `company_overlay` فقط، ويبعت طلبات لـ`correction_requests` لأي حاجة في بيانات المصدر.

## واجهة المراجعة اليدوية
صفحة محمية للـ`admin` بس، فيها قايمتين: طلبات مطالبة معلّقة، وطلبات تصحيح معلّقة. كل سطر زرار قبول/رفض. من غير فلاتر أو تفاصيل زيادة في الإصدار الأول.

## سياسات الصلاحيات (RLS)

| الجدول | قراءة | كتابة |
|---|---|---|
| الشركات (الأصلية) | مفتوحة للكل | ما حدش يعدّل فيها مباشرة إلا موافقة `correction_requests` |
| `company_overlay` | مفتوحة للكل | بس صاحب `claimed_by` الموثّق |
| `company_claims` | المستخدم لطلباته، و`admin` للكل | المستخدم يبعت لنفسه بس |
| `correction_requests` | مفتوحة للكل | المستخدم الموثّق لشركته بس، والـ`admin` يوافق/يرفض |
| `audit_log` | `admin` بس | تلقائي من النظام |

## التسجيل والتحقق
Supabase Auth + Resend كـSMTP خارجي (راجع قرارات ما قبل CD-2 في `true-live-sec.md`). محتاج دومين فعلي قبل التفعيل الحقيقي لأي شركة.

## خارج نطاق هذا التصميم
عرض وطلب (CD-3)، محرك الفرص والمطابقة (CD-4)، الإشعارات الفعلية (CD-5). كل واحدة تصميم منفصل بعد اعتماد اللي قبلها.
