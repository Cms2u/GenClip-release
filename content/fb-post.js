// โพสต์ Reels ลงเพจ Facebook ผ่าน Meta Business Suite (business.facebook.com/latest/reels_composer)
// ขั้นตอน: แนบคลิป → ใส่คำอธิบาย (แคปชัน) → เปิดป้าย AI (ถ้ามีตัวเลือก) → กด "ถัดไป" จนถึงขั้นแชร์
//          → เลือก "แชร์ทันที" หรือ "กำหนดเวลา" → กดแชร์ (เมื่อเปิดโพสต์อัตโนมัติและทุกอย่างผ่าน)
(() => {
  const GC = window.GC;
  GC.site = 'facebook';

  const RX = {
    addVideo: /^(add video|upload video|เพิ่มวิดีโอ|อัปโหลดวิดีโอ|เลือกวิดีโอ)$/i,
    descLabel: /describe your reel|reel description|description|อธิบาย|คำอธิบาย|เขียนคำบรรยาย/i,
    next: /^(next|ถัดไป|ต่อไป)$/i,
    shareNow: /^(share now|publish now|แชร์ทันที|แชร์ตอนนี้|เผยแพร่ทันที|เผยแพร่ตอนนี้)$/i,
    scheduleOpt: /^(schedule|schedule for later|กำหนดเวลา|ตั้งเวลา|กำหนดเวลาโพสต์)$/i,
    // ปุ่มหลักขั้นสุดท้าย
    finalBtn: /^(share|publish|schedule|post|แชร์|เผยแพร่|กำหนดเวลา|ตั้งเวลา|โพสต์)$/i,
    uploading: /uploading|processing|กำลังอัปโหลด|กำลังประมวลผล|\d{1,3}\s?%/i,
    done: /your reel (has been|was) (shared|published|scheduled)|reel (shared|published|scheduled)|แชร์รีลแล้ว|เผยแพร่รีลแล้ว|กำหนดเวลารีลแล้ว|โพสต์แล้ว|กำหนดเวลาแล้ว|scheduled|published/i,
    // ป้าย AI (Meta: "AI info" / "ข้อมูล AI" / "สร้างด้วย AI")
    aiLabel: /ai info|ai label|made with ai|ai-generated|ai generated|ข้อมูล ?ai|ป้าย ?ai|สร้าง(ขึ้น)?(ด้วย|โดย) ?ai|เนื้อหา(ที่)?สร้าง(ขึ้น)?(ด้วย|โดย) ?ai/i,
  };

  const clickables = (root = document) =>
    [...root.querySelectorAll('button,[role="button"],[role="radio"],[role="switch"],[role="checkbox"],[role="tab"],[role="menuitem"],a,label')].filter(GC.isVisible);
  const labelOf = (el) => (GC.textOf(el) || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const enabled = (x) => !x.disabled && x.getAttribute('aria-disabled') !== 'true';
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const byOwnText = (rx, root = document) =>
    [...root.querySelectorAll('span,div,label,p,h2,h3')].find((el) => GC.onScreen(el) && rx.test(ownText(el)));
  // ปุ่มบนจอที่ชื่อตรง ถ้ามีหลายปุ่มใช้ตัวล่างสุด/ขวาสุด (ปุ่มหลักของหน้า)
  const findBtn = (rx, root = document) =>
    clickables(root)
      .filter((b) => rx.test(labelOf(b)) && GC.onScreen(b))
      .sort((a, c) => {
        const ra = a.getBoundingClientRect();
        const rc = c.getBoundingClientRect();
        return ra.bottom - rc.bottom || ra.right - rc.right;
      })
      .pop();
  const pad2 = (n) => String(n).padStart(2, '0');

  // หาในทั้งหน้า (รวมส่วนที่เลื่อนพ้นจอ) แล้วเลื่อนมาให้เห็นก่อนใช้
  const matchesAll = (rx) =>
    [
      ...clickables().filter((b) => rx.test(labelOf(b))),
      ...[...document.querySelectorAll('span,div,label,p,[role="option"],[role="menuitemradio"]')].filter((el) => GC.isVisible(el) && rx.test(ownText(el))),
    ].filter((el) => !el.closest('#genclip-hint,#genclip-ask'));
  const existsAnywhere = (rx) => matchesAll(rx).length > 0;
  async function reveal(rx) {
    for (const el of matchesAll(rx)) {
      el.scrollIntoView?.({ block: 'center' });
      await GC.sleep(400);
      if (GC.onScreen(el)) return el;
    }
    return null;
  }
  const pick = (el) => el.closest('[role="radio"],[role="menuitemradio"],[role="option"],[role="switch"],[role="button"],[role="combobox"],label,button') || el;
  // ตัวเลือกในขั้นแชร์ ไว้บอกผู้พัฒนาเมื่อหาตัวเลือกตั้งเวลาไม่เจอ
  const shareOptions = () =>
    [...document.querySelectorAll('[role="radio"],[role="combobox"],[role="switch"],input[type="radio"]')]
      .filter(GC.isVisible)
      .map((el) => labelOf(el.closest('label') || el.parentElement || el).slice(0, 30))
      .filter(Boolean)
      .slice(0, 12)
      .join(' / ');

  // ---------- แนบคลิป ----------

  const fileInput = () =>
    [...document.querySelectorAll('input[type="file"]')].find((i) => /video|mp4|\*/i.test(i.accept || '*')) ||
    document.querySelector('input[type="file"]');

  const attached = () => document.querySelector('video') || RX.uploading.test(document.body.innerText);

  async function attachVideo(file) {
    // Business Suite สร้างช่องเลือกไฟล์ชั่วคราวตอนกด "เพิ่มวิดีโอ" (ไม่อยู่ในหน้า) แล้วเปิดหน้าต่างเลือกไฟล์ของ Windows
    // จึงส่งไฟล์ให้ตัวช่วยในหน้า (ติดตั้งโดย side panel) ไว้ก่อน ตัวช่วยจะใส่ไฟล์แทนการเปิดหน้าต่าง
    let filled = false;
    const onFilled = (e) => e.source === window && e.data?.__genclipFilled && (filled = true);
    window.addEventListener('message', onFilled);
    window.postMessage({ __genclipFile: file }, '*');
    try {
      const input = fileInput();
      if (input && input.isConnected) {
        GC.setFiles(input, [file]);
        if (await GC.waitFor(attached, { timeout: 20000, label: 'วิดีโอที่แนบ' }).then(Boolean, () => false)) return;
      }
      const add = findBtn(RX.addVideo) || byOwnText(RX.addVideo) || findBtn(/add video|upload|เพิ่มวิดีโอ|อัปโหลด/i);
      if (!add) throw new Error('ไม่พบปุ่ม "เพิ่มวิดีโอ"');
      await GC.realClick(add.closest('[role="button"],button') || add);
      // แนบสำเร็จ = มีวิดีโอตัวอย่าง หรือแถบอัปโหลด
      await GC.waitFor(attached, { timeout: 60000, label: filled ? 'วิดีโอที่แนบ' : 'การแนบวิดีโอ' });
    } finally {
      window.removeEventListener('message', onFilled);
      window.postMessage({ __genclipFile: null }, '*');
    }
  }

  // ---------- คำอธิบาย (แคปชัน) ----------

  const descBox = () => {
    const boxes = [...document.querySelectorAll('[contenteditable="true"][role="textbox"],[contenteditable="true"],textarea')].filter(GC.onScreen);
    return (
      boxes.find((b) => RX.descLabel.test(`${b.getAttribute('aria-label') || ''} ${b.getAttribute('aria-placeholder') || ''} ${b.getAttribute('placeholder') || ''}`)) ||
      boxes.find((b) => RX.descLabel.test(b.closest('div[class]')?.parentElement?.innerText?.slice(0, 200) || '')) ||
      boxes[0]
    );
  };

  async function setCaption(text) {
    const box = await GC.waitFor(descBox, { timeout: 60000, label: 'ช่องคำอธิบายรีล' });
    await GC.realClick(box);
    await GC.sleep(300);
    await GC.typeInto(box, text);
    await GC.sleep(800);
    const head = text.slice(0, 15);
    if (!(box.value ?? box.innerText ?? '').includes(head)) {
      box.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
      await GC.sleep(800);
    }
    // ปิดรายการแนะนำแฮชแท็กที่อาจเด้งขึ้นมา
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return (box.value ?? box.innerText ?? '').includes(head);
  }

  // ---------- ป้าย AI (ถ้าหน้านั้นมีให้เลือก) ----------

  const isOn = (el) =>
    el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.checked === true;

  async function enableAiLabel() {
    const label = byOwnText(RX.aiLabel);
    if (!label) return null; // ไม่มีตัวเลือกในขั้นนี้
    // สวิตช์/ช่องติ๊กที่อยู่แถวเดียวกับข้อความ
    let row = label;
    let sw = null;
    for (let i = 0; i < 6 && row && !sw; i++, row = row.parentElement) {
      sw = row.querySelector('[role="switch"],[role="checkbox"],input[type="checkbox"]');
    }
    if (!sw) return null;
    if (isOn(sw)) return true;
    await GC.realClick(sw.matches('input') ? sw.closest('label') || sw : sw);
    await GC.sleep(800);
    return isOn(sw);
  }

  // ---------- ตั้งเวลา ----------

  const visibleInputs = () => [...document.querySelectorAll('input')].filter(GC.isVisible);

  // พิมพ์ค่าลงช่องแบบกดคีย์จริง (ช่องวันที่/เวลาของ Meta ไม่รับการตั้งค่า value ตรง ๆ)
  async function typeKeys(input, text) {
    await GC.realClick(input);
    input.focus();
    input.select?.();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await GC.sleep(500);
  }

  async function setSchedule({ y, mo, d, h, mi }) {
    let opt = await reveal(RX.scheduleOpt);
    if (!opt) {
      // ตัวเลือกอาจเป็นเมนูเลื่อนลงที่แสดง "แชร์ทันที" อยู่: เปิดเมนูก่อนแล้วเลือก "กำหนดเวลา"
      const menu = await reveal(RX.shareNow);
      if (menu) {
        await GC.realClick(pick(menu));
        await GC.sleep(1000);
        opt = await reveal(RX.scheduleOpt);
      }
    }
    if (!opt) throw new Error(`ไม่พบตัวเลือก "กำหนดเวลา" (ตัวเลือกในหน้า: ${shareOptions() || '-'})`);
    await GC.realClick(pick(opt));
    await GC.sleep(1200);
    const dateRx = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/;
    const timeRx = /^\d{1,2}:\d{2}(\s?[AP]M)?$/i;
    const { dateIn, timeIn } = await GC.waitFor(
      () => {
        const ins = visibleInputs();
        const dateIn = ins.find((i) => dateRx.test(i.value) || /dd|วัน|date/i.test(`${i.placeholder} ${i.getAttribute('aria-label') || ''}`));
        const timeIn = ins.find((i) => timeRx.test(i.value.trim()) || /time|เวลา|hh/i.test(`${i.placeholder} ${i.getAttribute('aria-label') || ''}`));
        return dateIn && timeIn ? { dateIn, timeIn } : null;
      },
      { timeout: 8000, label: 'ช่องวันที่/เวลา' }
    );
    GC.log(`Facebook: ตั้งเวลาโพสต์ ${pad2(d)}/${pad2(mo)}/${y} ${pad2(h)}:${pad2(mi)}...`);
    // รูปแบบวันที่ตามที่ช่องแสดงอยู่ (ค.ศ./พ.ศ. และลำดับ วัน/เดือน)
    const cur = dateIn.value || '';
    const be = /25\d\d/.test(cur);
    const yy = be ? y + 543 : y;
    const dateText = /^\d{4}-/.test(cur) ? `${yy}-${pad2(mo)}-${pad2(d)}` : /^\d{1,2}\/\d{1,2}\/\d{4}/.test(cur) && +cur.split('/')[0] <= 12 && +cur.split('/')[1] > 12 ? `${pad2(mo)}/${pad2(d)}/${yy}` : `${pad2(d)}/${pad2(mo)}/${yy}`;
    await typeKeys(dateIn, dateText);
    const ampm = /[AP]M/i.test(timeIn.value);
    const timeText = ampm ? `${pad2(((h + 11) % 12) + 1)}:${pad2(mi)} ${h < 12 ? 'AM' : 'PM'}` : `${pad2(h)}:${pad2(mi)}`;
    await typeKeys(timeIn, timeText);
    const parts = (dateIn.value.match(/\d+/g) || []).map(Number);
    const dateOk = parts.includes(d) && parts.includes(mo) && (parts.includes(y) || parts.includes(y + 543));
    const tParts = (timeIn.value.match(/\d+/g) || []).map(Number);
    const timeOk = tParts[1] === mi && (tParts[0] === h || tParts[0] === ((h + 11) % 12) + 1);
    if (!dateOk) throw new Error(`ใส่วันที่ไม่สำเร็จ (ช่องวันที่: ${dateIn.value})`);
    if (!timeOk) throw new Error(`ใส่เวลาไม่สำเร็จ (ช่องเวลา: ${timeIn.value})`);
    GC.log(`Facebook: ตั้งเวลาโพสต์เป็น ${dateIn.value} ${timeIn.value} แล้ว`, 'ok');
    return `${dateIn.value} ${timeIn.value}`;
  }

  // ---------- ขั้นตอนหลัก ----------

  // payload: { fileId, name, type, caption, autoPost, schedule?: { y, mo, d, h, mi } }
  GC.handlers['facebook:prepare'] = async ({ fileId, name, type, caption: text, autoPost, schedule }) => {
    const file = GC.takeFile(fileId, name, type);
    try {
      await attachVideo(file);
    } catch (e) {
      if (e.message === 'ABORTED') throw e;
      await GC.askOrFail(`แนบคลิปอัตโนมัติไม่สำเร็จ (${e.message})\nกรุณากด "เพิ่มวิดีโอ" แล้วเลือกไฟล์ ${name} (ในโฟลเดอร์ ClipFinal) เอง\nเมื่อเห็นวิดีโอในหน้าแล้วกด "ทำต่อ"`);
    }
    GC.log('Facebook: แนบคลิปแล้ว กำลังใส่คำอธิบาย...');
    const captionOk = await setCaption(text).catch((e) => {
      if (e.message === 'ABORTED') throw e;
      return false;
    });
    if (!captionOk) GC.log('Facebook: ใส่คำอธิบายอาจไม่ครบ กรุณาตรวจก่อนแชร์', 'warn');

    // กด "ถัดไป" จนถึงขั้นแชร์ (มีตัวเลือกแชร์ทันที/กำหนดเวลา) ระหว่างทางลองเปิดป้าย AI ทุกขั้น
    let aiOk = null;
    // ขั้นแชร์ = มีตัวเลือกแชร์ทันที/กำหนดเวลา (อาจเลื่อนพ้นจอ) หรือ มีปุ่ม "แชร์" แต่ไม่มีปุ่ม "ถัดไป" แล้ว
    const shareBtnNow = () =>
      clickables().find((x) => /^(share|publish|แชร์|เผยแพร่)$/i.test(labelOf(x)) && x.getAttribute('role') !== 'radio' && !x.querySelector('input[type="radio"],[role="radio"]'));
    const atShareStep = () => existsAnywhere(RX.scheduleOpt) || existsAnywhere(RX.shareNow) || (shareBtnNow() && !findBtn(RX.next));
    const deadline = Date.now() + 5 * 60000;
    while (!atShareStep() && Date.now() < deadline) {
      if (aiOk !== true) aiOk = (await enableAiLabel().catch(() => null)) ?? aiOk;
      const next = findBtn(RX.next);
      if (next && enabled(next)) {
        GC.log('Facebook: กด "ถัดไป"');
        await GC.realClick(next);
        await GC.sleep(2500);
      } else {
        // ปุ่มถัดไปยังกดไม่ได้ = คลิปยังอัปโหลดอยู่
        await GC.sleep(3000);
      }
    }
    if (aiOk !== true) aiOk = (await enableAiLabel().catch(() => null)) ?? aiOk;
    const shareStep = !!atShareStep();
    if (!shareStep) GC.log('Facebook: ยังไปไม่ถึงขั้นแชร์ (ไม่พบตัวเลือกแชร์ทันที/กำหนดเวลา)', 'warn');
    if (aiOk === null) GC.log('Facebook: ไม่พบตัวเลือกป้าย AI ในหน้านี้ (Meta อาจติดป้ายให้เองจากข้อมูลในไฟล์)');
    else GC.log(aiOk ? 'Facebook: เปิดป้าย AI แล้ว' : 'Facebook: เปิดป้าย AI ไม่สำเร็จ กรุณาเปิดเอง', aiOk ? 'ok' : 'warn');

    let scheduledAt = '';
    let scheduleError = '';
    if (shareStep) {
      if (schedule) {
        try {
          scheduledAt = await setSchedule(schedule);
        } catch (e) {
          if (e.message === 'ABORTED') throw e;
          scheduleError = e.message;
          GC.log(`Facebook: ตั้งเวลาไม่สำเร็จ (${e.message}) กรุณาตั้งเวลาเอง`, 'warn');
        }
      } else {
        const now = await reveal(RX.shareNow);
        if (now && !/combobox/.test(pick(now).getAttribute('role') || '')) await GC.realClick(pick(now));
        await GC.sleep(800);
      }
    }

    // ปุ่มแชร์พร้อมกด = อัปโหลดเสร็จ
    // ไม่นับตัวเลือก (radio) "กำหนดเวลา" ที่ชื่อเหมือนปุ่ม
    const finalBtn = () => {
      const b = clickables()
        .filter((x) => RX.finalBtn.test(labelOf(x)) && GC.isVisible(x) && x.getAttribute('role') !== 'radio' && !x.querySelector('input[type="radio"],[role="radio"]') && !x.closest('#genclip-hint,#genclip-ask'))
        .sort((a, c) => a.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom || a.getBoundingClientRect().right - c.getBoundingClientRect().right)
        .pop();
      return b && enabled(b) ? b : null;
    };
    const postReady = shareStep && (await GC.waitFor(finalBtn, { timeout: 180000, interval: 2000, label: 'อัปโหลดคลิปเสร็จ' }).then(Boolean, (e) => {
      if (e.message === 'ABORTED') throw e;
      return false;
    }));

    const scheduleOk = !schedule || !!scheduledAt;
    const allOk = captionOk && postReady && scheduleOk && aiOk !== false;
    let posted = false;
    let postError = '';
    if (autoPost && allOk) {
      const btn = finalBtn();
      const url = location.href;
      GC.log(`Facebook: กด "${labelOf(btn)}"`);
      await GC.realClick(btn);
      posted = await GC.waitFor(() => location.href !== url || RX.done.test(document.body.innerText) || !descBox(), {
        timeout: 90000,
        interval: 1500,
        label: 'ยืนยันการแชร์',
      }).then(
        () => true,
        (e) => {
          if (e.message === 'ABORTED') throw e;
          return false;
        }
      );
      GC.log(posted ? 'Facebook: แชร์รีลสำเร็จ ✓' : 'Facebook: กดแชร์แล้ว แต่ยังไม่เห็นการยืนยัน กรุณาตรวจในแท็บ Facebook', posted ? 'ok' : 'warn');
    } else if (autoPost) {
      const missing = [!captionOk && 'คำอธิบาย', aiOk === false && 'ป้าย AI', !shareStep && 'ขั้นแชร์', shareStep && !postReady && 'อัปโหลดยังไม่เสร็จ', !scheduleOk && 'ตั้งเวลา'].filter(Boolean);
      postError = `ไม่แชร์อัตโนมัติ เพราะยังไม่ผ่าน: ${missing.join(', ')}`;
      GC.log(`Facebook: ${postError} กรุณาตรวจแล้วกดแชร์เอง`, 'warn');
    }
    if (!posted) {
      GC.showHint(
        `รีลพร้อมแชร์แล้ว\nตรวจคลิป คำอธิบาย` +
          (schedule ? ` และเวลาโพสต์${scheduledAt ? ` (${scheduledAt})` : ' (ยังตั้งไม่ได้ กรุณาตั้งเอง)'}` : '') +
          ` แล้วกด "${schedule ? 'กำหนดเวลา' : 'แชร์'}" เอง\n(ปิดกล่องนี้ได้ด้วยปุ่มด้านล่าง)`
      );
    }
    return { captionOk, aiOk, postReady, posted, postError, scheduledAt, scheduleError };
  };

  GC.handlers['gc:inspect'] = async () => {
    const describe = (b) => `${labelOf(b).slice(0, 50)} | ${b.getAttribute('role') || b.tagName}${enabled(b) ? '' : ' (disabled)'}`;
    return {
      url: location.href,
      fileInputs: [...document.querySelectorAll('input[type="file"]')].map((i) => i.accept || '*'),
      descBox: descBox() ? `${descBox().tagName} ${descBox().getAttribute('aria-label') || descBox().getAttribute('aria-placeholder') || ''}` : null,
      aiLabel: byOwnText(RX.aiLabel)?.innerText.slice(0, 60) || null,
      inputs: visibleInputs().map((i) => `${i.type}:${i.placeholder || i.getAttribute('aria-label') || ''}=${i.value}${i.getAttribute('role') ? ` role=${i.getAttribute('role')}` : ''}`).slice(0, 30),
      spinbuttons: [...document.querySelectorAll('[role="spinbutton"],[role="combobox"],[role="listbox"],[aria-haspopup]')]
        .filter(GC.isVisible)
        .map((el) => `${el.tagName} role=${el.getAttribute('role') || ''} ${el.getAttribute('aria-label') || ''} = ${(el.value ?? GC.textOf(el) ?? '').toString().replace(/\s+/g, ' ').slice(0, 30)}`)
        .slice(0, 30),
      scheduleSection: (() => {
        const el = matchesAll(RX.scheduleOpt)[0];
        let box = el;
        for (let i = 0; i < 6 && box?.parentElement && (box.innerText || '').length < 300; i++) box = box.parentElement;
        return box ? box.innerText.replace(/\s+/g, ' ').slice(0, 600) : null;
      })(),
      switches: [...document.querySelectorAll('[role="switch"],[role="checkbox"],[role="radio"],input[type="checkbox"],input[type="radio"]')]
        .filter(GC.onScreen)
        .map((s) => `${s.getAttribute('role') || s.type} ${s.getAttribute('aria-label') || ''} checked=${isOn(s)}`)
        .slice(0, 20),
      buttons: clickables().filter(GC.onScreen).map(describe).slice(0, 50),
    };
  };
})();
