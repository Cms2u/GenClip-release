// ดึงสินค้าจากเว็บร้าน (เช่น https://nichapainnovation.co.th) เพื่อเลือก "ชุดคู่" ที่มีขายจริงและมีของในสต็อก
//   สินค้าเป็นเสื้อ → หาผ้าถุง/กระโปรงคู่ / สินค้าเป็นผ้าถุงหรือกระโปรง → หาเสื้อคู่
// ใช้ API สาธารณะของเว็บ: /api/v1/products (รายการ) และ /api/v1/products/:id (สีแต่ละตัวเลือก + รูปของสีนั้น)
const Catalog = (() => {
  const CACHE_MS = 6 * 3600e3;
  const abs = (base, u) => (u ? new URL(u, base).href : null);

  // บทบาทของสินค้า: top = เสื้อ, bottom = ผ้าถุง/กระโปรง, other = อื่น ๆ (เครื่องประดับ เสื้อผ้าบุรุษ ฯลฯ)
  // ดูหมวดหมู่ก่อน (ชื่อสินค้าเสื้อบางตัวมีคำว่าผ้าถุงปนอยู่) ไม่มีหมวดที่ชัดเจนค่อยดูจากชื่อ
  function role(p) {
    const cats = (p.categories || []).map((c) => c.name).join(' ');
    const name = p.name || '';
    if (/บุรุษ|เข็มขัด|สร้อย|เครื่องประดับ|ต่างหู|กระเป๋า|กางเกง/.test(`${cats} ${name}`)) return 'other';
    for (const text of [cats, name]) {
      const bottom = /กระโปรง|ผ้าถุง|ผ้าซิ่น|ผ้านุ่ง/.test(text);
      const top = /เสื้อ/.test(text);
      if (bottom && !top) return 'bottom';
      if (top && !bottom) return 'top';
    }
    if (/^(กระโปรง|ผ้าถุง|ผ้าซิ่น)/.test(name)) return 'bottom';
    if (/^เสื้อ/.test(name)) return 'top';
    return 'other';
  }

  // บทบาทของสินค้าในคิว จากประเภทที่เลือกและชื่อ
  function roleOfQueued(type, name) {
    if (type === 'ผ้าถุง' || /กระโปรง|ผ้าถุง|ผ้าซิ่น/.test(name)) return 'bottom';
    if (type === 'เสื้อ' || /^เสื้อ/.test(name)) return 'top';
    return 'other';
  }

  const inStock = (items) => (items || []).reduce((n, s) => n + Math.max(0, (s.quantity || 0) - (s.reserved || 0)), 0);

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    return body.data ?? body;
  }

  // รายการสินค้าทั้งหมด (เก็บไว้ 6 ชั่วโมง)
  async function list(base) {
    const { catalogCache } = await chrome.storage.local.get('catalogCache');
    if (catalogCache?.base === base && Date.now() - catalogCache.at < CACHE_MS) return catalogCache.products;
    const data = await getJson(`${base}/api/v1/products?limit=500`);
    const products = data.products || [];
    await chrome.storage.local.set({ catalogCache: { base, at: Date.now(), products } });
    return products;
  }

  // ทำงานพร้อมกันทีละ n รายการ
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(n, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          out[i] = await fn(items[i]).catch(() => null);
        }
      })
    );
    return out;
  }

  // ชุดคู่ที่ขายดีและมีของ (สูงสุด max รายการ) พร้อมสีที่มีของและรูปของแต่ละสี
  async function candidates(base, wantRole, max = 30) {
    const all = (await list(base))
      .filter((p) => p.isActive !== false && role(p) === wantRole && inStock(p.stockItems) > 0)
      .sort((a, b) => (b.totalSold || 0) - (a.totalSold || 0))
      .slice(0, max);
    const details = await pool(all, 6, (p) => getJson(`${base}/api/v1/products/${p.id}`));
    const out = [];
    details.forEach((d) => {
      if (!d) return;
      const primary = (d.images || []).find((x) => x.isPrimary)?.url || d.images?.[0]?.url;
      const colors = new Map();
      for (const s of d.stockItems || []) {
        const name = (s.color || '').trim() || 'สีตามรูป';
        const c = colors.get(name) || { name, avail: 0, image: null };
        c.avail += Math.max(0, (s.quantity || 0) - (s.reserved || 0));
        c.image ||= s.images?.[0]?.url || null;
        colors.set(name, c);
      }
      const available = [...colors.values()].filter((c) => c.avail > 0).map((c) => ({ name: c.name, image: abs(base, c.image || primary) }));
      if (!available.length) return;
      out.push({
        ref: `C${out.length + 1}`,
        id: d.id,
        name: d.name,
        sku: d.sku || '',
        category: (d.categories || []).map((c) => c.name).join('/'),
        colors: available,
      });
    });
    return out;
  }

  return { role, roleOfQueued, candidates };
})();
