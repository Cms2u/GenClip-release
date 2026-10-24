// ดึงข้อมูลสินค้าจากแท็บ TikTok ที่เปิดอยู่ (Seller Center หน้าแก้ไขสินค้า หรือหน้าสินค้า TikTok Shop)

// ฟังก์ชันนี้ถูกส่งไปรันในหน้าเว็บผ่าน chrome.scripting จึงต้องไม่อ้างตัวแปรภายนอก
function extractProductFromPage() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const vis = (el) => !!el && el.getClientRects().length > 0;
  const fieldValue = (f) => clean(f.value !== undefined ? f.value : f.innerText);
  const meta = (p) => document.querySelector(`meta[property="${p}"],meta[name="${p}"]`)?.content || '';
  const out = { name: '', description: '', price: '', images: [], url: location.href };

  // 1) JSON-LD (หน้าสินค้าสาธารณะ)
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const items = [].concat(JSON.parse(s.textContent)).flatMap((x) => x['@graph'] || [x]);
      for (const j of items) {
        if (!/Product/i.test(String(j['@type']))) continue;
        out.name ||= clean(j.name);
        out.description ||= clean(j.description);
        out.images.push(...[].concat(j.image || []).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean));
        const o = [].concat(j.offers || [])[0];
        if (o) out.price ||= String(o.price || o.lowPrice || '');
      }
    } catch {}
  }

  // 2) ช่องกรอกที่มีป้ายกำกับ (Seller Center)
  const byLabel = (rx) => {
    const labels = [...document.querySelectorAll('label,span,div,p,h3,h4')].filter((el) => {
      const t = clean(el.innerText);
      return el.children.length <= 3 && t.length < 40 && rx.test(t) && vis(el);
    });
    for (const l of labels) {
      let box = l;
      for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
        const fields = box.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),textarea,[contenteditable="true"]');
        for (const f of fields) {
          const v = fieldValue(f);
          if (v) return v;
        }
      }
    }
    return '';
  };

  // ราคาในตาราง SKU: อ่านทุกช่องในคอลัมน์ที่หัวตารางเป็น "ราคา"
  const tablePrices = () => {
    const vals = [];
    for (const th of document.querySelectorAll('th,[role="columnheader"]')) {
      if (!/ราคา|price/i.test(clean(th.innerText)) || /ต้นทุน|cost/i.test(th.innerText)) continue;
      const table = th.closest('table,[role="table"],[role="grid"]');
      const idx = [...th.parentElement.children].indexOf(th);
      if (!table || idx < 0) continue;
      for (const row of table.querySelectorAll('tbody tr,[role="row"]')) {
        const cell = row.children[idx];
        const input = cell?.querySelector('input');
        const n = parseFloat((input ? input.value : cell?.innerText || '').replace(/[^\d.]/g, ''));
        if (n > 0) vals.push(n);
      }
    }
    if (!vals.length) return '';
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return min === max ? `${min}` : `${min}-${max}`;
  };

  out.name ||= byLabel(/^\*?\s*(ชื่อสินค้า|product name)/i);
  out.description ||= byLabel(/^\*?\s*(รายละเอียดสินค้า|คำอธิบายสินค้า|product description|description)/i);
  out.price ||= tablePrices() || byLabel(/^\*?\s*(ราคา|price)/i);

  // 3) meta tag และข้อความบนหน้า
  out.name ||= clean(meta('og:title')) || clean(document.title.replace(/\s*[|-]\s*TikTok.*$/i, ''));
  out.description ||= clean(meta('og:description'));
  if (!out.description) {
    const ed = [...document.querySelectorAll('[contenteditable="true"]')].sort((a, b) => b.innerText.length - a.innerText.length)[0];
    if (ed) out.description = clean(ed.innerText);
  }
  if (!out.price) {
    const m = [...new Set(document.body.innerText.match(/฿\s?[\d,]+(?:\.\d+)?/g) || [])].slice(0, 3);
    out.price = m.join(' / ');
  }

  // 4) รูปสินค้า: og:image + รูปจาก CDN ของ TikTok ตามลำดับบนหน้า
  if (meta('og:image')) out.images.push(meta('og:image'));
  const cdn = /ibyteimg|byteimg|tiktokcdn|ttwstatic|tos-/i;
  for (const img of document.querySelectorAll('img')) {
    const src = img.currentSrc || img.src;
    if (!src || !cdn.test(src) || /avatar|logo|icon|emoji/i.test(src + ' ' + (img.alt || ''))) continue;
    const w = Math.max(img.naturalWidth, img.width);
    if (w < 80) continue;
    out.images.push(src);
  }
  const seen = new Set();
  out.images = out.images.filter((u) => {
    const key = u.split('?')[0].split('~')[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);

  out.description = out.description.slice(0, 800);
  return out;
}

// ขอรูปความละเอียดสูงขึ้นจาก CDN ของ TikTok (ถ้า URL มีขนาดย่อกำกับไว้)
function hiResUrl(url) {
  return url.replace(/(~tplv-[^/?]*?):\d+:\d+/, '$1:1200:1200');
}

function guessType(name) {
  if (/ผ้าถุง|ผ้าซิ่น|ผ้านุ่ง|sarong/i.test(name)) return 'ผ้าถุง';
  if (/ชุดเซ็ต|เซ็ต|set/i.test(name)) return 'ชุดเซ็ต';
  if (/เสื้อ|shirt|blouse|top/i.test(name)) return 'เสื้อ';
  return 'อื่นๆ';
}

async function fetchImageDataUrl(url) {
  for (const u of [...new Set([hiResUrl(url), url])]) {
    try {
      const res = await fetch(u);
      if (!res.ok) continue;
      return await fileToDataUrl(await res.blob());
    } catch {}
  }
  return null;
}

async function importFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !/tiktok\.com/.test(tab.url || '')) {
    throw new Error('กรุณาเปิดหน้าสินค้าของ TikTok (Seller Center หน้าแก้ไขสินค้า หรือหน้าสินค้าในร้าน) ไว้ในแท็บที่ใช้งานอยู่');
  }
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractProductFromPage });
  const images = (await Promise.all(result.images.map(fetchImageDataUrl))).filter(Boolean);
  // รหัสสินค้า TikTok Shop จากลิงก์ (Seller Center: /product/edit/<id>, หน้าร้าน: /product/<id>) ใช้ปักตะกร้าตอนโพสต์
  const productId = (result.url.match(/product\/(?:edit\/)?(\d{10,})/) || result.url.match(/(\d{15,})/) || [])[1] || '';
  return { ...result, images, productId, type: guessType(result.name) };
}
