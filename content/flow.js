// ควบคุมหน้า Google Flow (flow.google.com แบบแชต และ labs.google แบบเดิม): แนบเฟรมแรก, ใส่ prompt, กดสร้าง, รอวิดีโอ
(() => {
  const GC = window.GC;
  GC.site = 'flow';

  // selector/regex ตั้งต้น แก้ได้ในหน้าตั้งค่า (settings.selectors.flow)
  const DEFAULTS = {
    promptBox: ['textarea#PINHOLE_TEXT_AREA_ELEMENT_ID', 'textarea', '[contenteditable="true"]'],
    fileInput: ['input[type="file"]'],
  };
  const RX = {
    modeMenu: /text to video|frames to video|ingredients to video|ข้อความเป็นวิดีโอ|เฟรมเป็นวิดีโอ|ส่วนผสมเป็นวิดีโอ/i,
    framesMode: /frames?\s*to\s*video|เฟรมเป็นวิดีโอ/i,
    // ปุ่ม + สำหรับแนบไฟล์ในช่องพิมพ์ (Flow แบบแชต) หรือช่องเฟรมแรก (Flow แบบเดิม)
    addFrame: /^add\b|add_photo|add_a_photo|add media|attach|upload|first frame|เฟรมแรก|เพิ่ม|แนบ/i,
    uploadItem: /upload|อัปโหลด|from (your )?(computer|device)|จากอุปกรณ์|จากคอมพิวเตอร์|browse|เลือกไฟล์/i,
    // Flow แบบแชตตอบกลับว่าต้องการข้อมูลเพิ่ม (เช่น ยังไม่ได้แนบภาพ)
    // ปุ่มลบภาพแนบในช่องพิมพ์ (ไอคอน close/✕)
    removeAttachment: /^(close|cancel|clear|delete|remove)$|remove (image|attachment|file|media)|ลบ|นำออก/i,
    needsInput: /isn.?t attached|not available in the project|please (select|upload|attach|provide)|could you (please )?(upload|provide|attach)|กรุณา(เลือก|อัปโหลด|แนบ)|ยังไม่ได้แนบ/gi,
    cropSave: /crop and save|crop & save|ครอบตัดและบันทึก|^save$|^บันทึก$/i,
    generate: /arrow_forward|\bgenerate\b|\bcreate\b|^สร้าง/i,
    newProject: /new project|โปรเจ็กต์ใหม่|โปรเจกต์ใหม่/i,
    // ข้อความที่แปลว่างานนี้ไม่สำเร็จ (การ์ด "ล้มเหลว", "แสดงผลคำตอบไม่สำเร็จ", "ยกเลิกคำตอบแล้ว" ฯลฯ)
    error: /failed|couldn.?t (generate|display|show|respond)|something went wrong|response (was )?(cancel+ed|stopped)|ล้มเหลว|ไม่สามารถสร้าง|คำตอบไม่สำเร็จ|ยกเลิกคำตอบ/gi,
    policy: /policy|นโยบาย|บุคคลที่มีชื่อเสียง|prominent people/i,
    policyAll: /violate[sd]? .{0,40}polic|policies|ละเมิดนโยบาย|บุคคลที่มีชื่อเสียง|prominent (people|person)/gi,
    queued: /waiting in the queue|has been (scheduled|queued)|อยู่ในคิว|เข้าคิว|ได้รับคิว|คิวการสร้าง/gi,
    // Flow คนใช้เยอะ/เกินโควตาชั่วคราว: รอสักพักแล้วส่งใหม่ (ไม่ใช่ความผิดของภาพหรือ prompt)
    busy: /high demand|heavy (load|traffic)|try again later|rate limit|too many requests|ความต้องการใช้งานสูง|มีผู้ใช้งาน(จำนวน)?มาก|ลองอีกครั้งในภายหลัง|สอบถามสถานะได้ในอีก/i,
    approve: /^(อนุมัติ|approve|อนุมัติ\s*\(.*\)|yes,? generate)$/i,
    approveAlways: /^(อนุมัติเสมอ|always approve|approve always|always allow|allow always)$/i,
  };
  let S = DEFAULTS;

  async function loadSelectors() {
    const s = await GC.settings();
    S = { ...DEFAULTS, ...(s.selectors?.flow || {}) };
  }

  const buttons = (root = document) =>
    [...root.querySelectorAll('button,[role="button"],[role="combobox"]')].filter(GC.isVisible);

  const promptBox = () => GC.q(S.promptBox);

  // กล่องควบคุมรอบช่อง prompt (ไต่ขึ้นไปจนเจอปุ่มสร้าง)
  function composerOf(box) {
    let el = box;
    for (let i = 0; i < 10 && el.parentElement; i++) {
      el = el.parentElement;
      if (buttons(el).some((b) => RX.generate.test(GC.textOf(b)))) return el;
    }
    return box.parentElement || document.body;
  }

  // ---------- ตั้งค่า Agent ของ Flow (ปุ่ม "การตั้งค่า" ข้างช่องพิมพ์) ----------
  // ปุ่มนี้เปิดแผง "การตั้งค่า Agent" (ยืนยันก่อนสร้างสื่อ / ค่าเริ่มต้นรูปภาพ / ค่าเริ่มต้นวิดีโอ) ที่ต้องกด "บันทึก"
  // ตั้งครั้งเดียวต่อหน้า: วิดีโอ 9:16, 1 รายการ, โมเดลที่เลือก และ (ถ้าอนุมัติเสมอ) ไม่ต้องยืนยันก่อนสร้าง
  const MODELS = {
    fast: { label: 'Veo 3.1 - Fast', rx: /veo[^\n]{0,20}fast|fast[^\n]{0,10}veo/i },
    quality: { label: 'Veo 3.1 - Quality', rx: /veo[^\n]{0,20}quality|quality[^\n]{0,10}veo/i },
  };
  const SETTINGS_BTN = /^(tune|settings)|การตั้งค่า|settings/i;
  const VIDEO_DEFAULTS = /ค่าเริ่มต้น(ของ)?การสร้างวิดีโอ|video (generation )?defaults|default video/i;
  const SAVE_BTN = /^(บันทึก|save)$/i;
  const clickablesIn = (root) =>
    [...root.querySelectorAll('button,[role="button"],[role="radio"],[role="tab"],[role="combobox"],[role="option"],[role="menuitem"],[role="menuitemradio"],li,label')].filter(GC.isVisible);
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const byOwn = (rx, root = document) => [...root.querySelectorAll('span,div,p,h2,h3,label')].find((el) => GC.isVisible(el) && rx.test(ownText(el)));
  const textIs = (el, rx) => rx.test(GC.textOf(el).replace(/\s+/g, ' ').trim());
  let agentSettingsDone = '';

  // แผงการตั้งค่าที่เปิดอยู่ = กล่องที่ครอบหัวข้อค่าเริ่มต้นวิดีโอและปุ่มบันทึก
  function settingsPanel() {
    const head = byOwn(VIDEO_DEFAULTS);
    if (!head) return null;
    let el = head;
    while (el.parentElement && !clickablesIn(el).some((b) => textIs(b, SAVE_BTN))) el = el.parentElement;
    return el === document.body ? null : el;
  }

  async function configureAgent(composer, { model, approveMode }) {
    const want = MODELS[model];
    const key = `${model}|${approveMode}`;
    if (agentSettingsDone === key) return { ok: true, note: 'ตั้งไว้แล้ว' };
    const btn = buttons(composer).find((b) => SETTINGS_BTN.test(GC.textOf(b)) || SETTINGS_BTN.test(b.getAttribute('aria-label') || ''));
    if (!btn) return { ok: false, note: 'ไม่พบปุ่มการตั้งค่า' };
    const notes = [];
    let panel = settingsPanel();
    if (!panel) {
      await GC.realClick(btn);
      panel = await GC.waitFor(settingsPanel, { timeout: 8000, label: 'แผงการตั้งค่า Agent' }).catch(() => null);
    }
    if (!panel) return { ok: false, note: 'ไม่พบแผงการตั้งค่า' };
    try {
      // ส่วนค่าเริ่มต้นวิดีโอ: จากหัวข้อลงไปจนถึงปุ่มบันทึก
      const head = byOwn(VIDEO_DEFAULTS, panel);
      const after = (el) => head.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      const videoItems = () => clickablesIn(panel).filter(after);
      // อัตราส่วน 9:16 และจำนวน 1 รายการ
      const ratio = videoItems().find((b) => textIs(b, /(^|\s)9:16$/));
      if (ratio) await GC.realClick(ratio);
      const one = videoItems().find((b) => textIs(b, /^x\s?1$/i));
      if (one) await GC.realClick(one);
      await GC.sleep(400);
      // โมเดล: ช่องเลือกตัวสุดท้ายในส่วนวิดีโอ (แสดงชื่อโมเดลปัจจุบัน เช่น "Omni 1.1 Flash")
      let modelOk = !want;
      if (want) {
        const dropdown = videoItems()
          .filter((b) => !textIs(b, /^(\d+:\d+|x\s?\d|บันทึก|save)$/i) && !/\d+:\d+/.test(GC.textOf(b)) && GC.textOf(b).trim())
          .pop();
        if (dropdown && want.rx.test(GC.textOf(dropdown))) modelOk = true;
        else if (dropdown) {
          // ตัวเลือกที่เพิ่งมองเห็นหลังกด (เมนูอาจสร้างใหม่ หรือมีอยู่แล้วแต่ซ่อนไว้)
          const seen = new Set([...document.querySelectorAll('*')].filter(GC.isVisible));
          await GC.realClick(dropdown);
          await GC.sleep(1000);
          const opts = [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],li,button,span,div')].filter(
            (el) => !seen.has(el) && GC.isVisible(el) && GC.textOf(el).trim() && GC.textOf(el).length < 80
          );
          const hit = opts.filter((el) => want.rx.test(GC.textOf(el))).filter((el, _, all) => !all.some((o) => o !== el && el.contains(o)))[0];
          if (hit) {
            await GC.realClick(hit.closest('[role="option"],[role="menuitem"],[role="menuitemradio"],li,button') || hit);
            await GC.sleep(600);
            modelOk = true;
          } else {
            const names = [...new Set(opts.map((o) => GC.textOf(o).replace(/\s+/g, ' ').trim()).filter((t) => /veo|omni|flash|fast|quality|lite/i.test(t)))].slice(0, 8);
            notes.push(`ไม่พบ ${want.label} ในรายการโมเดล (${names.join(' / ') || '-'})`);
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await GC.sleep(400);
          }
        } else notes.push('ไม่พบช่องเลือกโมเดลวิดีโอ');
      }
      // อนุมัติเสมอ = ให้ Agent สร้างและใช้เครดิตเองโดยไม่ถาม ("ไม่เลย")
      if (approveMode === 'always') {
        const never = byOwn(/^(ไม่เลย|never)$/i, panel);
        if (never) await GC.realClick(never.closest('label,[role="radio"],button,li') || never);
      }
      const save = clickablesIn(panel).find((b) => textIs(b, SAVE_BTN));
      if (save) await GC.realClick(save);
      await GC.waitFor(() => !settingsPanel(), { timeout: 5000, label: 'ปิดแผงการตั้งค่า' }).catch(() => null);
      if (modelOk) agentSettingsDone = key;
      return { ok: modelOk, note: notes.join(' · ') };
    } finally {
      // แผงยังเปิดค้าง (บันทึกไม่สำเร็จ): ปิดด้วยปุ่ม ✕ หรือ Escape ไม่ให้บังช่องพิมพ์
      const p = settingsPanel();
      if (p) {
        const x = clickablesIn(p).find((b) => textIs(b, /^(close|ปิด)$/i) || /close|ปิด/i.test(b.getAttribute('aria-label') || ''));
        if (x) await GC.realClick(x);
        else document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await GC.sleep(500);
      }
    }
  }

  GC._configureAgent = configureAgent; // ใช้ทดสอบ

  function findGenerate(composer) {
    const c = buttons(composer).filter((b) => RX.generate.test(GC.textOf(b)));
    return c[c.length - 1] || null;
  }

  const modeTrigger = () => buttons().find((b) => RX.modeMenu.test(GC.textOf(b)));

  async function ensureFramesMode() {
    const trig = modeTrigger();
    if (!trig) return false;
    if (RX.framesMode.test(GC.textOf(trig))) return true;
    for (const open of [(el) => el.click(), GC.press]) {
      open(trig);
      const opt = await GC.waitFor(
        () =>
          [...document.querySelectorAll('[role="option"],[role="menuitem"],[role="menuitemradio"],li')].find(
            (o) => GC.isVisible(o) && RX.framesMode.test(GC.textOf(o))
          ),
        { timeout: 4000, label: 'เมนูเลือกโหมด' }
      ).catch((e) => {
        if (e.message === 'ABORTED') throw e;
        return null;
      });
      if (opt) {
        opt.click();
        await GC.sleep(1000);
        const t = modeTrigger();
        return !!t && RX.framesMode.test(GC.textOf(t));
      }
    }
    return false;
  }

  function dropFile(target, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    }
  }

  async function clickCropSaveIfAny() {
    const save = await GC.waitFor(() => buttons().find((b) => RX.cropSave.test(GC.textOf(b))), {
      timeout: 5000,
      label: 'ปุ่ม Crop and Save',
    }).catch((e) => {
      if (e.message === 'ABORTED') throw e;
      return null;
    });
    if (save) {
      save.click();
      await GC.sleep(2000);
    }
  }

  // แนบภาพเฟรมแรก ลองทีละวิธีจนกว่าจะเห็นภาพย่อขึ้นในช่องพิมพ์
  // (side panel ติดตั้งตัวดักหน้าต่างเลือกไฟล์ใน MAIN world ไว้แล้ว เมื่อหน้าเว็บเปิดหน้าต่างเลือกไฟล์ ไฟล์จะถูกใส่ให้เอง)
  async function uploadFrame(dataUrl, fileName, composer) {
    const file = await GC.dataUrlToFile(dataUrl, fileName);
    // Flow อาจแสดงภาพย่อเป็น <img>, <canvas>, <video> หรือพื้นหลังของ div จึงดูทุกแบบ
    const mediaEls = () => [...composer.querySelectorAll('img,canvas,video,[style*="background-image"]')];
    const keyOf = (el) => el.currentSrc || el.src || el.style?.backgroundImage || '';

    // ลบภาพแนบเก่าที่ค้างในช่องพิมพ์ (เช่น ภาพของฉากก่อน) ไม่งั้น Flow อาจได้ภาพผิด
    // และภาพใหม่ที่ไปแทนที่ภาพเก่าจะทำให้จำนวนภาพเท่าเดิม ตรวจไม่ออกว่าแนบติดแล้ว
    if (mediaEls().length) {
      let removed = 0;
      for (const el of mediaEls()) {
        let box = el;
        for (let i = 0; i < 4 && box && box !== composer; i++, box = box.parentElement) {
          const x = buttons(box).find((b) => RX.removeAttachment.test(GC.textOf(b)) && !RX.generate.test(GC.textOf(b)));
          if (x) {
            x.click();
            removed++;
            await GC.sleep(500);
            break;
          }
        }
      }
      if (removed) GC.log(`Flow: ลบภาพแนบเก่าในช่องพิมพ์ ${removed} ภาพ`);
    }

    // แนบติด = มีภาพย่อตัวใหม่ (element ใหม่หรือ src เปลี่ยน) หรือช่องพิมพ์มีส่วนใหม่เพิ่มขึ้น
    // (ยังไม่ได้พิมพ์อะไร การเปลี่ยนแปลงจึงมาจากไฟล์แนบ)
    const mediaBefore = new Map(mediaEls().map((el) => [el, keyOf(el)]));
    const hasNewMedia = () => mediaEls().some((el) => !mediaBefore.has(el) || mediaBefore.get(el) !== keyOf(el));
    const nodes = () => composer.querySelectorAll('*').length;
    let nodesBefore = nodes();
    const attached = (ms) =>
      GC.waitFor(() => hasNewMedia() || nodes() >= nodesBefore + 3, { timeout: ms, label: 'ภาพแนบ' }).then(
        () => true,
        (e) => {
          if (e.message === 'ABORTED') throw e;
          return false;
        }
      );
    const done = async (how) => {
      GC.log(`Flow: แนบภาพแล้ว (${how})`, 'ok');
      await clickCropSaveIfAny();
      await GC.sleep(1500);
    };

    // 1) ช่องอัปโหลดที่อยู่ในช่องพิมพ์อยู่แล้ว
    const own = composer.querySelector('input[type="file"]');
    if (own) {
      GC.setFiles(own, [file]);
      if (await attached(8000)) return done('ช่องอัปโหลด');
    }

    // 2) กดปุ่ม + แล้วเลือกเมนูอัปโหลด
    const add = buttons(composer).find((b) => RX.addFrame.test(GC.textOf(b)) && !RX.generate.test(GC.textOf(b)));
    if (add) {
      const inputsBefore = document.querySelectorAll('input[type="file"]').length;
      add.click();
      await GC.sleep(1000);
      // ภาพย่อขึ้นเลย = หน้าเว็บเปิดหน้าต่างเลือกไฟล์ทันทีและตัวดักใส่ไฟล์ให้แล้ว
      if (hasNewMedia()) return done('ปุ่ม +');
      // เมนูที่เปิดขึ้นในช่องพิมพ์ไม่นับเป็นไฟล์แนบ จึงตั้งค่าเริ่มนับใหม่หลังเปิดเมนู
      nodesBefore = Math.max(nodesBefore, nodes());
      const item = [...document.querySelectorAll('[role="menuitem"],[role="option"],button,li,label')].find(
        (el) => GC.isVisible(el) && !composer.contains(el) && RX.uploadItem.test(GC.textOf(el))
      );
      if (item) {
        item.click();
        if (await attached(12000)) return done('เมนูอัปโหลด');
      }
      const inputs = document.querySelectorAll('input[type="file"]');
      if (inputs.length > inputsBefore || inputs.length) {
        GC.setFiles(inputs[inputs.length - 1], [file]);
        if (await attached(8000)) return done('ช่องอัปโหลดในเมนู');
      }
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await GC.sleep(500);
    }

    // 3) วางภาพ (paste) ในช่องพิมพ์
    const box = promptBox();
    if (box) {
      GC.pasteFiles(box, [file]);
      if (await attached(6000)) return done('วางภาพ');
    }

    // 4) ลากภาพมาวาง (drop)
    dropFile(box || composer, file);
    if (await attached(6000)) return done('ลากวาง');

    throw new Error('แนบภาพอัตโนมัติไม่สำเร็จ');
  }

  const srcOf = (v) => v && (v.currentSrc || v.src || v.querySelector('source')?.src);

  // Flow แบบแชตแสดงวิดีโอที่เสร็จแล้วเป็นภาพตัวอย่างที่มีไอคอนเล่น (ยังไม่มี <video> จนกว่าจะชี้หรือกดเปิด)
  const PLAY = /play_arrow|play_circle|smart_display|\bplay\b|เล่น/i;
  const hasPlayIcon = (el) =>
    [...el.querySelectorAll('i,span,svg,button,[aria-label],[role="img"]')].some((x) =>
      PLAY.test(`${x.innerText || ''} ${x.getAttribute('aria-label') || ''}`)
    );
  function tileOf(img, requirePlay) {
    let el = img;
    for (let i = 0; i < 5 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.querySelector('video') || hasPlayIcon(el)) return el;
    }
    return requirePlay ? null : img.parentElement;
  }
  const largeImgs = () =>
    [...document.querySelectorAll('img')].filter((i) => GC.isVisible(i) && Math.max(i.naturalWidth, i.width) >= 120);

  // หา <video> ทั้งหน้า รวมที่อยู่ใน shadow DOM
  function deepVideos(root = document) {
    const out = [...root.querySelectorAll('video')];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) out.push(...deepVideos(el.shadowRoot));
    return out;
  }
  const allVideoSrcs = () => new Set(deepVideos().map(srcOf).filter(Boolean));

  const DOWNLOAD = /download|file_download|ดาวน์โหลด/i;
  const MORE = /more_vert|more_horiz|more options|ตัวเลือกเพิ่มเติม|^more$/i;
  // ตัวเลือกคุณภาพหลังกดดาวน์โหลด (ไม่เอา GIF)
  const QUALITY = /original|ต้นฉบับ|1080|720|mp4|\bfull\b/i;
  const visibleIn = (root, sel) => [...root.querySelectorAll(sel)].filter(GC.isVisible);

  function hover(el) {
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
  }

  // กดปุ่มดาวน์โหลด (และเลือกคุณภาพถ้ามีเมนูให้เลือก) ให้เบราว์เซอร์ดาวน์โหลด side panel จะตั้งชื่อไฟล์ให้เอง
  async function clickDownload(btn) {
    const seen = new Set(document.querySelectorAll('*'));
    btn.click();
    await GC.sleep(1200);
    const options = visibleIn(document, '[role="menuitem"],[role="option"],button,li').filter(
      (el) => !seen.has(el) && !/gif/i.test(GC.textOf(el))
    );
    const pick = options.find((el) => QUALITY.test(GC.textOf(el))) || options.find((el) => DOWNLOAD.test(GC.textOf(el)));
    if (pick) pick.click();
    return true;
  }

  const findDownload = (root) =>
    visibleIn(root, 'button,[role="button"],[role="menuitem"],a').find((b) => DOWNLOAD.test(GC.textOf(b)));

  // ดึงวิดีโอจากภาพตัวอย่าง คืน { src } หรือ { clicked: true } (กดปุ่มดาวน์โหลดของ Flow แล้ว) หรือ null
  async function videoFromTile(tile) {
    const close = async (url) => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await GC.sleep(800);
      if (location.href !== url) {
        history.back();
        await GC.sleep(1500);
      }
    };
    let src = srcOf(tile.querySelector('video'));
    if (src) return { src };

    // 1) ชี้เมาส์: อาจโหลด <video> หรือแสดงปุ่มดาวน์โหลดบนภาพ
    const img = tile.querySelector('img') || tile;
    hover(tile);
    hover(img);
    await GC.sleep(2000);
    src = srcOf(tile.querySelector('video'));
    if (src) return { src };
    let btn = findDownload(tile);
    if (btn) return { clicked: await clickDownload(btn) };

    // 2) เมนู ⋮ บนภาพตัวอย่าง
    const more = visibleIn(tile, 'button,[role="button"]').find((b) => MORE.test(GC.textOf(b)));
    if (more) {
      more.click();
      await GC.sleep(1000);
      btn = findDownload(document);
      if (btn) return { clicked: await clickDownload(btn) };
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await GC.sleep(500);
    }

    // 3) กดเปิดหน้าดูวิดีโอ แล้วหา <video> หรือปุ่มดาวน์โหลดในหน้านั้น
    const beforeVideos = allVideoSrcs();
    const url = location.href;
    const seen = new Set(document.querySelectorAll('*'));
    img.click();
    await GC.sleep(2500);
    src = [...allVideoSrcs()].find((s) => !beforeVideos.has(s));
    if (src) {
      await close(url);
      return { src };
    }
    btn = [...document.querySelectorAll('button,[role="button"],a')].find(
      (b) => !seen.has(b) && GC.isVisible(b) && DOWNLOAD.test(GC.textOf(b))
    ) || findDownload(document);
    if (btn) {
      await clickDownload(btn);
      await close(url);
      return { clicked: true };
    }
    await close(url);
    return null;
  }


  // ปุ่มที่ Flow แบบแชตใช้ถามก่อนหักเครดิต: "อนุมัติ" / "อนุมัติเสมอ" (rx เลือกว่าจะหาแบบไหน)
  // ตัวเลือกอาจเป็นปุ่มหรือแค่ div/li ที่กดได้ จึงหาจากข้อความ แล้วใช้กล่องที่กดได้ที่ใกล้ที่สุด
  const CLICKABLE = 'button,[role="button"],[role="option"],[role="menuitem"],[role="radio"],[role="menuitemradio"],li';
  const ICON_WORDS = /\b(check_circle|check|done_all|done|close|cancel|block)\b/g;
  const approveButtons = (rx = RX.approve) => {
    const found = new Set();
    for (const el of document.querySelectorAll(`${CLICKABLE},div,span`)) {
      if (!GC.isVisible(el) || el.disabled) continue;
      if (!rx.test(GC.textOf(el).replace(ICON_WORDS, '').trim())) continue;
      found.add(el.closest(CLICKABLE) || el);
    }
    // เก็บเฉพาะตัวในสุด (กล่องนอกที่ครอบข้อความเดียวกันไม่นับซ้ำ)
    return [...found].filter((a) => ![...found].some((b) => b !== a && a.contains(b)));
  };
  const anyApproveButtons = () => [...approveButtons(RX.approve), ...approveButtons(RX.approveAlways)];

  async function toResult(src) {
    if (!src.startsWith('blob:')) return { url: src };
    return { dataUrl: await GC.blobToDataUrl(await (await fetch(src)).blob()) };
  }

  // ส่งไฟล์จาก blob: URL ของหน้านี้ให้ side panel (เป็น data URL) เพื่อเก็บไว้รวมคลิป
  GC.handlers['flow:fetchBlob'] = async ({ url }) => {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return GC.blobToDataUrl(await res.blob());
  };

  // ข้อมูลโครงสร้างหน้าเว็บ สำหรับส่งให้ผู้พัฒนาปรับ selector
  GC.handlers['gc:inspect'] = async () => {
    await loadSelectors();
    const box = promptBox();
    const composer = box ? composerOf(box) : null;
    const describe = (b) => `${GC.textOf(b).replace(/\s+/g, ' ').slice(0, 50)} | ${b.getAttribute('role') || b.tagName}`;

    // ลองกดปุ่ม + ในช่องพิมพ์ แล้วดูว่ามีเมนูอะไรขึ้นมา (กด Escape ปิดหลังดูเสร็จ)
    let plusMenu = null;
    const add = composer && buttons(composer).find((b) => RX.addFrame.test(GC.textOf(b)) && !RX.generate.test(GC.textOf(b)));
    if (add) {
      const seen = new Set(document.querySelectorAll('*'));
      const inputsBefore = document.querySelectorAll('input[type="file"]').length;
      add.click();
      await GC.sleep(1200);
      const fresh = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],li,label,a')].filter(
        (el) => !seen.has(el) && GC.isVisible(el)
      );
      plusMenu = {
        button: describe(add),
        newItems: fresh.map(describe).slice(0, 30),
        fileInputsAfter: `${inputsBefore} -> ${document.querySelectorAll('input[type="file"]').length}`,
        inputAccept: [...document.querySelectorAll('input[type="file"]')].map((i) => i.accept || '*'),
      };
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    // ภาพตัวอย่าง 4 รูปล่าสุดบนหน้า: โครงสร้างรอบ ๆ และไอคอน เพื่อหาวิธีดึงวิดีโอ
    const tiles = largeImgs()
      .slice(-4)
      .map((img) => {
        const chain = [];
        for (let e = img, i = 0; e && i < 6; e = e.parentElement, i++) {
          const attrs = [...e.attributes]
            .filter((a) => /^(data-|aria-|role$|href$)/.test(a.name))
            .map((a) => `${a.name}=${a.value.slice(0, 40)}`);
          chain.push(`${e.tagName} ${attrs.join(' ')}`.trim());
        }
        const box = tileOf(img, false);
        return {
          src: (img.currentSrc || img.src).slice(0, 90),
          playIcon: !!tileOf(img, true),
          icons: [...box.querySelectorAll('i,span,svg,[aria-label]')]
            .map((x) => `${(x.innerText || '').trim()} ${x.getAttribute('aria-label') || ''}`.trim())
            .filter(Boolean)
            .slice(0, 8),
          hasVideo: !!box.querySelector('video'),
          chain,
        };
      });

    return {
      plusMenu,
      tiles,
      approveButtons: anyApproveButtons().map(describe),
      url: location.href,
      promptBox: box ? `${box.tagName}#${box.id || ''}` : null,
      textareas: document.querySelectorAll('textarea').length,
      editables: document.querySelectorAll('[contenteditable="true"]').length,
      fileInputs: document.querySelectorAll('input[type="file"]').length,
      videos: document.querySelectorAll('video').length,
      modeTrigger: modeTrigger() ? describe(modeTrigger()) : null,
      composerButtons: composer ? buttons(composer).map(describe) : [],
      generateButton: composer && findGenerate(composer) ? describe(findGenerate(composer)) : null,
    };
  };

  // payload: { imageDataUrl, fileName, prompt, hint, timeout, approveMode: 'always' | 'once' }
  GC.handlers['flow:video'] = async ({ imageDataUrl, fileName, prompt, hint, timeout, approveMode = 'always', model = '' }) => {
    await loadSelectors();

    let box = await GC.waitFor(promptBox, { timeout: 20000, label: 'ช่อง prompt ของ Flow' }).catch((e) => {
      if (e.message === 'ABORTED') throw e;
      return null;
    });
    if (!box) {
      // อยู่หน้าแรกของ Flow (รายการโปรเจกต์) ให้กด "โปรเจ็กต์ใหม่" เอง
      const newProject = [...document.querySelectorAll('button,[role="button"],a')].find(
        (b) => GC.isVisible(b) && RX.newProject.test(GC.textOf(b))
      );
      if (newProject) {
        GC.log('Flow: กดสร้างโปรเจกต์ใหม่');
        newProject.click();
        box = await GC.waitFor(promptBox, { timeout: 30000, label: 'ช่อง prompt ของโปรเจกต์ใหม่' }).catch((e) => {
          if (e.message === 'ABORTED') throw e;
          return null;
        });
      }
    }
    if (!box) {
      await GC.askOrFail('ไม่พบช่องพิมพ์ prompt ของ Flow\nกรุณาเปิดหรือสร้างโปรเจกต์ใน Flow ให้เห็นช่องพิมพ์ แล้วกด "ทำต่อ"');
      box = await GC.waitFor(promptBox, { timeout: 10000, label: 'ช่อง prompt ของ Flow' });
    }

    if (imageDataUrl) {
      // Flow แบบแชต (flow.google.com) ไม่มีเมนูโหมด จึงเลือกโหมดเฉพาะเมื่อมีเมนูนี้
      if (modeTrigger() && !(await ensureFramesMode())) {
        await GC.askOrFail('กรุณาเลือกโหมด "Frames to Video" (เฟรมเป็นวิดีโอ) เอง แล้วกด "ทำต่อ"');
      }
      box = promptBox() || box;
      try {
        await uploadFrame(imageDataUrl, fileName, composerOf(box));
      } catch (e) {
        if (e.message === 'ABORTED') throw e;
        await GC.askOrFail(`อัปโหลดเฟรมแรกอัตโนมัติไม่สำเร็จ (${e.message})\nกรุณาแนบไฟล์นี้เอง (กดปุ่ม + หรือลากไฟล์มาวางในช่องพิมพ์):\nDownloads/${hint}\nเมื่อเห็นภาพในช่องพิมพ์แล้วกด "ทำต่อ" (ไม่ต้องกดส่ง)`);
      }
    }

    box = promptBox() || box;
    // โมเดลวิดีโอ: เลือกในเมนูการตั้งค่า ถ้าเลือกไม่ได้ให้บอก Agent ใน prompt แทน
    // ตั้งค่า Agent (โมเดลวิดีโอ 9:16 x1, ไม่ต้องยืนยันถ้าอนุมัติเสมอ) ครั้งแรกของหน้า ถ้าเลือกโมเดลไม่ได้ให้บอกใน prompt แทน
    if (MODELS[model] || approveMode === 'always') {
      const r = await configureAgent(composerOf(box), { model, approveMode }).catch((e) => {
        if (e.message === 'ABORTED') throw e;
        return { ok: false, note: e.message };
      });
      if (r.note !== 'ตั้งไว้แล้ว') {
        if (MODELS[model]) {
          GC.log(
            r.ok ? `Flow: ตั้งค่า Agent แล้ว (วิดีโอ 9:16 · ${MODELS[model].label})` : `Flow: ตั้งโมเดลไม่ได้ (${r.note}) จะบอกใน prompt ให้ใช้ ${MODELS[model].label} แทน`,
            r.ok ? 'info' : 'warn'
          );
        } else if (r.note) GC.log(`Flow: ตั้งค่า Agent: ${r.note}`, 'warn');
      }
      if (MODELS[model] && !r.ok) prompt += ` Use the ${MODELS[model].label} model.`;
      box = await GC.waitFor(() => (GC.onScreen(promptBox() || document.body) ? promptBox() : null), { timeout: 5000, label: 'ช่อง prompt' }).catch(() => promptBox() || box);
    }
    await GC.typeInto(box, prompt);
    await GC.sleep(800);

    const composer = composerOf(box);
    // ภาพ/วิดีโอที่มีอยู่แล้วก่อนส่ง (ใช้เมื่อหาข้อความ prompt ในแชตไม่เจอ)
    const before = allVideoSrcs();
    const imgsBefore = new Set(largeImgs());
    const bubblesBefore = findPromptBubbles(prompt).length;
    // ค่าตั้งต้นต้องเก็บก่อนกดส่ง (ระหว่างรอหาข้อความ prompt อาจมีปุ่มอนุมัติ/ข้อความใหม่ขึ้นแล้ว)
    const approvedBefore = new Set(anyApproveButtons());
    const bodyCount = (rx) => (document.body.innerText.match(rx) || []).length;
    const pageBefore = { error: bodyCount(RX.error), ask: bodyCount(RX.needsInput), queued: bodyCount(RX.queued), policy: bodyCount(RX.policyAll) };
    const gen = await GC.waitFor(
      () => {
        const b = findGenerate(composer);
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
      },
      { timeout: 20000, label: 'ปุ่มสร้างวิดีโอ' }
    ).catch((e) => {
      if (e.message === 'ABORTED') throw e;
      return null;
    });
    if (gen) gen.click();
    else await GC.askOrFail('ไม่พบปุ่มสร้างวิดีโอ\nกรุณาตรวจ prompt แล้วกดปุ่มสร้างเอง จากนั้นกด "ทำต่อ"');
    GC.log('ส่งคำสั่งสร้างวิดีโอแล้ว กำลังรอ Flow...');

    // ขอบเขตของฉากนี้ = สิ่งที่อยู่ในแชตหลังข้อความ prompt ที่เพิ่งส่ง
    // (กันไม่ให้นับวิดีโอ/ข้อความ "ล้มเหลว" ของฉากก่อน ๆ หรือแผงสื่อด้านซ้าย)
    let scope = await findScope(prompt, bubblesBefore);
    if (scope) GC.log('Flow: พบข้อความ prompt ในแชตแล้ว จะดูเฉพาะคำตอบของฉากนี้');
    else GC.log('Flow: หาข้อความ prompt ในแชตไม่เจอ จะดูการเปลี่ยนแปลงทั้งหน้าแทน', 'warn');
    // Flow อาจวาดแชตใหม่ ทำให้ข้อความ prompt ที่จำไว้หลุดจากหน้า: หาใหม่เป็นตัวล่าสุด
    const refreshScope = () => {
      if (!scope || scope.anchor.isConnected) return;
      const latest = findPromptBubbles(prompt).pop();
      if (latest) scope = makeScope(latest);
    };
    const inScope = (el) => (scope ? scopeContains(scope, el) : true);
    const scopeText = () => (scope ? textAfter(scope) : document.body.innerText);
    const count = (rx) => (scopeText().match(rx) || []).length;
    let errBefore = scope ? 0 : pageBefore.error;
    let askBefore = scope ? 0 : pageBefore.ask;
    let queuedBefore = scope ? 0 : pageBefore.queued;
    const freshVideos = () =>
      [...new Set(deepVideos().filter(inScope).map(srcOf).filter(Boolean))].filter((s) => !before.has(s));
    const freshTiles = (requirePlay = true) => {
      const imgs = largeImgs().filter((i) => (scope ? inScope(i) : !imgsBefore.has(i)));
      return [...new Set(imgs.map((i) => tileOf(i, requirePlay)).filter(Boolean))];
    };
    // สัญญาณจากทั้งหน้า (เทียบกับก่อนส่ง) ใช้ตรวจว่าขอบเขตแชตที่เลือกไว้ผิดหรือไม่
    const pageSignals = () => ({
      tiles: [...new Set(largeImgs().filter((i) => !imgsBefore.has(i)).map((i) => tileOf(i, true)).filter(Boolean))].length,
      videos: [...new Set(deepVideos().map(srcOf).filter(Boolean))].filter((s) => !before.has(s)).length,
      error: bodyCount(RX.error) - pageBefore.error,
      queued: bodyCount(RX.queued) - pageBefore.queued,
    });
    let scopeQuietSince = Date.now();
    let scopeBaseLen = null;
    // โหมดดูทั้งหน้าหลังขอบเขตแชตผิด: แยกไม่ได้ว่าวิดีโอไหนเป็นของฉากนี้ (แผงสื่อด้านซ้ายก็โหลดวิดีโอเก่าขึ้นมา)
    // จึงไม่ดาวน์โหลดเอง แต่ให้ผู้ใช้ดาวน์โหลดวิดีโอของฉากนี้เอง (side panel จะตั้งชื่อและเก็บไฟล์ให้)
    let fallbackMode = false;
    let fallbackSeenAt = 0;

    // รอวิดีโอใหม่ ถ้าเจอแล้วรอต่ออีก 15 วินาทีเผื่อ Flow สร้างหลายเวอร์ชัน (เก็บไม่เกิน 2 ไฟล์)
    const end = Date.now() + (timeout || 1200000);
    let askedUser = false;
    let found = [];
    let foundAt = 0;
    let failedAt = 0;
    let lastDiag = 0;
    let tilesSince = 0;
    let lastTileTry = 0;
    let tileTries = 0;
    let tileResults = [];
    let waitHint = null;
    const start = Date.now();
    // ลองดึงวิดีโอจากภาพตัวอย่างใหม่ (ตัวล่าสุดก่อน)
    const fromTiles = async (tiles) => {
      for (const t of tiles.reverse()) {
        const r = await videoFromTile(t);
        if (r?.src && !before.has(r.src)) return [await toResult(r.src)];
        if (r?.clicked) return [{ clicked: true }];
      }
      return [];
    };
    try {
      while (Date.now() < end) {
        GC.checkAbort();
        refreshScope();
        // Flow ตอบเป็นข้อความภายในไม่กี่วินาทีเสมอ ถ้าข้อความหลัง prompt ไม่เพิ่มขึ้นเลยนาน 90 วินาที
        // แปลว่าขอบเขตแชตที่เลือกไว้ผิด: เปลี่ยนไปดูทั้งหน้าแทน (เทียบกับก่อนส่ง)
        if (scope) {
          const len = scopeText().trim().length;
          scopeBaseLen ??= len;
          // ขอบเขตว่างเปล่า 30 วินาที (จับข้อความ prompt ผิดตัว เช่น สำเนาที่อยู่ท้ายหน้า):
          // ดูการเปลี่ยนแปลงทั้งหน้าเทียบกับก่อนส่งแทน (ยังดาวน์โหลดวิดีโอให้เองได้ ต่างจากโหมดสำรองด้านล่าง)
          if (len < 20 && Date.now() - start > 30000) {
            GC.log('Flow: ขอบเขตแชตว่าง (จับข้อความ prompt ผิดตัว) เปลี่ยนไปดูการเปลี่ยนแปลงทั้งหน้าแทน', 'warn');
            scope = null;
            errBefore = pageBefore.error;
            askBefore = pageBefore.ask;
            queuedBefore = pageBefore.queued;
          } else if (len > scopeBaseLen + 5) scopeQuietSince = Infinity;
          // Flow บางครั้งคิดนานหลายนาทีก่อนตอบ จึงรอ 5 นาทีก่อนสรุปว่าขอบเขตแชตผิด
          else if (Date.now() - scopeQuietSince > 300000) {
            GC.log('Flow: ไม่เห็นคำตอบหลังข้อความ prompt (ขอบเขตแชตอาจไม่ตรง) เปลี่ยนไปดูทั้งหน้าแทน', 'warn');
            scope = null;
            fallbackMode = true;
            errBefore = pageBefore.error;
            askBefore = pageBefore.ask;
            queuedBefore = pageBefore.queued;
          }
        }
        // Flow แบบแชตขออนุมัติใช้เครดิตก่อนสร้าง: กด "อนุมัติเสมอ" หรือ "อนุมัติ" ตามที่ตั้งค่าไว้
        // (ถ้าตั้งเป็นอนุมัติเสมอแต่ไม่มีปุ่มนี้ จะกด "อนุมัติ" แทน)
        // ปุ่มอนุมัติที่ไม่มีก่อนส่งคำสั่ง = ของฉากนี้แน่นอน จึงไม่ต้องอยู่ในขอบเขตแชต (กันขอบเขตผิดแล้วไม่กด)
        const isNew = (b) => !approvedBefore.has(b);
        const always = approveButtons(RX.approveAlways).filter(isNew);
        const once = approveButtons(RX.approve).filter(isNew);
        const pick = approveMode === 'always' ? always[0] || once[0] : once[0] || always[0];
        if (pick) {
          [...always, ...once].forEach((b) => approvedBefore.add(b));
          GC.log(`Flow: กดอนุมัติใช้เครดิต (${GC.textOf(pick).replace(/\s+/g, ' ')})`);
          pick.click();
          // ถ้ายังอยู่หลัง 3 วินาที (คลิกจำลองไม่ติด) กดแบบเมาส์จริงอีกครั้ง
          await GC.sleep(3000);
          if (pick.isConnected && GC.onScreen(pick)) await GC.realClick(pick);
        }
        // โหมดดูทั้งหน้า: แยกไม่ได้ว่าภาพ ▷ ไหนเสร็จแล้วหรือยังรอคิว (ภาพรอคิวก็มีไอคอน ▷) จึงไม่ถามเอง
        // แค่แจ้งครั้งเดียว แล้วรอให้ผู้ใช้กด "ทำต่อ" (แถบมุมซ้ายล่าง) เมื่อวิดีโอเสร็จและดาวน์โหลดเองแล้ว
        if (fallbackMode && !fallbackSeenAt) {
          const pg = pageSignals();
          if (pg.videos || pg.tiles) {
            fallbackSeenAt = Date.now();
            GC.log('Flow: มีวิดีโอ/ภาพ ▷ ใหม่ในหน้า เมื่อวิดีโอของฉากนี้เสร็จแล้ว ให้ดาวน์โหลดเอง แล้วกด "ทำต่อ" มุมซ้ายล่าง', 'warn');
          }
        }
        const fresh = fallbackMode ? [] : freshVideos();
        // ขอบเขตแชตไม่มีข้อความเลย (จับข้อความ prompt ผิดตัว) ใช้สัญญาณทั้งหน้าเทียบกับก่อนส่งแทน
        const blindScope = scope && scopeText().trim().length < 20;
        const failed = blindScope ? Math.max(0, bodyCount(RX.error) - pageBefore.error) : count(RX.error) - errBefore;
        const queued = blindScope ? Math.max(0, bodyCount(RX.queued) - pageBefore.queued) : count(RX.queued) - queuedBefore;
        if (fresh.length) {
          if (!found.length) foundAt = Date.now();
          found = fresh.slice(0, 2);
          if (Date.now() - foundAt > 15000) break;
        } else if (failed > 0) {
          // Flow แบบแชตอาจลองใหม่หรือเข้าคิวเองหลังล้มเหลว จึงรอดูก่อน 60 วินาที
          failedAt ||= Date.now();
          // Flow มักส่งข้อความ "scheduled / waiting in the queue" มาพร้อมกับตอนสั่งงาน แม้งานจะล้มเหลวไปแล้ว
          // จึงรอวิดีโอใหม่หลังล้มเหลวไม่เกิน 3 นาที (ถ้ามีข้อความเข้าคิว) หรือ 1 นาที (ถ้าไม่มี) แล้วถือว่าล้มเหลว
          if (Date.now() - failedAt > (queued > 0 ? 180000 : 60000)) {
            throw new Error(
              RX.policy.test(scopeText()) || bodyCount(RX.policyAll) > pageBefore.policy
                ? 'Flow ปฏิเสธเพราะนโยบายเนื้อหา (หน้าผู้นำเสนออาจคล้ายบุคคลที่มีชื่อเสียง) [policy]'
                : RX.busy.test(blindScope ? document.body.innerText : scopeText())
                  ? 'Flow สร้างวิดีโอไม่สำเร็จเพราะมีผู้ใช้งานสูง [busy]'
                  : 'Flow แจ้งว่าสร้างวิดีโอไม่สำเร็จ (อาจเครดิตหมดหรือระบบขัดข้อง)'
            );
          }
        } else if (!askedUser && count(RX.needsInput) > askBefore) {
          // Flow แบบแชตถามกลับ (เช่น ขอภาพ) ให้ผู้ใช้ตอบเองในแชต แล้วรอวิดีโอต่อ
          askedUser = true;
          await GC.askOrFail('Flow ตอบกลับว่าต้องการข้อมูลเพิ่ม (เช่น ยังไม่ได้แนบภาพ)\nกรุณาแนบภาพหรือตอบในแชตของ Flow เองจนเริ่มสร้างวิดีโอ แล้วกด "ทำต่อ" ระบบจะรอวิดีโอต่อ');
        }

        // วิดีโอที่เสร็จแล้วแสดงเป็นภาพตัวอย่างมีไอคอนเล่น: รอให้นิ่ง 5 วินาทีแล้วดึง
        // ถ้ายังดึงไม่ได้ (เช่น ยังอยู่ในคิว) ลองใหม่ทุก 20 วินาทีจนหมดเวลา
        const tiles = fresh.length || fallbackMode ? [] : freshTiles();
        if (tiles.length) {
          tilesSince ||= Date.now();
          if (Date.now() - tilesSince > 5000 && Date.now() - lastTileTry > 20000) {
            lastTileTry = Date.now();
            GC.log(`Flow: พบวิดีโอใหม่ ${tiles.length} รายการ กำลังดึงไฟล์ (ครั้งที่ ${++tileTries})...`);
            tileResults = await fromTiles(tiles);
            if (tileResults.length) break;
            GC.log('Flow: ยังดึงไฟล์ไม่ได้ (วิดีโออาจยังไม่เสร็จ) จะลองใหม่ใน 20 วินาที', 'warn');
          }
        } else tilesSince = 0;

        if (!waitHint && (Date.now() - start > 180000 || fallbackSeenAt)) {
          waitHint = GC.showHint(
            fallbackMode
              ? 'รอวิดีโอของฉากนี้เสร็จ (ภาพ ▷ กดเล่นได้ ไม่ขึ้นว่าอยู่ในคิวแล้ว) แล้วดาวน์โหลดเองจากแชตของ Flow จากนั้นกด "ทำต่อ"'
              : 'ถ้าวิดีโอเสร็จแล้วแต่ระบบยังไม่ไปต่อ กด "ทำต่อ" ระบบจะพยายามดึงไฟล์ ถ้าไม่ได้ให้ดาวน์โหลดเอง'
          );
        }
        if (waitHint?.clicked) {
          waitHint = null;
          // โหมดดูทั้งหน้า: ผู้ใช้ดาวน์โหลดเองแล้ว (side panel ตั้งชื่อ scene-XX และเก็บไว้รวมคลิปให้) ไปฉากถัดไปได้เลย
          if (fallbackMode) return { videos: [] };
          tileResults = await fromTiles(freshTiles(false));
          if (tileResults.length) break;
          await GC.askOrFail('ดึงไฟล์วิดีโออัตโนมัติไม่ได้\nกรุณาดาวน์โหลดวิดีโอเองจากแชตของ Flow แล้วกด "ทำต่อ" เพื่อไปฉากถัดไป');
          return { videos: [] };
        }

        if (Date.now() - lastDiag > 30000) {
          lastDiag = Date.now();
          const pg = pageSignals();
          GC.log(
            `[Flow] รอวิดีโอ · ${scope ? `ในแชต(${scopeText().trim().length} ตัวอักษร)` : 'ทั้งหน้า'}: ` +
              `video ใหม่=${fresh.length} ภาพตัวอย่างใหม่=${tiles.length} ล้มเหลว=${failed} เข้าคิว=${queued}` +
              (scope ? ` · ทั้งหน้า: video=${pg.videos} ภาพตัวอย่าง=${pg.tiles} ล้มเหลว=${pg.error} เข้าคิว=${pg.queued}` : '')
          );
        }
        await GC.sleep(2000);
      }
    } finally {
      waitHint?.remove();
    }

    if (tileResults.length) return { videos: tileResults };
    if (!found.length) {
      await GC.askOrFail('รอวิดีโอนานเกินกำหนด หรือหาไฟล์วิดีโอไม่เจอ\nถ้าวิดีโอเสร็จแล้ว กรุณาดาวน์โหลดเองแล้วกด "ทำต่อ" เพื่อไปฉากถัดไป');
      return { videos: [] };
    }
    return { videos: await Promise.all(found.map(toResult)) };
  };

  // ---------- ขอบเขตคำตอบของฉากนี้ในแชต ----------

  // หา element ที่ลึกที่สุดซึ่งมีข้อความของ prompt ในแชต (ไม่ใช่ช่องพิมพ์)
  // ใช้ข้อความช่วงกลาง เพราะต้น prompt (ข้อความนำหน้า) เหมือนกันทุกฉาก
  function findPromptBubbles(prompt) {
    const flat = prompt.replace(/\s+/g, ' ').trim();
    const mid = Math.max(0, Math.floor(flat.length / 2) - 25);
    const snippet = flat.slice(mid, mid + 50);
    const box = promptBox();
    const hits = [...document.querySelectorAll('p,span,div')].filter(
      (el) =>
        GC.isVisible(el) &&
        !(box && (box === el || box.contains(el) || el.contains(box))) &&
        (el.textContent || '').replace(/\s+/g, ' ').includes(snippet)
    );
    // เลือกตัวที่ลึกที่สุด (ไม่มีลูกที่มีข้อความเดียวกัน)
    let list = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    // เฉพาะตัวที่แสดงจริงในคอลัมน์แชต (แนวนอนตรงกับช่องพิมพ์) ไม่ใช่สำเนาที่ซ่อนไว้ที่อื่นในหน้า
    const br = box?.getBoundingClientRect();
    if (br?.width) {
      const inChat = list.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left < br.right && r.right > br.left;
      });
      if (inChat.length) list = inChat;
    }
    return list;
  }

  // กล่องที่เลื่อนได้ซึ่งครอบข้อความ = กล่องแชต
  // ใช้กล่องเลื่อนชั้นนอกสุด: กรอบข้อความ prompt ยาว ๆ อาจเลื่อนในตัวเองและสูงเกิน 250px
  // ถ้าใช้กล่องชั้นในจะมองไม่เห็นคำตอบและปุ่มอนุมัติด้านล่าง
  function scrollParent(el) {
    let found = null;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const oy = getComputedStyle(e).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight && e.clientHeight >= 250) found = e;
    }
    return found;
  }

  const makeScope = (anchor) => ({
    anchor,
    container: scrollParent(anchor) || anchor.parentElement?.parentElement?.parentElement?.parentElement || document.body,
  });

  // รอจนข้อความ prompt ใหม่ขึ้นในแชต (มากกว่าก่อนส่ง เผื่อเคยส่ง prompt เดียวกันมาก่อน) แล้วใช้ตัวล่าสุด
  async function findScope(prompt, bubblesBefore) {
    const anchor = await GC.waitFor(() => {
      const list = findPromptBubbles(prompt);
      return list.length > bubblesBefore ? list[list.length - 1] : null;
    }, { timeout: 20000, label: 'ข้อความ prompt ในแชต' }).catch((e) => {
      if (e.message === 'ABORTED') throw e;
      return null;
    });
    return anchor ? makeScope(anchor) : null;
  }

  function scopeContains({ anchor, container }, el) {
    if (!el.isConnected || !container.contains(el) || anchor.contains(el)) return false;
    return !!(anchor.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function textAfter({ anchor, container }) {
    if (!anchor.isConnected) return '';
    const range = document.createRange();
    range.setStartAfter(anchor);
    range.setEnd(container, container.childNodes.length);
    return range.toString();
  }
})();
