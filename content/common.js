// ฟังก์ชันช่วยที่ใช้ร่วมกันระหว่างหน้า ChatGPT และ Flow
(() => {
  if (window.GC) return;
  const GC = { aborted: false, handlers: {}, site: null };

  GC.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  GC.checkAbort = () => {
    if (GC.aborted) throw new Error('ABORTED');
  };

  GC.waitFor = async (fn, { timeout = 30000, interval = 500, label = 'element' } = {}) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      GC.checkAbort();
      try {
        const v = await fn();
        if (v) return v;
      } catch {}
      await GC.sleep(interval);
    }
    throw new Error(`หมดเวลารอ: ${label}`);
  };

  GC.isVisible = (el) =>
    !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  // หา element แรกที่มองเห็นได้จากรายการ selector
  GC.q = (selectors, root = document) => {
    for (const s of [].concat(selectors)) {
      try {
        const el = [...root.querySelectorAll(s)].find(GC.isVisible);
        if (el) return el;
      } catch {}
    }
    return null;
  };

  // คืนผลของ selector แรกที่เจอ (รวมที่ซ่อนอยู่)
  GC.qAll = (selectors, root = document) => {
    for (const s of [].concat(selectors)) {
      try {
        const r = [...root.querySelectorAll(s)];
        if (r.length) return r;
      } catch {}
    }
    return [];
  };

  GC.textOf = (el) =>
    [el.innerText, el.getAttribute('aria-label'), el.title].filter(Boolean).join(' ').trim();

  GC.setNativeValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // พิมพ์ข้อความลงช่อง รองรับทั้ง textarea และ contenteditable (ProseMirror/Slate)
  GC.typeInto = async (el, text) => {
    el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      GC.setNativeValue(el, text);
      return;
    }
    document.execCommand('selectAll');
    document.execCommand('delete');
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await GC.sleep(300);
    if (!el.innerText.trim()) document.execCommand('insertText', false, text);
    await GC.sleep(200);
    if (!el.innerText.trim()) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  };

  GC.dataUrlToFile = async (dataUrl, name) => {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], name, { type: blob.type || 'image/png' });
  };

  GC.blobToDataUrl = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });

  GC.setFiles = (input, files) => {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  GC.pasteFiles = (el, files) => {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  };

  // จำลองการกดแบบ pointer สำหรับเมนูที่เปิดด้วย pointerdown (เช่น Radix)
  GC.press = (el) => {
    const opts = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
  };

  // อยู่บนจอจริง (ไม่ถูกบังหรือซ่อนไว้หลังหน้าต่างอื่น): จุดกลาง element ต้องคลิกโดนตัวมันเอง
  // ใช้แยกขั้นตอนในหน้าต่างที่เก็บขั้นก่อนหน้าไว้แบบซ่อน (ถ้าตรวจตำแหน่งไม่ได้ ใช้แค่ isVisible)
  GC.onScreen = (el) => {
    if (!GC.isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || !document.elementFromPoint) return true;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };

  // คลิกแบบเมาส์จริง: ขอให้ side panel คลิกที่ตำแหน่งกลาง element ผ่าน DevTools
  // (บางเว็บไม่รับคลิกที่ extension จำลอง) ถ้าทำไม่ได้จะใช้คลิกธรรมดาแทน
  GC.realClick = async (el) => {
    el.scrollIntoView?.({ block: 'center', inline: 'center' });
    await GC.sleep(300);
    const r = el.getBoundingClientRect();
    if (r.width && r.height) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'gc:trustedClick', x: r.left + r.width / 2, y: r.top + r.height / 2 });
        if (res?.ok) return true;
      } catch {}
    }
    el.click();
    return false;
  };

  GC.log = (msg, kind = 'info') => {
    chrome.runtime.sendMessage({ type: 'gc:log', msg, kind }).catch(() => {});
  };

  GC.settings = async () => (await chrome.storage.local.get('settings')).settings || {};

  // รับไฟล์ใหญ่ (เช่น คลิปที่รวมแล้ว) จาก side panel ทีละชิ้น เพราะข้อความเดียวส่งได้จำกัด
  const incoming = new Map();
  GC.handlers['gc:chunk'] = ({ id, index, total, b64 }) => {
    if (!incoming.has(id)) incoming.set(id, new Array(total));
    incoming.get(id)[index] = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return true;
  };
  GC.takeFile = (id, name, type) => {
    const parts = incoming.get(id);
    incoming.delete(id);
    if (!parts || parts.some((p) => !p)) throw new Error('ได้รับไฟล์จาก GenClip ไม่ครบ');
    return new File(parts, name, { type });
  };

  // แถบขอความช่วยเหลือบนหน้าเว็บ เมื่อทำอัตโนมัติไม่สำเร็จ ให้ผู้ใช้ทำเองแล้วกด "ทำต่อ"
  GC.removeOverlay = () => {
    document.getElementById('genclip-overlay')?.remove();
    document.getElementById('genclip-hint')?.remove();
    if (GC._pending) {
      GC._pending(false);
      GC._pending = null;
    }
  };

  GC.askUser = (message) =>
    new Promise((resolve) => {
      GC.removeOverlay();
      GC.log(`รอผู้ใช้: ${message}`, 'warn');
      const host = document.createElement('div');
      host.id = 'genclip-overlay';
      host.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .box{font:14px/1.5 system-ui,sans-serif;background:#1f2937;color:#fff;padding:14px 16px;border-radius:10px;
             box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:520px;white-space:pre-wrap}
        .t{font-weight:700;color:#fbbf24}
        .b{margin-top:10px;display:flex;gap:8px;justify-content:flex-end}
        button{font:inherit;border:0;border-radius:6px;padding:6px 14px;cursor:pointer;color:#fff}
        .ok{background:#16a34a}.no{background:#4b5563}
      </style>
      <div class="box"><div class="t">GenClip ต้องการความช่วยเหลือ</div><div class="m"></div>
      <div class="b"><button class="no">ยกเลิก</button><button class="ok">ทำต่อ</button></div></div>`;
      root.querySelector('.m').textContent = message;
      const done = (v) => {
        GC._pending = null;
        host.remove();
        resolve(v);
      };
      root.querySelector('.ok').onclick = () => done(true);
      root.querySelector('.no').onclick = () => done(false);
      GC._pending = resolve;
      document.documentElement.appendChild(host);
    });

  GC.askOrFail = async (message) => {
    if (!(await GC.askUser(message))) throw new Error(GC.aborted ? 'ABORTED' : 'ผู้ใช้ยกเลิก');
  };

  // แถบแนะนำแบบไม่บล็อก: ระบบยังรอเองต่อไป แต่ผู้ใช้กด "ทำต่อ" เพื่อข้ามการรอได้
  GC.showHint = (message) => {
    document.getElementById('genclip-hint')?.remove();
    const hint = { clicked: false, remove: () => host.remove() };
    const host = document.createElement('div');
    host.id = 'genclip-hint';
    // มุมซ้ายล่าง: ไม่บังปุ่มยืนยันที่มักอยู่มุมขวาล่างของหน้าต่าง
    host.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      .box{font:13px/1.5 system-ui,sans-serif;background:#1f2937;color:#fff;padding:12px 14px;border-radius:10px;
           box-shadow:0 8px 24px rgba(0,0,0,.35);max-width:340px;white-space:pre-wrap}
      .t{font-weight:700;color:#fbbf24}
      button{font:inherit;border:0;border-radius:6px;padding:5px 12px;cursor:pointer;color:#fff;background:#16a34a;margin-top:8px;float:right}
    </style>
    <div class="box"><div class="t">GenClip</div><div class="m"></div><button>ทำต่อ</button></div>`;
    root.querySelector('.m').textContent = message;
    root.querySelector('button').onclick = () => {
      hint.clicked = true;
      host.remove();
    };
    document.documentElement.appendChild(host);
    return hint;
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'gc:ping') {
      sendResponse({ ok: true, site: GC.site });
      return;
    }
    if (msg?.type === 'gc:abort') {
      GC.aborted = true;
      GC.removeOverlay();
      sendResponse({ ok: true });
      return;
    }
    const handler = GC.handlers[msg?.type];
    if (!handler) return;
    GC.aborted = false;
    Promise.resolve()
      .then(() => handler(msg.payload || {}))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (err) => sendResponse({ ok: false, error: String(err?.message || err) })
      );
    return true;
  });

  window.GC = GC;
})();
