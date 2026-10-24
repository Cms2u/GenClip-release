// เตรียมโพสต์บน TikTok Studio (www.tiktok.com/tiktokstudio/upload):
// แนบคลิป ใส่แคปชัน เปิดป้ายเนื้อหา AI แล้วหยุดรอให้ผู้ใช้ตรวจและกด "โพสต์" เอง (ระบบไม่กดโพสต์ให้)
(() => {
  const GC = window.GC;
  GC.site = 'tiktok';

  const DEFAULTS = {
    fileInput: ['input[type="file"][accept*="video"]', 'input[type="file"]'],
    caption: ['.public-DraftEditor-content[contenteditable="true"]', '[contenteditable="true"][role="combobox"]', '[contenteditable="true"]'],
  };
  const RX = {
    selectVideo: /select video|select file|เลือกวิดีโอ|เลือกไฟล์|upload/i,
    uploaded: /uploaded|อัปโหลดแล้ว|อัปโหลดสำเร็จ/i,
    showMore: /show more|more options|advanced settings|แสดงเพิ่มเติม|ตัวเลือกเพิ่มเติม|การตั้งค่าขั้นสูง/i,
    aiLabel: /ai-generated|ai generated|เนื้อหาที่สร้าง(ขึ้น)?(โดย|ด้วย) ?ai|สร้างโดย ?ai|สร้างด้วย ?ai/i,
    confirm: /^(turn on|confirm|ok|เปิด|เปิดใช้งาน|ยืนยัน|ตกลง)$/i,
    post: /^(post|โพสต์)$/i,
    // ปุ่มหลักท้ายหน้า: "โพสต์" หรือเมื่อตั้งเวลาแล้วอาจเป็น "ตั้งเวลา"/"กำหนดเวลา"/"Schedule"
    postBtn: /^(post|โพสต์|schedule|ตั้งเวลา|กำหนดเวลา|ตั้งเวลาโพสต์|กำหนดเวลาโพสต์)$/i,
    scheduleRadio: /^(ตั้งเวลา|กำหนดเวลา|schedule)$/i,
    postConfirm: /^(โพสต์ตอนนี้|post now|โพสต์|post|ดำเนินการต่อ|continue|ยืนยัน|confirm)$/i,
    posted: /ตั้งเวลาแล้ว|กำหนดเวลาแล้ว|scheduled|โพสต์แล้ว|โพสต์วิดีโอแล้ว|อัปโหลดวิดีโอของคุณแล้ว|your video (has been|was) (posted|uploaded)|video published|จัดการโพสต์|manage (your )?posts/i,
    // ปักตะกร้า: ส่วน "เพิ่มลิงก์" > ปุ่มเพิ่ม > เลือกประเภท "สินค้า" > ค้นหา > เลือกสินค้า > ถัดไป > เพิ่ม
    addLinkLabel: /^(เพิ่มลิงก์|add link|ลิงก์|link)$/i,
    addBtn: /^(add\s*)?\+?\s*(เพิ่ม|add)$/i,
    productType: /^(สินค้า|products?|tiktok shop|ตะกร้า(สินค้า)?|shop)$/i,
    next: /^(ถัดไป|next|ต่อไป)$/i,
    // ปุ่มยืนยันท้ายหน้าต่าง (ชื่ออาจต่างกันไปตามหน้า)
    finish: /^(เพิ่ม(ลิงก์|สินค้า|ลงในวิดีโอ)?|add( link| product| to video)?|ยืนยัน|confirm|เสร็จสิ้น|done|บันทึก|save|ตกลง|ok|เลือก|select)$/i,
  };
  let S = DEFAULTS;

  async function loadSelectors() {
    const s = await GC.settings();
    S = { ...DEFAULTS, ...(s.selectors?.tiktok || {}) };
  }

  const clickables = (root = document) =>
    [...root.querySelectorAll('button,[role="button"],[role="switch"],[role="tab"],a,label')].filter(GC.isVisible);
  const findText = (rx, root = document) =>
    [...root.querySelectorAll('span,div,p,label,h2,h3,button')].find(
      (el) => GC.isVisible(el) && el.children.length <= 3 && rx.test((el.innerText || '').trim())
    );
  const caption = () => GC.q(S.caption);

  async function attachVideo(file) {
    const input = await GC.waitFor(() => GC.qAll(S.fileInput)[0], { timeout: 30000, label: 'ช่องอัปโหลดวิดีโอของ TikTok' }).catch((e) => {
      if (e.message === 'ABORTED') throw e;
      return null;
    });
    if (input) {
      GC.setFiles(input, [file]);
      // หน้าแก้ไขรายละเอียด (ช่องแคปชัน) จะขึ้นเมื่อเริ่มอัปโหลด
      if (await GC.waitFor(caption, { timeout: 60000, label: 'ช่องแคปชัน' }).then(Boolean, () => false)) return;
    }
    // ทางสำรอง: ลากไฟล์มาวางในกรอบอัปโหลด
    const zone = findText(RX.selectVideo)?.closest('div') || document.body;
    const dt = new DataTransfer();
    dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      zone.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
    if (await GC.waitFor(caption, { timeout: 30000, label: 'ช่องแคปชัน' }).then(Boolean, () => false)) return;
    throw new Error('แนบคลิปอัตโนมัติไม่สำเร็จ');
  }

  async function setCaption(text) {
    const box = await GC.waitFor(caption, { timeout: 30000, label: 'ช่องแคปชัน' });
    // TikTok ใส่ชื่อไฟล์เป็นแคปชันให้ก่อน จึงลบทิ้งแล้วใส่ใหม่
    box.click();
    await GC.typeInto(box, text);
    await GC.sleep(800);
    if (!(box.innerText || '').includes(text.slice(0, 15))) {
      // ทางสำรอง: เลือกข้อความเดิมทั้งหมดในช่องแคปชันแล้วพิมพ์ทับ
      box.focus();
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, text);
      await GC.sleep(800);
    }
    // ปิดรายการแนะนำแฮชแท็กที่อาจเด้งขึ้นมา
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const head = text.slice(0, 15);
    return (box.innerText || '').includes(head);
  }

  // หาข้อความ "เนื้อหาที่สร้างโดย AI": ตัดสระบน/ล่าง วรรณยุกต์ และช่องว่างก่อนเทียบ
  // (ข้อความไทยอาจเรียงสระ/วรรณยุกต์ต่างกันทั้งที่หน้าตาเหมือนกัน) และใช้คำว่า aigc ใต้สวิตช์ช่วยหา
  const squash = (s) => (s || '').replace(/[ัิ-ฺ็-๎\s]/g, '').toLowerCase();
  const AI_SQUASHED = /สรางโดยai|สรางดวยai|ai-?generated|aigc/;
  // ดูเฉพาะข้อความที่อยู่ใน element นั้นเองโดยตรง (ไม่รวมลูก) กันไม่ให้กล่องใหญ่ที่ครอบหลายแถวถูกนับเป็นป้าย AI
  // แล้วไปเจอสวิตช์ของแถวอื่น (เช่น "เผยแพร่เนื้อหาโพสต์")
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
  function findAiLabel() {
    return (
      [...document.querySelectorAll('span,div,p,label,h2,h3')].find(
        (el) => GC.isVisible(el) && AI_SQUASHED.test(squash(ownText(el)))
      ) || null
    );
  }

  // หาสวิตช์ที่อยู่ใกล้ข้อความ "เนื้อหาที่สร้างโดย AI"
  function aiSwitch() {
    const label = findAiLabel();
    if (!label) return null;
    let box = label;
    for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
      // สวิตช์อาจเป็น role=switch, checkbox หรือ div ที่ class มีคำว่า switch (แบบที่ TikTok ใช้ในส่วนตั้งค่า)
      const sw = box.querySelector('[role="switch"],input[type="checkbox"],[class*="switch" i]');
      if (sw) return sw.querySelector('input[type="checkbox"],[role="switch"]') || sw;
    }
    return null;
  }
  const isOn = (sw) =>
    sw.getAttribute('aria-checked') === 'true' ||
    sw.checked === true ||
    !!sw.querySelector?.('input:checked,[aria-checked="true"]') ||
    /\b(checked|is-checked|active|on)\b/i.test(sw.className?.baseVal ?? sw.className ?? '');

  async function enableAiLabel() {
    let sw = aiSwitch();
    if (!sw) {
      // "แสดงเพิ่มเติม" อาจมีหลายตัวบนหน้า และอาจเป็นแค่ div/span (ไม่ใช่ปุ่ม)
      // ลองทีละตัว เริ่มจากตัวที่อยู่ใกล้หัวข้อ "การตั้งค่า" ที่สุด จนกว่าจะเจอสวิตช์ป้าย AI
      const settingsHead = findText(/^(การตั้งค่า|settings)$/i);
      const headY = settingsHead ? settingsHead.getBoundingClientRect().top + scrollY : Infinity;
      const all = [...document.querySelectorAll('button,[role="button"],span,div,p,a')].filter(
        (el) => GC.isVisible(el) && el.children.length <= 3 && RX.showMore.test((el.innerText || '').trim()) && (el.innerText || '').trim().length < 30
      );
      const candidates = all
        .filter((el) => !all.some((o) => o !== el && el.contains(o)))
        .sort((a, b) => {
          const da = Math.abs(a.getBoundingClientRect().top + scrollY - headY);
          const db = Math.abs(b.getBoundingClientRect().top + scrollY - headY);
          return headY === Infinity ? 0 : da - db;
        });
      for (const more of candidates.slice(0, 4)) {
        GC.log(`TikTok: กด "${(more.innerText || '').trim()}" เพื่อหาสวิตช์ป้าย AI`);
        await GC.realClick(more);
        // รอส่วนที่ซ่อนอยู่เปิดออก (ไม่เกิน 6 วินาที)
        sw = await GC.waitFor(aiSwitch, { timeout: 6000, label: 'สวิตช์ป้าย AI' }).catch((e) => {
          if (e.message === 'ABORTED') throw e;
          return null;
        });
        if (sw) break;
      }
      if (!candidates.length) GC.log('TikTok: ไม่พบปุ่ม "แสดงเพิ่มเติม"', 'warn');
    }
    if (!sw) {
      GC.log(`TikTok: ไม่พบสวิตช์ป้าย AI (${findAiLabel() ? 'เจอข้อความแต่ไม่เจอสวิตช์' : 'ไม่เจอข้อความ "เนื้อหาที่สร้างโดย AI"'})`, 'warn');
      return false;
    }
    if (isOn(sw)) return true;
    // สวิตช์ของ TikTok อาจไม่รับคลิกจำลอง: ใช้คลิกเมาส์จริง (ถ้าสวิตช์เป็น input ซ่อน ใช้กล่อง label แทน)
    const target = GC.isVisible(sw) && sw.getBoundingClientRect().width ? sw : sw.closest('label') || sw.parentElement || sw;
    // คลิกจริงไม่ได้ (ใช้คลิกจำลองแทน) และเป้าหมายเป็นกล่องรอบสวิตช์: คลิกจำลองไม่ส่งถึงสวิตช์ด้านใน จึงคลิกที่สวิตช์ตรง ๆ
    if (!(await GC.realClick(target)) && target !== sw) sw.click();
    await GC.sleep(1000);
    // อาจมีหน้าต่างยืนยันการเปิดป้าย AI
    const dialog = topDialog();
    const ok = dialog && clickables(dialog).find((b) => RX.confirm.test(GC.textOf(b).trim()));
    if (ok) {
      await GC.realClick(ok);
      await GC.sleep(800);
    }
    return isOn(aiSwitch() || sw);
  }

  // ---------- ปักตะกร้าสินค้า ----------

  // ไม่ตัดคำว่า add (ปุ่มภาษาอังกฤษ "Add" จะกลายเป็นข้อความว่าง)
  const ICONS = /\b(add_circle|chevron_right|chevron_left|arrow_forward|arrow_back|search|close)\b/g;
  const labelOf = (el) => GC.textOf(el).replace(ICONS, '').replace(/\s+/g, ' ').trim();
  // หน้าต่าง (modal) ล่าสุดที่เปิดอยู่
  // ใช้กรอบที่ใหญ่ที่สุด (ตัวหน้าต่างจริง) ไม่ใช่ส่วนย่อยที่ชื่อ class มีคำว่า modal เช่น modal-footer
  const area = (el) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };
  const topDialog = () =>
    [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="Modal"]')]
      .filter(GC.isVisible)
      .sort((a, b) => area(b) - area(a))[0] || null;
  // ชื่อบนตะกร้าที่ปลอดภัย: เหลือแค่ตัวอักษรไทย/อังกฤษ ตัวเลข ช่องว่าง และยาวไม่เกิน max ตัวอักษร (ตัดที่ช่องว่าง)
  function cartName(name, max = 30) {
    const clean = name.replace(/[^฀-๿a-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if ([...clean].length <= max) return clean;
    const cut = [...clean].slice(0, max).join('');
    const sp = cut.lastIndexOf(' ');
    return (sp >= 10 ? cut.slice(0, sp) : cut).trim();
  }

  // กดปุ่มที่ชื่อตรง ถ้ามีหลายปุ่มเลือกตัวที่อยู่ล่างสุด (ปุ่มยืนยันอยู่ท้ายหน้าต่าง) คืนชื่อปุ่มที่กด
  const enabled = (x) => !x.disabled && x.getAttribute('aria-disabled') !== 'true';
  // เฉพาะปุ่มที่อยู่บนจอจริง (ปุ่มของขั้นก่อนหน้าที่ถูกซ่อนไว้ข้างหลังจะไม่นับ)
  const findIn = (root, rx) =>
    clickables(root)
      .filter((x) => enabled(x) && rx.test(labelOf(x)) && GC.onScreen(x))
      .sort((a, c) => a.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom)
      .pop();
  const clickIn = (root, rx) => {
    const b = findIn(root, rx);
    if (b) b.click();
    return b ? labelOf(b) || '(ไม่มีชื่อ)' : '';
  };
  // แบบคลิกเมาส์จริง (ใช้กับปุ่มที่ไม่รับคลิกจำลอง)
  const realClickIn = async (root, rx) => {
    const b = findIn(root, rx);
    if (b) await GC.realClick(b);
    return b ? labelOf(b) || '(ไม่มีชื่อ)' : '';
  };
  // ขั้นปักตะกร้ามีเวลาจำกัด (กันค้าง): ทุกขั้นเช็กเวลาก่อนทำต่อ
  let cartDeadline = Infinity;
  const step = (msg) => {
    if (Date.now() > cartDeadline) throw new Error(`หมดเวลา (ค้างหลังขั้น "${msg}")`);
    GC.log(`TikTok ตะกร้า: ${msg}`);
  };

  async function addProductLink(productId, productName) {
    const term = productId || productName.replace(/\s+/g, ' ').trim().slice(0, 30);
    if (!term) throw new Error('ไม่มีรหัสหรือชื่อสินค้าให้ค้นหา');

    // 1) ปุ่ม "+ เพิ่ม" ในส่วน "เพิ่มลิงก์"
    const label = findText(RX.addLinkLabel);
    if (!label) throw new Error('ไม่พบส่วน "เพิ่มลิงก์" (บัญชีนี้อาจยังไม่ได้เชื่อม TikTok Shop)');
    let addBtn = null;
    for (let box = label, i = 0; box && i < 5 && !addBtn; box = box.parentElement, i++) {
      addBtn = clickables(box).find((b) => RX.addBtn.test(labelOf(b)));
    }
    if (!addBtn) throw new Error('ไม่พบปุ่ม "เพิ่ม" ในส่วนเพิ่มลิงก์');
    addBtn.click();
    step('เปิดหน้าต่างเพิ่มลิงก์');
    let dlg = await GC.waitFor(topDialog, { timeout: 10000, label: 'หน้าต่างเพิ่มลิงก์' });

    // 2) เลือกประเภทลิงก์ "สินค้า" (ถ้ามีให้เลือก) แล้วกดถัดไป
    const combo = dlg.querySelector('[role="combobox"],select');
    if (combo && !RX.productType.test(labelOf(combo))) {
      const option = () => [...document.querySelectorAll('[role="option"],li,option')].find((o) => GC.isVisible(o) && RX.productType.test(labelOf(o)));
      combo.click();
      await GC.sleep(800);
      // บางเมนูเปิดด้วย pointerdown เท่านั้น: ลองแบบนั้นเมื่อคลิกแล้วยังไม่มีตัวเลือกขึ้น
      if (!option()) {
        GC.press(combo);
        await GC.sleep(800);
      }
      option()?.click();
      await GC.sleep(600);
    } else {
      clickIn(dlg, RX.productType);
      await GC.sleep(600);
    }
    if (clickIn(dlg, RX.next)) {
      step('เลือกประเภท "สินค้า" แล้ว');
      await GC.sleep(1500);
      dlg = topDialog() || dlg;
    }

    // 3) ค้นหาสินค้า: ใช้ช่องค้นหาในหน้าต่างเพิ่มลิงก์ก่อน (หน้า TikTok Studio มีช่อง "ค้นหา" อื่นอยู่นอกหน้าต่างด้วย)
    const textInputs = (root) =>
      [...root.querySelectorAll('input[type="text"],input[type="search"],input:not([type])')].filter(GC.isVisible);
    const hintOf = (i) => `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''}`;
    const findSearch = () => {
      const d = topDialog();
      const inDlg = d ? textInputs(d) : [];
      return (
        inDlg.find((i) => /ค้นหาสินค้า|search product/i.test(hintOf(i))) ||
        textInputs(document).find((i) => /ค้นหาสินค้า|search product/i.test(hintOf(i))) ||
        inDlg.find((i) => /ค้นหา|search/i.test(hintOf(i))) ||
        inDlg[0]
      );
    };
    const search = await GC.waitFor(findSearch, { timeout: 10000, label: 'ช่องค้นหาสินค้า' });
    // หน้าต่างเลือกสินค้า = กรอบที่ครอบช่องค้นหาและตารางสินค้า
    dlg = search.closest('[role="dialog"],[aria-modal="true"]') || topDialog() || document.body;
    search.focus();
    search.click();
    GC.setNativeValue(search, term);
    for (const type of ['keydown', 'keypress', 'keyup']) {
      search.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    // ปุ่มแว่นขยายข้างช่องค้นหา (ถ้ามี)
    let box = search.parentElement;
    for (let i = 0; i < 3 && box; i++, box = box.parentElement) {
      const icon = [...box.querySelectorAll('button,[role="button"],svg')].find((b) => b !== search && GC.isVisible(b));
      if (icon) {
        (icon.closest('button,[role="button"]') || icon).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        break;
      }
    }
    step(`ค้นหา "${term}" (ช่องค้นหาตอนนี้: "${search.value.slice(0, 30)}")`);
    await GC.sleep(3000);

    // 4) หาแถวสินค้าจากเลข "ID สินค้า" ในตาราง (ไม่พึ่งปุ่ม radio เพราะอาจเป็นปุ่มที่ทำเอง)
    //    แถว = กล่องที่ครอบทั้งเลข ID และชื่อสินค้า
    const idCells = [...dlg.querySelectorAll('*')].filter(
      (el) => GC.isVisible(el) && /^\d{15,}$/.test((el.textContent || '').trim()) && ![...el.children].some((c) => /\d{15,}/.test(c.textContent || ''))
    );
    const rows = idCells.map((cell) => {
      let r = cell;
      for (let k = 0; k < 8 && r.parentElement && r.parentElement !== dlg; k++) {
        r = r.parentElement;
        if (/[ก-๙a-z]{4,}/i.test((r.textContent || '').replace(cell.textContent, ''))) break;
      }
      return { row: r, id: cell.textContent.trim() };
    });
    // ทางสำรอง: เลข ID ไม่ได้อยู่ในช่องของตัวเอง (เช่น "ID: 123…" รวมกับชื่อ) ใช้ปุ่มเลือกแต่ละแถวแทน
    if (!rows.length) {
      for (const el of dlg.querySelectorAll('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]')) {
        let r = el;
        for (let k = 0; k < 8 && r.parentElement && r.parentElement !== dlg && !/\d{15,}/.test(r.textContent || ''); k++) r = r.parentElement;
        const id = ((r.textContent || '').match(/\d{15,}/) || [''])[0];
        rows.push({ row: r, id });
      }
    }
    const norm = (s) => (s || '').replace(/["'“”\s…]/g, '');
    const commonPrefix = (a, b) => {
      let n = 0;
      while (n < a.length && a[n] === b[n]) n++;
      return n;
    };
    // ชื่อสินค้าอยู่ต้นแถว: ใช้ข้อความทั้งแถวที่ตัดเลข ID ออก (เทียบแค่ส่วนต้นอยู่แล้ว)
    const nameOf = (row, id) => (row.textContent || '').replace(id, ' ').trim();
    let hit = null;
    if (productId) hit = rows.find((r) => r.id === productId);
    else {
      const want = norm(productName);
      const scored = rows.map((r) => ({ ...r, score: commonPrefix(want, norm(nameOf(r.row, r.id))) })).sort((a, b) => b.score - a.score);
      if (scored[0] && scored[0].score >= 10 && (!scored[1] || scored[0].score > scored[1].score)) hit = scored[0];
    }
    if (!hit && rows.length === 1) hit = rows[0];
    if (!hit) {
      throw new Error(
        rows.length
          ? `ตารางมี ${rows.length} สินค้า แต่ไม่พบตัวที่ตรงกับ "${term}"${productId ? ' (สินค้าอาจอยู่หน้าถัดไป หรือรหัสไม่ถูก)' : ' (ใส่รหัสสินค้าด้วยปุ่ม 🛒 จะแม่นที่สุด)'}`
          : `ไม่พบตารางสินค้าในหน้าต่าง (ผลค้นหา "${term}" ว่าง)`
      );
    }
    // ปุ่มเลือกในแถว: radio/checkbox มาตรฐาน หรือกล่องที่ class มีคำว่า radio/check ถ้าไม่มี กดที่แถว
    const picker =
      hit.row.querySelector('input[type="radio"],input[type="checkbox"],[role="radio"],[role="checkbox"]') ||
      [...hit.row.querySelectorAll('[class*="radio" i],[class*="check" i]')].find(GC.isVisible);
    const isChecked = () =>
      !!hit.row.querySelector('input:checked,[aria-checked="true"],[class*="checked" i],[class*="selected" i],[class*="active" i]');
    // คลิกเมาส์จริงที่ปุ่มเลือก (ถ้าปุ่มซ่อนอยู่ ใช้กล่อง label หรือทั้งแถวแทน)
    const visiblePicker = picker && (GC.isVisible(picker) && picker.getBoundingClientRect().width ? picker : picker.closest('label'));
    const trusted = await GC.realClick(visiblePicker || hit.row);
    // คลิกจริงไม่ได้: คลิกจำลองที่ปุ่มเลือกตรง ๆ (คลิกจำลองที่แถว/label ไม่ส่งถึงปุ่มด้านใน)
    if (!trusted && picker) (picker.closest('label') || picker).click();
    await GC.sleep(500);
    if (!isChecked()) await GC.realClick(hit.row);
    await GC.sleep(400);
    step(`เลือกสินค้าแล้ว (ID ${hit.id}${isChecked() ? '' : ' · ยืนยันการเลือกไม่ได้'})`);
    await GC.sleep(800);

    // 5) กดถัดไป แล้วกดเพิ่ม/ยืนยัน (บางหน้ามีขั้นแก้ชื่อสินค้าก่อน) จนกว่าหน้าต่างจะปิด
    // ยังอยู่ขั้นเลือกสินค้า = ช่องค้นหาอยู่บนจอจริง (TikTok อาจเก็บขั้นนี้ไว้แบบซ่อนหลังขั้นตั้งชื่อ)
    const onSearchStep = () => search.isConnected && GC.onScreen(search);
    const dialogOpen = () => onSearchStep() || (dlg.isConnected && GC.isVisible(dlg) && dlg !== document.body);
    // ช่องชื่อสินค้าบนตะกร้า (ขั้นสุดท้าย) อาจเป็น input หรือ textarea
    const nameFields = (root) =>
      [...root.querySelectorAll('input[type="text"],input:not([type]),textarea')].filter(
        (x) => x !== search && GC.onScreen(x) && (!dlg || dlg === document.body || dlg.contains(x) || !!x.closest('[role="dialog"],[aria-modal="true"]'))
      );
    // หน้าต่างที่อยู่บนสุดของจอ (ขั้นตั้งชื่ออาจเป็นหน้าต่างใหม่ซ้อนบนหน้าต่างเลือกสินค้า)
    const activeDialog = () =>
      [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="modal" i],[class*="Modal"]')]
        .filter((x) => GC.isVisible(x) && GC.onScreen(x))
        .sort((a, b) => area(b) - area(a))[0] || null;
    for (let i = 0; i < 8 && dialogOpen(); i++) {
      const d = activeDialog() || (dlg.isConnected && dlg !== document.body && GC.isVisible(dlg) ? dlg : null) || topDialog();
      if (!d) break;
      dlg = d;
      const fields = onSearchStep() ? [] : nameFields(d);
      // ขั้นตั้งชื่อสินค้าบนตะกร้า: TikTok จำกัด 30 ตัวอักษรและอาจไม่รับอักขระพิเศษ
      for (const input of fields) {
        if (!input.value.trim()) continue;
        const max = Math.min(30, parseInt(input.getAttribute('maxlength'), 10) || 30);
        // ใช้ชื่อสินค้าเต็มเป็นต้นทาง (ช่องที่ TikTok เติมให้ถูกตัดกลางคำมาแล้ว เช่น "…ผ้าไหม" จาก "ผ้าไหมพรทิพย์")
        const safe = cartName(productName || input.value, max);
        if (safe && safe !== input.value) {
          GC.setNativeValue(input, safe);
          step(`ตั้งชื่อบนตะกร้าเป็น "${safe}"`);
          await GC.sleep(500);
        }
      }
      // ขั้นตั้งชื่อ: กด "เพิ่ม" ก่อน / ขั้นเลือกสินค้า: กด "ถัดไป" ก่อน
      const pressed = fields.length
        ? (await realClickIn(d, RX.finish)) || (await realClickIn(d, RX.next))
        : (await realClickIn(d, RX.next)) || (await realClickIn(d, RX.finish));
      if (!pressed) break;
      step(`กด "${pressed}"`);
      // รอหน้าต่างเปลี่ยน (ไปขั้นตั้งชื่อ หรือปิด) ไม่เกิน 5 วินาที
      const before = (d.innerText || '').length;
      await GC.waitFor(() => !dialogOpen() || !d.isConnected || Math.abs((d.innerText || '').length - before) > 20, {
        timeout: 5000,
        label: 'หน้าต่างเปลี่ยน',
      }).catch((e) => {
        if (e.message === 'ABORTED') throw e;
      });
      if (!dlg.isConnected || !GC.isVisible(dlg)) dlg = topDialog() || dlg;
    }
    if (dialogOpen()) {
      // บอกว่าปุ่มในหน้าต่างมีอะไรบ้าง (ตัวไหนกดไม่ได้) ไว้แก้ชื่อปุ่มให้ตรงกับหน้าจริง
      const d = dlg.isConnected && dlg !== document.body ? dlg : topDialog() || document.body;
      const names = clickables(d)
        .map((x) => `${labelOf(x) || '?'}${enabled(x) ? '' : '(กดไม่ได้)'}`)
        .filter((n) => n.length < 30);
      throw new Error(`หน้าต่างเพิ่มลิงก์ยังไม่ปิด · ปุ่มในหน้าต่าง: ${names.slice(-10).join(', ') || '-'}`);
    }
    step('ปักตะกร้าแล้ว');
    return true;
  }

  // payload: { fileId, name, type, caption, productId, productName }
  // กดโพสต์ (เมื่อผู้ใช้เปิดตัวเลือกโพสต์อัตโนมัติ) แล้วรอดูว่าโพสต์สำเร็จ
  async function clickPost() {
    // ปุ่มหลักอยู่ล่างสุดของหน้า (ไม่ใช่ตัวเลือก "ตั้งเวลา" ในส่วนเวลาโพสต์ที่ชื่อเหมือนกัน)
    const byBottom = (list) => list.sort((a, c) => a.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom).pop();
    const post =
      byBottom(clickables().filter((b) => RX.postBtn.test(labelOf(b)) && enabled(b) && /button/i.test(b.tagName + (b.getAttribute('role') || '')))) ||
      clickables().find((b) => RX.post.test(labelOf(b)) && enabled(b));
    if (!post) throw new Error('ไม่พบปุ่มโพสต์');
    const url = location.href;
    await GC.realClick(post);
    GC.log('TikTok: กดโพสต์แล้ว กำลังรอยืนยัน...');
    // อาจมีหน้าต่างถามยืนยัน เช่น "โพสต์ตอนนี้" ระหว่างที่ระบบยังตรวจเนื้อหาอยู่
    await GC.sleep(2000);
    const d = topDialog();
    if (d) {
      const ok = findIn(d, RX.postConfirm);
      if (ok) {
        GC.log(`TikTok: กด "${labelOf(ok)}" ในหน้าต่างยืนยัน`);
        await GC.realClick(ok);
      }
    }
    // สำเร็จ = ออกจากหน้าอัปโหลด หรือมีข้อความว่าโพสต์/อัปโหลดแล้ว
    return GC.waitFor(() => location.href !== url || RX.posted.test(document.body.innerText), { timeout: 60000, interval: 1000, label: 'ยืนยันการโพสต์' }).then(
      () => true,
      (e) => {
        if (e.message === 'ABORTED') throw e;
        return false;
      }
    );
  }

  // ---------- ตั้งเวลาโพสต์ ----------

  const pad2 = (n) => String(n).padStart(2, '0');
  // element ที่ข้อความของตัวเอง (ไม่รวมลูก) ตรงกับ rx
  const byOwnText = (rx) =>
    [...document.querySelectorAll('label,span,div,p,button')].find(
      (el) => GC.isVisible(el) && rx.test([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim())
    );
  const inputsNow = () => [...document.querySelectorAll('input')].filter(GC.isVisible);
  const isTimeVal = (v) => /^\d{1,2}:\d{2}$/.test((v || '').trim());
  const isDateVal = (v) => /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(v || '');
  const dateParts = (v) => (v.match(/\d+/g) || []).map(Number);

  // ตัวเลือกในรายการที่เพิ่งเปิดขึ้น (ไม่มีอยู่ก่อนคลิก) ข้อความตรงกับ rx
  const freshItems = (seen, rx) =>
    [...document.querySelectorAll('li,span,div,button,td,[role="option"],[role="gridcell"]')].filter(
      (el) => !seen.has(el) && GC.isVisible(el) && el.children.length === 0 && rx.test((el.textContent || '').trim())
    );
  const disabledItem = (el) =>
    !!el.closest('[aria-disabled="true"],[disabled]') || /disabled/i.test(String(el.className?.baseVal ?? el.className ?? ''));

  async function pickTime(input, h, m) {
    const seen = new Set(document.querySelectorAll('*'));
    await GC.realClick(input);
    await GC.sleep(800);
    // รายการชั่วโมง/นาที: ตัวเลข 2 หลัก แยกเป็นคอลัมน์ตามตำแหน่งแนวนอน (ซ้าย = ชั่วโมง ขวา = นาที)
    const items = freshItems(seen, /^\d{2}$/);
    const cols = new Map();
    for (const el of items) {
      const key = el.parentElement;
      if (!cols.has(key)) cols.set(key, []);
      cols.get(key).push(el);
    }
    const lists = [...cols.entries()]
      .filter(([, els]) => els.length >= 4)
      .sort((a, b) => a[0].getBoundingClientRect().left - b[0].getBoundingClientRect().left)
      .map(([, els]) => els);
    if (lists.length < 2) throw new Error('ไม่พบรายการเลือกชั่วโมง/นาที');
    const [hours, mins] = lists;
    const hourEl = hours.find((el) => el.textContent.trim() === pad2(h));
    // นาทีอาจมีให้เลือกทีละ 5: ใช้ค่าที่ใกล้ที่สุดที่ไม่น้อยกว่าเวลาที่ต้องการ
    const minEl = mins
      .filter((el) => !disabledItem(el))
      .sort((a, b) => Math.abs(+a.textContent - m) - Math.abs(+b.textContent - m))[0];
    if (!hourEl || !minEl) throw new Error(`ไม่พบเวลา ${pad2(h)}:${pad2(m)} ในรายการ`);
    await GC.realClick(hourEl);
    await GC.sleep(400);
    await GC.realClick(minEl);
    await GC.sleep(600);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return `${pad2(h)}:${minEl.textContent.trim()}`;
  }

  async function pickDate(input, y, mo, d) {
    const matches = () => {
      const p = dateParts(input.value);
      return p.includes(y) && p.includes(mo) && p.includes(d);
    };
    if (matches()) return true;
    for (let monthStep = 0; monthStep < 3; monthStep++) {
      const seen = new Set(document.querySelectorAll('*'));
      await GC.realClick(input);
      await GC.sleep(800);
      const day = freshItems(seen, /^\d{1,2}$/).find((el) => +el.textContent.trim() === d && !disabledItem(el));
      if (day) {
        await GC.realClick(day);
        await GC.sleep(800);
        if (matches()) return true;
      }
      // ยังเป็นเดือนอื่น: กดไปเดือนถัดไป (ปุ่มลูกศรขวาในปฏิทินที่เพิ่งเปิด) แล้วลองใหม่
      const next = [...document.querySelectorAll('button,[role="button"],span,div,svg')].find(
        (el) => !seen.has(el) && GC.isVisible(el) && /next|ถัดไป|chevron_right|arrow_right|›|>/i.test(`${el.getAttribute?.('aria-label') || ''} ${el.textContent || ''} ${el.getAttribute?.('class') || ''}`) && (el.textContent || '').length < 5
      );
      if (next) {
        await GC.realClick(next);
        await GC.sleep(600);
        const day2 = [...document.querySelectorAll('li,span,div,button,td,[role="gridcell"]')].find(
          (el) => GC.isVisible(el) && el.children.length === 0 && +((el.textContent || '').trim()) === d && /^\d{1,2}$/.test((el.textContent || '').trim()) && !disabledItem(el) && !seen.has(el)
        );
        if (day2) {
          await GC.realClick(day2);
          await GC.sleep(800);
          if (matches()) return true;
        }
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await GC.sleep(400);
    }
    return matches();
  }

  // ตั้งเวลาโพสต์: เลือก "ตั้งเวลา" แล้วกรอกวันที่/เวลา คืน true เมื่อหน้าแสดงค่าที่ตั้งตรงกัน
  async function setSchedule({ y, mo, d, h, mi }) {
    const radio = byOwnText(RX.scheduleRadio);
    if (!radio) throw new Error('ไม่พบตัวเลือก "ตั้งเวลา"');
    const before = new Set(inputsNow());
    await GC.realClick(radio.closest('label') || radio);
    // ช่องวันที่/เวลาที่ขึ้นมาหลังเลือก "ตั้งเวลา"
    const { dateIn, timeIn } = await GC.waitFor(
      () => {
        const ins = inputsNow();
        const timeIn = ins.find((i) => isTimeVal(i.value) && (!before.has(i) || ins.length > before.size)) || ins.find((i) => isTimeVal(i.value));
        const dateIn = ins.find((i) => isDateVal(i.value));
        return timeIn && dateIn ? { dateIn, timeIn } : null;
      },
      { timeout: 8000, label: 'ช่องวันที่/เวลาโพสต์' }
    );
    GC.log(`TikTok: ตั้งเวลาโพสต์ ${pad2(d)}/${pad2(mo)}/${y} ${pad2(h)}:${pad2(mi)}...`);
    if (!(await pickDate(dateIn, y, mo, d))) throw new Error(`เลือกวันที่ไม่สำเร็จ (ช่องวันที่: ${dateIn.value})`);
    const chosen = await pickTime(timeIn, h, mi);
    if (timeIn.value.trim() !== chosen) throw new Error(`เลือกเวลาไม่สำเร็จ (ช่องเวลา: ${timeIn.value})`);
    GC.log(`TikTok: ตั้งเวลาโพสต์เป็น ${dateIn.value} ${timeIn.value} แล้ว`, 'ok');
    return `${dateIn.value} ${timeIn.value}`;
  }

  // payload: { ..., schedule?: { y, mo, d, h, mi } } ไม่มี schedule = โพสต์ทันที
  GC.handlers['tiktok:prepare'] = async ({ fileId, name, type, caption: text, productId, productName, autoPost, schedule }) => {
    await loadSelectors();
    const file = GC.takeFile(fileId, name, type);

    try {
      await attachVideo(file);
    } catch (e) {
      if (e.message === 'ABORTED') throw e;
      await GC.askOrFail(`แนบคลิปอัตโนมัติไม่สำเร็จ\nกรุณาลากไฟล์ ${name} (ในโฟลเดอร์ Downloads/ClipFinal) มาวางในหน้าอัปโหลดเอง\nเมื่อเห็นช่องแคปชันแล้วกด "ทำต่อ"`);
    }
    GC.log('TikTok: แนบคลิปแล้ว กำลังใส่แคปชัน...');

    const captionOk = await setCaption(text);
    if (!captionOk) GC.log('TikTok: ใส่แคปชันอาจไม่ครบ กรุณาตรวจก่อนโพสต์', 'warn');

    // ป้าย AI ทำหลังอัปโหลดเสร็จ (ส่วน "การตั้งค่า" อาจยังไม่ขึ้นครบระหว่างอัปโหลด) ดูด้านล่าง
    let aiOk = false;

    let cartOk = false;
    let cartError = '';
    if (productId || productName) {
      try {
        // ให้เวลาปักตะกร้าไม่เกิน 90 วินาที ถ้าเกินจะข้ามไปทำขั้นอื่นต่อ (ผู้ใช้ปักเองได้)
        cartDeadline = Date.now() + 90000;
        cartOk = await Promise.race([
          addProductLink(productId, productName),
          GC.sleep(90000).then(() => {
            throw new Error('ใช้เวลาเกิน 90 วินาที');
          }),
        ]);
      } catch (e) {
        if (e.message === 'ABORTED') throw e;
        cartError = e.message;
        GC.log(`TikTok ตะกร้า: ไม่สำเร็จ (${e.message}) กรุณาปักตะกร้าเอง`, 'warn');
        // ปิดหน้าต่างที่ค้างไว้ ให้ผู้ใช้ทำต่อเองได้
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      } finally {
        // หยุดขั้นตอนปักตะกร้าที่อาจยังทำงานค้างอยู่เบื้องหลัง (ขั้นถัดไปจะ throw ทันที)
        cartDeadline = 0;
      }
    }

    // รอให้อัปโหลดเสร็จ (ปุ่มโพสต์กดได้) แต่ไม่กดโพสต์ให้
    GC.log('TikTok: รออัปโหลดคลิปเสร็จ (ไม่เกิน 3 นาที)...');
    const postReady = await GC.waitFor(
      () => clickables().find((b) => RX.post.test(GC.textOf(b).trim()) && !b.disabled && b.getAttribute('aria-disabled') !== 'true'),
      { timeout: 180000, interval: 2000, label: 'อัปโหลดคลิปเสร็จ' }
    ).then(Boolean, (e) => {
      if (e.message === 'ABORTED') throw e;
      return false;
    });

    // เปิดป้าย "เนื้อหาที่สร้างโดย AI" (ลอง 2 รอบ)
    for (let attempt = 1; attempt <= 2 && !aiOk; attempt++) {
      aiOk = await enableAiLabel().catch((e) => {
        if (e.message === 'ABORTED') throw e;
        return false;
      });
      if (!aiOk && attempt === 1) await GC.sleep(2000);
    }
    GC.log(aiOk ? 'TikTok: เปิดป้าย "เนื้อหาที่สร้างโดย AI" แล้ว' : 'TikTok: เปิดป้ายเนื้อหา AI ไม่สำเร็จ กรุณาเปิดเอง', aiOk ? 'ok' : 'warn');

    // ตั้งเวลาโพสต์ (ถ้ากำหนดมา) ถ้าตั้งไม่สำเร็จจะไม่โพสต์ทันทีแทน แต่หยุดให้ผู้ใช้ตั้งเวลาเอง
    let scheduledAt = '';
    let scheduleError = '';
    if (schedule) {
      try {
        scheduledAt = await setSchedule(schedule);
      } catch (e) {
        if (e.message === 'ABORTED') throw e;
        scheduleError = e.message;
        GC.log(`TikTok: ตั้งเวลาโพสต์ไม่สำเร็จ (${e.message}) กรุณาตั้งเวลาเอง`, 'warn');
      }
    }

    // โพสต์อัตโนมัติ: เฉพาะเมื่อทุกอย่างผ่านครบ (แคปชัน ป้าย AI ตะกร้า อัปโหลดเสร็จ เวลาโพสต์) ไม่งั้นหยุดให้ผู้ใช้ตรวจ
    const wantCart = !!(productId || productName);
    const scheduleOk = !schedule || !!scheduledAt;
    const allOk = captionOk && aiOk && (cartOk || !wantCart) && postReady && scheduleOk;
    let posted = false;
    let postError = '';
    if (autoPost && allOk) {
      try {
        posted = await clickPost();
        GC.log(posted ? 'TikTok: โพสต์สำเร็จ ✓' : 'TikTok: กดโพสต์แล้ว แต่ยังไม่เห็นการยืนยัน กรุณาตรวจในแท็บ TikTok', posted ? 'ok' : 'warn');
      } catch (e) {
        if (e.message === 'ABORTED') throw e;
        postError = e.message;
      }
    } else if (autoPost) {
      const missing = [!captionOk && 'แคปชัน', !aiOk && 'ป้าย AI', wantCart && !cartOk && 'ตะกร้า', !postReady && 'อัปโหลดยังไม่เสร็จ', !scheduleOk && 'ตั้งเวลาโพสต์'].filter(Boolean);
      postError = `ไม่โพสต์อัตโนมัติ เพราะยังไม่ผ่าน: ${missing.join(', ')}`;
      GC.log(`TikTok: ${postError} กรุณาตรวจแล้วกดโพสต์เอง`, 'warn');
    }

    if (!posted) {
      GC.showHint(
        `คลิปพร้อมโพสต์แล้ว\nตรวจคลิป แคปชัน ป้ายเนื้อหา AI${aiOk ? '' : ' (ยังไม่ได้เปิด กรุณาเปิดเอง)'} ` +
          `และตะกร้าสินค้า${cartOk ? '' : ' (ยังไม่ได้ปัก กรุณาปักเอง)'}` +
          (schedule ? ` และเวลาโพสต์${scheduledAt ? ` (${scheduledAt})` : ' (ยังตั้งไม่ได้ กรุณาตั้งเอง)'}` : '') +
          ` แล้วกด "${schedule ? 'ตั้งเวลา' : 'โพสต์'}" เอง\n(ปิดกล่องนี้ได้ด้วยปุ่มด้านล่าง)`
      );
    }
    return { captionOk, aiOk, cartOk, cartError, postReady, posted, postError, scheduledAt, scheduleError };
  };

  GC.handlers['gc:inspect'] = async () => {
    await loadSelectors();
    const describe = (b) => `${GC.textOf(b).replace(/\s+/g, ' ').slice(0, 50)} | ${b.getAttribute('role') || b.tagName}`;
    const sw = aiSwitch();
    return {
      url: location.href,
      fileInputs: [...document.querySelectorAll('input[type="file"]')].map((i) => i.accept || '*'),
      caption: caption() ? `${caption().tagName}.${caption().className.toString().slice(0, 60)}` : null,
      aiLabelText: findText(RX.aiLabel)?.innerText.slice(0, 60) || null,
      aiSwitch: sw ? `${sw.tagName} role=${sw.getAttribute('role')} checked=${isOn(sw)}` : null,
      switches: [...document.querySelectorAll('[role="switch"],input[type="checkbox"]')].length,
      addLinkLabel: findText(RX.addLinkLabel)?.innerText.slice(0, 40) || null,
      dialog: topDialog() ? clickables(topDialog()).map(describe).slice(0, 30) : null,
      dialogInputs: topDialog() ? [...topDialog().querySelectorAll('input')].map((i) => `${i.type}:${i.placeholder || ''}`).slice(0, 20) : null,
      buttons: clickables().map(describe).slice(0, 40),
    };
  };
})();
