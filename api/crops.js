// api/crops.js - ربط المحصول بقطاعات SEC (أكواد SIC) اللي ممكن تشتريه
// ملاحظة: ده "اهتمام محتمل مش مؤكد" - مش قايمة مشترين فعليين، والاختيار تحليلي ويتراجع

const S = (sic, name, why) => ({ sic, name, why });

const SECTORS = {
  grainMill: S('2040', 'Grain Mill Products', 'بتطحن وتصنّع منتجات الحبوب'),
  oils: S('2070', 'Fats & Oils', 'بتعصر البذور الزيتية وتكرر الزيوت'),
  meat: S('2011', 'Meat Packing Plants', 'بتشتري ماشية مغذّاة بالحبوب (طلب غير مباشر)'),
  poultry: S('2015', 'Poultry Slaughtering', 'شركات الدواجن المتكاملة بتشتري أعلاف'),
  ethanol: S('2860', 'Industrial Organic Chemicals', 'بتنتج الإيثانول من الحبوب'),
  refining: S('2911', 'Petroleum Refining', 'بتخلط الإيثانول والديزل الحيوي (طلب غير مباشر)'),
  bakery: S('2050', 'Bakery Products', 'بتشتري دقيق القمح'),
  sugar: S('2060', 'Sugar & Confectionery', 'بتصنّع السكر والحلويات'),
  beverages: S('2080', 'Beverages', 'بتشتري محليات (طلب غير مباشر)'),
  textile: S('2200', 'Textile Mill Products', 'بتشتري القطن للغزل والنسيج'),
  canned: S('2030', 'Canned, Frozen & Preserved Food', 'بتصنّع الخضار والبطاطس المجمدة'),
  wholesale: S('5150', 'Wholesale-Farm Product Raw Materials', 'تجار جملة للمحاصيل الخام'),
  groceries: S('5140', 'Wholesale-Groceries', 'تجار جملة للأغذية (طلب غير مباشر)')
};

const CROPS = {
  CORN: ['grainMill', 'ethanol', 'poultry', 'wholesale', 'meat', 'refining'],
  SOYBEANS: ['oils', 'poultry', 'wholesale', 'meat'],
  WHEAT: ['grainMill', 'bakery', 'wholesale'],
  COTTON: ['textile', 'wholesale'],
  RICE: ['grainMill', 'wholesale', 'groceries'],
  SUGARBEETS: ['sugar', 'beverages'],
  POTATOES: ['canned', 'groceries']
};

// القطاعات اللي طلبها غير مباشر (بتظهر في الآخر وبعلامة مختلفة)
const INDIRECT = new Set(['meat', 'refining', 'beverages', 'groceries']);

export function sectorsFor(crop) {
  const keys = CROPS[String(crop || '').toUpperCase()];
  return keys ? keys.map((k) => ({ ...SECTORS[k], direct: !INDIRECT.has(k) })) : null;
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=86400');
  const crop = String(req.query?.crop || '').trim();
  if (!crop) return res.status(200).json({ crops: Object.keys(CROPS) });
  const sectors = sectorsFor(crop);
  if (!sectors) return res.status(404).json({ error: 'crop not supported', crops: Object.keys(CROPS) });
  return res.status(200).json({
    crop: crop.toUpperCase(),
    sectors,
    note: 'possible interest, not confirmed buyers'
  });
}
