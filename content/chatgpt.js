// ควบคุมหน้า chatgpt.com: แนบรูป พิมพ์ข้อความ ส่ง รอคำตอบ และดึงภาพที่สร้าง
(() => {
  const GC = window.GC;
  GC.site = 'chatgpt';

  // selector ตั้งต้น แก้/เพิ่มได้ในหน้าตั้งค่า (settings.selectors.chatgpt)
  const DEFAULTS = {
    editor: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]'],
    fileInput: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    sendButton: ['[data-testid="send-button"]', 'button[aria-label*="Send"]', 'button[aria-label*="ส่ง"]'],
    // ใช้เฉพาะปุ่มหยุดของช่องแชต ไม่ใช้ "Stop"/"หยุด" แบบกว้าง เพราะไปตรงกับปุ่มอื่นบนหน้าแล้วทำให้ค้าง
    stopButton: [
      '[data-testid="stop-button"]',
      'button[aria-label="Stop streaming"]',
      'button[aria-label*="Stop generating"]',
      'button[aria-label*="หยุดการสตรีม"]',
    ],
    // ปุ่มคัดลอก/ถูกใจใต้คำตอบ จะขึ้นเมื่อ ChatGPT ตอบเสร็จ
    doneActions: ['[data-testid="copy-turn-action-button"]', '[data-testid="good-response-turn-action-button"]'],
    turn: ['article[data-testid^="conversation-turn"]', '[data-testid^="conversation-turn"]', 'section[data-turn]'],
    assistantMsg: ['[data-message-author-role="assistant"]'],
    userMsg: ['[data-message-author-role="user"]'],
  };
  let S = DEFAULTS;

  async function loadSelectors() {
    const s = await GC.settings();
    S = { ...DEFAULTS, ...(s.selectors?.chatgpt || {}) };
  }

  // พื้นที่ช่องพิมพ์ (มีปุ่ม + / ไมค์ / ส่ง / หยุด) โดยไต่ขึ้นจากช่องพิมพ์ แต่ไม่เกิน main
  function controlsArea() {
    const editor = GC.q(S.editor);
    if (!editor) return null;
    let el = editor;
    for (let i = 0; i < 8 && el.parentElement && !/^(MAIN|BODY)$/.test(el.parentElement.tagName); i++) {
      el = el.parentElement;
      if (el.tagName === 'FORM') return el;
      if (el.querySelectorAll('button').length >= 3) return el;
    }
    return el;
  }

  const buttonInfo = (b) => `${b.getAttribute('aria-label') || ''} ${b.dataset.testid || ''}`;

  // กำลังตอบ = มีปุ่มหยุดในช่องพิมพ์ (ไม่ดูปุ่ม "Stop" อื่นบนหน้า เพื่อไม่ให้จับผิดตัว)
  function isGenerating() {
    if (GC.q(S.stopButton)) return true;
    const area = controlsArea();
    return !!area && [...area.querySelectorAll('button')].some((b) => GC.isVisible(b) && /stop|หยุด/i.test(buttonInfo(b)));
  }

  function turns() {
    const t = GC.qAll(S.turn);
    if (t.length) return t;
    // fallback: ใช้ข้อความของแต่ละฝั่งแทน turn
    return GC.qAll([...S.userMsg, ...S.assistantMsg].join(','));
  }

  const isUserTurn = (t) =>
    t.matches(S.userMsg.join(',')) || !!t.querySelector(S.userMsg.join(',')) || t.dataset.turn === 'user';

  const chatRoot = () => document.querySelector('main') || document.body;
  const allImageSrcs = () => new Set([...chatRoot().querySelectorAll('img')].map((i) => i.currentSrc || i.src));

  const snapshot = () => ({ turns: turns().length, assistants: GC.qAll(S.assistantMsg).length, imgs: allImageSrcs() });

  // turn คำตอบล่าสุดที่เกิดหลังจากส่งข้อความ
  function replyTurn(prev) {
    const all = turns();
    const last = all[all.length - 1];
    if (last && all.length > prev.turns && !isUserTurn(last)) return last;
    // fallback: นับจากข้อความฝั่ง assistant แทน
    const msgs = GC.qAll(S.assistantMsg);
    if (msgs.length > prev.assistants) {
      const m = msgs[msgs.length - 1];
      return m.closest(S.turn.join(',')) || m;
    }
    return null;
  }

  const hasDoneActions = (turn) => !!turn.querySelector(S.doneActions.join(','));

  // " ที่อยู่กลางสตริงถือเป็นตัวปิดสตริงเมื่อตัวถัดไป (ข้ามช่องว่าง) เป็น , } ] : หรือจบข้อความ
  function closesString(text, i) {
    const m = /\S/.exec(text.slice(i + 1, i + 200));
    return !m || ',}]:'.includes(m[0]);
  }

  // ตัด {...} ที่วงเล็บครบคู่ เริ่มจากตำแหน่ง start แล้วซ่อม " ที่ไม่มี \ นำหน้า
  // (ChatGPT แสดง JSON เป็นข้อความธรรมดาแล้วตัด \ ออก เช่น She says in Thai: "สวยค่ะ")
  function balancedFrom(text, start) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    let out = '';
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') {
          if (closesString(text, i)) inStr = false;
          else {
            out += '\\"';
            continue;
          }
        } else if (c === '\n') {
          out += '\\n';
          continue;
        }
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return out + c;
      out += c;
    }
    return null;
  }

  // หา JSON แผนคลิปตัวสุดท้ายในข้อความ (ข้าม JSON ตัวอย่างที่อยู่ในคำสั่งที่เราส่งไป)
  function findLastPlanJson(text) {
    const starts = [...text.matchAll(/\{\s*"scenes"\s*:/g)].map((m) => m.index).reverse();
    for (const s of starts) {
      const obj = balancedFrom(text, s);
      if (!obj) continue;
      try {
        const j = JSON.parse(obj);
        const first = j.scenes?.[0];
        if (first && !/English prompt for Google Veo|คำสั่งภาษาไทยสำหรับสร้างภาพ/.test(`${first.video_prompt} ${first.image_prompt}`)) return obj;
      } catch {}
    }
    return null;
  }

  function imagesIn(turn) {
    const seen = new Map();
    for (const img of turn.querySelectorAll('img')) {
      const src = img.currentSrc || img.src;
      if (!src || !img.complete || img.naturalWidth < 256) continue;
      if (/avatar|profile/i.test(img.alt || '')) continue;
      const area = img.naturalWidth * img.naturalHeight;
      if (!seen.has(src) || seen.get(src).area < area) seen.set(src, { img, src, area });
    }
    return [...seen.values()].sort((a, b) => b.area - a.area);
  }

  function composerOf(editor) {
    return editor.closest('form') || editor.closest('[class*="composer"]') || editor.parentElement?.parentElement || document.body;
  }

  async function attach(images) {
    const editor = await GC.waitFor(() => GC.q(S.editor), { label: 'ช่องพิมพ์ของ ChatGPT' });
    const files = await Promise.all(images.map((d, i) => GC.dataUrlToFile(d, `product-${i + 1}.${d.startsWith('data:image/png') ? 'png' : 'jpg'}`)));
    const composer = composerOf(editor);
    const before = composer.querySelectorAll('img').length;
    const attached = () => composer.querySelectorAll('img').length > before;

    const input = GC.qAll(S.fileInput)[0];
    if (input) GC.setFiles(input, files);
    else GC.pasteFiles(editor, files);
    try {
      await GC.waitFor(attached, { timeout: 12000, label: 'รูปแนบ' });
      return;
    } catch (e) {
      if (e.message === 'ABORTED') throw e;
    }
    GC.pasteFiles(editor, files);
    try {
      await GC.waitFor(attached, { timeout: 10000, label: 'รูปแนบ' });
    } catch (e) {
      if (e.message === 'ABORTED') throw e;
      await GC.askOrFail('แนบรูปสินค้าอัตโนมัติไม่สำเร็จ\nกรุณาลากรูปสินค้าจริงมาวางในช่องแชตเอง (ห้ามกดส่ง) แล้วกด "ทำต่อ"');
    }
  }

  async function send(text) {
    const editor = await GC.waitFor(() => GC.q(S.editor), { label: 'ช่องพิมพ์ของ ChatGPT' });
    await GC.typeInto(editor, text);
    await GC.sleep(600);
    // ปุ่มส่งจะ disabled ระหว่างอัปโหลดรูป จึงรอจนกดได้
    const btn = await GC.waitFor(
      () => {
        const b = GC.q(S.sendButton);
        return b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' ? b : null;
      },
      { timeout: 240000, label: 'ปุ่มส่ง (รออัปโหลดรูป)' }
    );
    btn.click();
  }

  // จุดเริ่มสำหรับรอคำตอบของข้อความล่าสุดที่ส่งไปแล้ว (ใช้ตอนต่อการเชื่อมต่อใหม่หลังหน้าเว็บโหลดใหม่)
  function snapshotBeforeLastUser() {
    const all = turns();
    let i = all.length - 1;
    while (i >= 0 && !isUserTurn(all[i])) i--;
    const lastUser = all[i];
    const assistants = GC.qAll(S.assistantMsg).filter(
      (m) => lastUser && lastUser.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_PRECEDING
    ).length;
    return { turns: i + 1, assistants, imgs: allImageSrcs() };
  }

  // พื้นที่คำตอบ: ใช้ turn ถ้าหาเจอ ถ้าไม่เจอ (ChatGPT เปลี่ยนโครงหน้า) ใช้ทั้งหน้าแชตแทน
  function replyRegion(prev) {
    const turn = replyTurn(prev);
    if (turn) return { el: turn, virtual: false, imgs: imagesIn(turn) };
    const el = chatRoot();
    // ภาพที่ ChatGPT สร้างแสดงขนาดใหญ่ ส่วนรูปที่เราแนบไปในข้อความแสดงเป็นภาพเล็ก จึงไม่นับภาพที่กว้างไม่ถึง 200px
    const big = (i) => i.img.getBoundingClientRect().width >= 200;
    return { el, virtual: true, imgs: imagesIn(el).filter((i) => !prev.imgs?.has(i.src) && big(i)) };
  }

  // ตรวจว่าตอบเสร็จได้หลายวิธี เพราะโมเดลแบบคิดนาน (Thinking) อาจใช้เวลาหลายนาที
  async function waitReply(prev, { timeout, wantImage, expectJson }) {
    const start = Date.now();
    const end = start + timeout;
    let started = false;
    let sawGenerating = false;
    let lastSig = '';
    let stableSince = Date.now();
    let lastDiag = 0;
    let hint = null;
    try {
      while (Date.now() < end) {
        GC.checkAbort();
        const generating = isGenerating();
        // รูปที่เราแนบไปจะขึ้นในข้อความของเราก่อน ChatGPT เริ่มทำงาน: นับเป็นรูปเก่า (ไม่ใช่ภาพที่สร้าง)
        // จำกัดแค่ 15 วินาทีแรก เผื่อกรณีตรวจไม่เจอว่า ChatGPT กำลังทำงาน จะได้ไม่กลืนภาพที่สร้างจริง
        if (!sawGenerating && !generating && prev.imgs && Date.now() - start < 15000) {
          for (const s of allImageSrcs()) prev.imgs.add(s);
        }
        const region = replyRegion(prev);
        const { el, virtual, imgs } = region;
        sawGenerating ||= generating;
        started ||= !virtual || generating || imgs.length > 0;
        if (!started && Date.now() - start > 120000) throw new Error('ChatGPT ไม่เริ่มตอบภายใน 2 นาที (ข้อความถูกส่งหรือยัง?)');

        const text = el.innerText || '';
        const json = expectJson ? findLastPlanJson(text) || (virtual ? findLastPlanJson(document.body.innerText) : null) : null;
        const sig = `${text.length}|${imgs.map((i) => i.src).join(',')}|${generating}`;
        if (sig !== lastSig) {
          lastSig = sig;
          stableSince = Date.now();
        }
        const stableFor = Date.now() - stableSince;
        // ปุ่มคัดลอกใต้คำตอบใช้ได้เฉพาะเมื่อรู้ว่า turn ไหนคือคำตอบ
        const finished = !virtual && hasDoneActions(el);
        // ถ้าใช้ทั้งหน้าแชต ต้องเคยเห็นว่ากำลังทำงานก่อน ไม่งั้นจะจบทันทีตั้งแต่ยังไม่เริ่มตอบ
        const canFinish = !virtual || sawGenerating || imgs.length > 0 || !!json;

        if (started && canFinish) {
          if (wantImage) {
            if (imgs.length && ((!generating && stableFor > 8000) || (finished && stableFor > 5000))) return region;
            // ตอบเป็นข้อความแต่ไม่ได้สร้างภาพ (เช่น ถามกลับ หรือติดนโยบาย)
            if (!imgs.length && !generating && (finished || virtual) && stableFor > 20000) return region;
          } else if (expectJson) {
            if (json && !generating && stableFor > 3000) return region;
            if (json && stableFor > 20000) return region;
            if (!json && !generating && stableFor > 15000) return region;
          } else if ((!generating || finished) && stableFor > 4000) {
            return region;
          }
        }

        if (Date.now() - lastDiag > 15000) {
          lastDiag = Date.now();
          GC.log(
            `[ChatGPT] รอ ${Math.round((Date.now() - start) / 1000)} วิ · turns=${turns().length} ` +
              `โหมด=${virtual ? 'ทั้งหน้า' : 'turn'} กำลังทำงาน=${generating} เจอJSON=${!!json} ` +
              `นิ่ง=${Math.round(stableFor / 1000)} วิ รูปใหม่=${imgs.length}`
          );
        }
        if (!hint && Date.now() - start > 90000) {
          hint = GC.showHint('ถ้า ChatGPT ตอบเสร็จแล้วแต่ระบบยังไม่ไปต่อ กด "ทำต่อ" ได้เลย');
        }
        if (hint?.clicked) {
          GC.log('ผู้ใช้กดทำต่อ ข้ามการรอคำตอบ', 'warn');
          return replyRegion(prev);
        }
        await GC.sleep(1000);
      }
    } finally {
      hint?.remove();
    }
    throw new Error('หมดเวลารอคำตอบจาก ChatGPT');
  }

  async function imageData(src) {
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status);
      return { dataUrl: await GC.blobToDataUrl(await res.blob()) };
    } catch {
      // ให้ side panel ดึงเองด้วยสิทธิ์ของ extension
      return { url: src };
    }
  }

  async function finishReply(prev, region, { wantImage, expectJson }) {
    let { el, imgs } = region;
    if (wantImage && !imgs.length) {
      await GC.askOrFail('ChatGPT ยังไม่ได้สร้างภาพ\nกรุณาพิมพ์สั่งให้สร้างภาพเองในแชตนี้ (เช่น "สร้างภาพได้เลย") รอจนภาพเสร็จ แล้วกด "ทำต่อ"');
      ({ el, imgs } = replyRegion(prev));
      if (!imgs.length) throw new Error('ไม่พบภาพที่ ChatGPT สร้าง');
    }
    const text = el?.innerText || '';
    return {
      text: (expectJson && (findLastPlanJson(text) || findLastPlanJson(document.body.innerText))) || text,
      image: imgs.length ? await imageData(imgs[0].src) : null,
    };
  }

  // payload: { prompt, images?: dataUrl[], wantImage?: bool, expectJson?: bool, timeout?: ms }
  GC.handlers['chatgpt:send'] = async ({ prompt, images, wantImage, expectJson, timeout }) => {
    await loadSelectors();
    await GC.waitFor(() => GC.q(S.editor), { timeout: 45000, label: 'หน้า ChatGPT พร้อมใช้งาน (ล็อกอินหรือยัง?)' });
    const prev = snapshot();
    if (images?.length) await attach(images);
    await send(prompt);
    const reply = await waitReply(prev, { timeout: timeout || 600000, wantImage, expectJson });
    return finishReply(prev, reply, { wantImage, expectJson });
  };

  // รอคำตอบของข้อความที่ส่งไปแล้ว โดยไม่ส่งซ้ำ
  GC.handlers['chatgpt:wait'] = async ({ wantImage, expectJson, timeout }) => {
    await loadSelectors();
    await GC.waitFor(() => GC.q(S.editor), { timeout: 45000, label: 'หน้า ChatGPT พร้อมใช้งาน' });
    const prev = snapshotBeforeLastUser();
    const reply = await waitReply(prev, { timeout: timeout || 600000, wantImage, expectJson });
    return finishReply(prev, reply, { wantImage, expectJson });
  };

  // หาโครงสร้างของข้อความแชต: ไล่จากข้อความยาวท้าย ๆ ของหน้าขึ้นไปถึง main แล้วบอก tag/class/attribute ของแต่ละชั้น
  function probeMessages() {
    const root = chatRoot();
    const describe = (el) => {
      const attrs = [...el.attributes]
        .filter((a) => a.name.startsWith('data-') || a.name === 'role' || a.name === 'id')
        .map((a) => `${a.name}=${a.value.slice(0, 30)}`);
      return `${el.tagName}.${(el.className || '').toString().split(/\s+/).slice(0, 3).join('.')} ${attrs.join(' ')}`.trim();
    };
    const blocks = [...root.querySelectorAll('p, li, pre, code')].filter((e) => GC.isVisible(e) && e.innerText.trim().length > 20);
    const samples = blocks.slice(-2).concat(blocks.length > 2 ? [blocks[0]] : []);
    return {
      shadowRoots: [...root.querySelectorAll('*')].filter((e) => e.shadowRoot).length,
      iframes: document.querySelectorAll('iframe').length,
      textBlocks: blocks.length,
      chains: samples.map((el) => {
        const chain = [];
        for (let e = el; e && e !== root && chain.length < 12; e = e.parentElement) chain.push(describe(e));
        return { text: el.innerText.trim().slice(0, 40), chain };
      }),
    };
  }

  // ข้อมูลโครงสร้างหน้าเว็บ สำหรับส่งให้ผู้พัฒนาปรับ selector
  GC.handlers['gc:inspect'] = async () => {
    await loadSelectors();
    const count = (sel) => GC.qAll(sel).length;
    const area = controlsArea();
    const all = turns();
    return {
      url: location.href,
      selectors: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, count(v)])),
      controlsArea: area ? `${area.tagName}.${(area.className || '').toString().slice(0, 60)}` : null,
      composerButtons: area
        ? [...area.querySelectorAll('button')].map((b) => `${buttonInfo(b).trim()} | ${b.innerText.trim().slice(0, 20)} | visible=${GC.isVisible(b)}`)
        : [],
      isGenerating: isGenerating(),
      messageProbe: probeMessages(),
      lastTurns: all.slice(-2).map((t) => ({
        tag: t.tagName,
        testid: t.dataset.testid || '',
        turn: t.dataset.turn || '',
        roles: [...t.querySelectorAll('[data-message-author-role]')].map((m) => m.dataset.messageAuthorRole),
        actions: [...t.querySelectorAll('button')].map((b) => b.dataset.testid || b.getAttribute('aria-label')).filter(Boolean).slice(0, 8),
        imgs: t.querySelectorAll('img').length,
        text: t.innerText.slice(0, 80),
      })),
    };
  };
})();
