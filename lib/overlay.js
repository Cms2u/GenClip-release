// ตัวหนังสือที่ระบบเขียนทับตอนรวมคลิป (สะกดถูกแน่นอน ต่างจากตัวหนังสือที่ AI วาดในภาพ)
//   หัวข้อของแต่ละฉาก (เฉพาะคลิปที่ไม่ได้ให้ ChatGPT ใส่หัวข้อในภาพ), ป้ายโปรโมชัน, ราคา,
//   และฉากสุดท้าย: ปุ่มชวนกดตะกร้า + ชื่อเว็บร้าน
// ตำแหน่งเลี่ยงส่วนที่ TikTok บัง: แถบบน ~10%, ปุ่มด้านขวาช่วง 45-85%, แคปชันด้านล่าง ~18%
const Overlay = (() => {
  let fontReady;
  const FAMILY = 'GCKanit, "Leelawadee UI", Tahoma, "Segoe UI Emoji", sans-serif';
  const font = (px) => `${Math.round(px)}px ${FAMILY}`;

  function loadFont() {
    fontReady ||= new FontFace('GCKanit', `url(${chrome.runtime.getURL('assets/fonts/Kanit-Bold.ttf')})`)
      .load()
      .then((f) => (document.fonts.add(f), true))
      .catch(() => false);
    return fontReady;
  }

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const easeOutBack = (x) => 1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2);
  const easeOut = (x) => 1 - Math.pow(1 - x, 3);

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, h / 2));
  }

  // ลดขนาดตัวอักษรจนข้อความกว้างไม่เกิน maxW
  function fit(ctx, text, maxW, px) {
    let size = px;
    ctx.font = font(size);
    while (size > px * 0.45 && ctx.measureText(text).width > maxW) ctx.font = font((size *= 0.94));
    return size;
  }

  // ป้ายตัวหนังสือ วาดรอบจุดกึ่งกลาง (cx, cy) พร้อมย่อ/ขยาย/หมุน
  // ไอคอนรถเข็น (วาดเอง เพราะ emoji บางเครื่องแสดงไม่ถูก) มุมซ้ายบนที่ (x, y) สูง s
  function cartIcon(ctx, x, y, s, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = s * 0.11;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.08);
    ctx.lineTo(x + s * 0.2, y + s * 0.08);
    ctx.lineTo(x + s * 0.34, y + s * 0.66);
    ctx.lineTo(x + s * 0.9, y + s * 0.66);
    ctx.lineTo(x + s, y + s * 0.26);
    ctx.lineTo(x + s * 0.25, y + s * 0.26);
    ctx.stroke();
    for (const cx of [0.4, 0.82]) {
      ctx.beginPath();
      ctx.arc(x + s * cx, y + s * 0.87, s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ป้ายตัวหนังสือ วาดรอบจุดกึ่งกลาง (cx, cy) พร้อมย่อ/ขยาย/หมุน ข้อความขึ้นต้นด้วย 🛒 = วาดไอคอนรถเข็นนำหน้า
  function badge(ctx, { text, cx, cy, px, maxW, bg, fg, border, scale = 1, rotate = 0, alpha = 1, padX = 0.55, padY = 0.32 }) {
    if (!text || scale <= 0 || alpha <= 0) return;
    const cart = /^🛒/u.test(text);
    if (cart) text = text.replace(/^🛒\s*/u, '');
    ctx.save();
    const size = fit(ctx, text, maxW - (cart ? px * 1.2 : 0), px);
    const iconW = cart ? size * 1.2 : 0;
    const w = ctx.measureText(text).width + iconW + size * padX * 2;
    const h = size * (1.25 + padY * 2);
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(rotate);
    ctx.scale(scale, scale);
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = size * 0.35;
    ctx.shadowOffsetY = size * 0.08;
    roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.5);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (border) {
      ctx.lineWidth = size * 0.08;
      ctx.strokeStyle = border;
      ctx.stroke();
    }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, iconW / 2, size * 0.04);
    if (cart) cartIcon(ctx, -w / 2 + size * padX, -size * 0.42, size * 0.85, fg);
    ctx.restore();
  }

  function gradient(ctx, x0, x1, a, b) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    return g;
  }

  // "1590" → "฿1,590"
  function formatPrice(s) {
    const v = String(s || '').trim();
    if (!v) return '';
    if (/^\d+(\.\d+)?$/.test(v)) return `฿${Number(v).toLocaleString('en-US')}`;
    return /^\d/.test(v) ? `฿${v}` : v;
  }

  // spec: { headlines: [ข้อความต่อฉาก] | null, price, promo, cta, url }
  // i = ฉากที่กำลังเล่น, n = จำนวนฉาก, t = วินาทีในคลิปของฉากนั้น
  function draw(ctx, W, H, spec, i, n, t) {
    const u = W / 1080;
    const appear = (start, len = 0.4) => clamp01((t - start) / len);
    const pulse = 1 + 0.035 * Math.sin(t * Math.PI * 2 * 1.2);

    const head = spec.headlines?.[i];
    if (head) {
      const a = appear(0.15, 0.45);
      badge(ctx, {
        text: head,
        cx: W / 2,
        cy: H * 0.12,
        px: 74 * u,
        maxW: W * 0.82,
        bg: gradient(ctx, W * 0.1, W * 0.9, '#b0124f', '#e8457f'),
        fg: '#fff',
        border: '#f6d77a',
        scale: a ? easeOutBack(a) : 0,
        alpha: a,
        padY: 0.28,
      });
    }

    if (spec.promo) {
      const a = appear(0.5, 0.45);
      badge(ctx, {
        text: spec.promo,
        cx: W * 0.74,
        cy: H * 0.29,
        px: 58 * u,
        maxW: W * 0.42,
        bg: gradient(ctx, W * 0.55, W * 0.95, '#f9e08b', '#d9a521'),
        fg: '#8a0f3c',
        border: '#fff6d6',
        scale: a ? easeOutBack(a) * pulse : 0,
        rotate: -0.09,
        alpha: a,
      });
    }

    const price = formatPrice(spec.price);
    if (price) {
      const a = easeOut(appear(0.8, 0.45));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate((a - 1) * W * 0.5, 0);
      const x = W * 0.05;
      const y = H * (i === n - 1 && spec.cta ? 0.6 : 0.66);
      const labelPx = 34 * u;
      const pricePx = fit(ctx, price, W * 0.5, 84 * u);
      ctx.font = font(pricePx);
      const w = Math.max(ctx.measureText(price).width, 120 * u) + 60 * u;
      const h = labelPx * 1.3 + pricePx * 1.15 + 34 * u;
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 24 * u;
      roundRect(ctx, x, y, w, h, 28 * u);
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#b0124f';
      roundRect(ctx, x, y, 14 * u, h, 7 * u);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = font(labelPx);
      ctx.fillStyle = '#7a5a66';
      ctx.fillText('ราคา', x + 36 * u, y + 16 * u);
      ctx.font = font(pricePx);
      ctx.fillStyle = '#b0124f';
      ctx.fillText(price, x + 36 * u, y + 16 * u + labelPx * 1.25);
      ctx.restore();
    }

    if (i === n - 1 && spec.cta) {
      const a = appear(1.2, 0.45);
      badge(ctx, {
        text: spec.cta,
        cx: W * 0.44,
        cy: H * 0.765,
        px: 60 * u,
        maxW: W * 0.72,
        bg: gradient(ctx, W * 0.1, W * 0.8, '#e8457f', '#b0124f'),
        fg: '#fff',
        border: '#fff',
        scale: a ? easeOutBack(a) * (a >= 1 ? pulse : 1) : 0,
        alpha: a,
      });
      if (spec.url) {
        const b = appear(1.6, 0.4);
        badge(ctx, {
          text: spec.url,
          cx: W * 0.44,
          cy: H * 0.825,
          px: 36 * u,
          maxW: W * 0.72,
          bg: 'rgba(40,10,25,0.6)',
          fg: '#fff',
          scale: 1,
          alpha: b,
          padY: 0.18,
        });
      }
    }
  }

  return { loadFont, draw, formatPrice };
})();
