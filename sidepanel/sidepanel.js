// ตัวควบคุมการทำงานทั้งหมด: ChatGPT (วางแผน + สร้างภาพ) -> Flow (สร้างวิดีโอ) -> ดาวน์โหลด
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = {
  chatgpt: {
    match: 'https://chatgpt.com/*',
    home: 'https://chatgpt.com/',
    files: ['content/common.js', 'content/chatgpt.js'],
  },
  flow: {
    match: ['https://flow.google.com/*', 'https://labs.google/fx/*'],
    home: 'https://flow.google.com/',
    files: ['content/common.js', 'content/flow.js'],
  },
  tiktok: {
    match: 'https://www.tiktok.com/*',
    home: 'https://www.tiktok.com/tiktokstudio/upload',
    files: ['content/common.js', 'content/tiktok-post.js'],
  },
  facebook: {
    match: 'https://business.facebook.com/*',
    home: 'https://business.facebook.com/latest/reels_composer',
    files: ['content/common.js', 'content/fb-post.js'],
  },
};
const STATUS = { pending: 'รอคิว', running: 'กำลังทำ', done: 'เสร็จ', error: 'ผิดพลาด' };

let queue = [];
// ChatGPT รับไฟล์แนบได้ประมาณ 10 ไฟล์ต่อข้อความ
const MAX_IMAGES = 10;
let imagePool = []; // { src, selected }
let running = false;
let aborted = false;

// ---------- UI ----------

function log(msg, kind = 'info') {
  const el = document.createElement('div');
  el.className = `log-${kind}`;
  el.textContent = `[${new Date().toLocaleTimeString('th-TH')}] ${msg}`;
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
}

const selectedImages = () => imagePool.filter((i) => i.selected).map((i) => i.src);

function addToPool(srcs, autoSelect) {
  for (const src of srcs) {
    const selected = autoSelect > 0 && selectedImages().length < MAX_IMAGES;
    if (selected) autoSelect--;
    imagePool.push({ src, selected });
  }
  renderPreview();
}

function renderPreview() {
  $('preview').innerHTML = '';
  for (const item of imagePool) {
    const img = document.createElement('img');
    img.src = item.src;
    img.className = item.selected ? 'selected' : '';
    img.onclick = () => {
      if (!item.selected && selectedImages().length >= MAX_IMAGES) return alert(`เลือกได้สูงสุด ${MAX_IMAGES} รูป`);
      item.selected = !item.selected;
      renderPreview();
    };
    $('preview').appendChild(img);
  }
}

function renderQueue() {
  const ul = $('queue');
  ul.innerHTML = '';
  if (!queue.length) {
    ul.innerHTML = '<li class="empty">ยังไม่มีสินค้าในคิว</li>';
    return;
  }
  for (const p of queue) {
    const li = document.createElement('li');
    li.innerHTML = `<img alt=""><div class="info"><b></b><small></small></div><span class="badge"></span>
      <button class="icon" data-act="reset" title="ทำต่อ (ข้ามขั้นที่เสร็จแล้ว)">↻</button>
      <button class="icon" data-act="restart" title="เริ่มใหม่ทั้งหมด (ทิ้งแผนและภาพเดิม)">⟲</button>
      <button class="icon" data-act="merge" title="รวมคลิปของสินค้านี้อีกครั้ง">🎬</button>
      <button class="icon" data-act="tiktok" title="เตรียมโพสต์ TikTok (แนบคลิป ใส่แคปชัน เปิดป้าย AI ปักตะกร้า แล้วกดโพสต์เอง)">📤</button>
      <button class="icon" data-act="facebook" title="โพสต์ Reels ลงเพจ Facebook (Business Suite)">📘</button>
      <button class="icon" data-act="product" title="ใส่รหัสสินค้า TikTok Shop สำหรับปักตะกร้า">🛒</button>
      <button class="icon" data-act="del" title="ลบ">×</button>`;
    li.querySelector('img').src = p.images[0];
    li.querySelector('b').textContent = p.name;
    const pg = p.progress;
    const steps = pg?.plan ? ` · ภาพ ${pg.frames.length}/${pg.plan.scenes.length} · วิดีโอ ${pg.videosDone}/${pg.plan.scenes.length}` : '';
    li.querySelector('small').textContent = `${p.type} · ${p.scenes} ฉาก · ${p.images.length} รูป${steps}`;
    const badge = li.querySelector('.badge');
    badge.textContent = STATUS[p.status];
    badge.dataset.status = p.status;
    li.querySelectorAll('button').forEach((b) => {
      b.disabled = running;
      b.onclick = () => onItemAction(p.id, b.dataset.act);
    });
    // โพสต์แล้ว: ปิดปุ่มโพสต์ซ้ำ (กด ⟲ เริ่มใหม่ = คลิปใหม่ จะโพสต์ได้อีก)
    for (const [act, at, where] of [['tiktok', p.tiktokPostedAt, 'TikTok'], ['facebook', p.fbPostedAt, 'เพจ Facebook']]) {
      if (!at) continue;
      const b = li.querySelector(`[data-act="${act}"]`);
      b.disabled = true;
      b.classList.add('done');
      b.title = `โพสต์ลง${where}แล้ว (${new Date(at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })})`;
    }
    // ปุ่มรายฉาก กดวน 3 สถานะ แล้วกด ↻ จะทำเฉพาะฉากที่ไม่ใช่ ✓
    //   ✓ เสร็จแล้ว  →  ○ ทำวิดีโอใหม่ (ภาพเดิม)  →  🖼 สร้างภาพใหม่ + ทำวิดีโอใหม่  →  ✓
    if (pg?.plan && pg.frames.length) {
      const done = pg.videoDone || pg.plan.scenes.map((_, i) => i < (pg.videosDone || 0));
      const redo = pg.redoFrame || [];
      const row = document.createElement('div');
      row.className = 'scene-row';
      row.title = 'กดวน: ✓ เสร็จแล้ว → ○ ทำวิดีโอใหม่ (ภาพเดิม) → 🖼 สร้างภาพใหม่และวิดีโอใหม่';
      pg.plan.scenes.forEach((_, i) => {
        const state = redo[i] || !pg.frames[i]?.dataUrl ? 'image' : done[i] ? 'done' : 'video';
        const chip = document.createElement('button');
        chip.className = `chip${state === 'done' ? ' ok' : state === 'image' ? ' img' : ''}`;
        chip.textContent = `${{ done: '✓', video: '○', image: '🖼' }[state]} ฉาก ${i + 1}`;
        chip.title = { done: 'เสร็จแล้ว', video: 'จะทำวิดีโอใหม่ (ใช้ภาพเดิม)', image: 'จะสร้างภาพใหม่ แล้วทำวิดีโอใหม่' }[state];
        chip.disabled = running;
        chip.onclick = async () => {
          const next = { done: 'video', video: 'image', image: 'done' }[state];
          pg.videoDone = pg.plan.scenes.map((_, j) => (j === i ? next === 'done' : !!done[j]));
          pg.redoFrame = pg.plan.scenes.map((_, j) => (j === i ? next === 'image' : !!redo[j]));
          pg.videosDone = pg.videoDone.filter(Boolean).length;
          p.status = 'pending';
          await saveQueue();
        };
        row.appendChild(chip);
      });
      li.appendChild(row);
    }
    ul.appendChild(li);
  }
}

function setRunningUI() {
  $('startBtn').disabled = running;
  $('stopBtn').disabled = !running;
  $('addBtn').disabled = running;
  renderQueue();
}

async function saveQueue() {
  await chrome.storage.local.set({ queue });
  renderQueue();
}

async function setStatus(p, status) {
  p.status = status;
  await saveQueue();
}

async function onItemAction(id, act) {
  const p = queue.find((x) => x.id === id);
  if (act === 'merge' || act === 'tiktok' || act === 'facebook') {
    // ยังไม่มีไฟล์ของบางฉาก (เช่น ทำก่อนมีระบบเก็บไฟล์): ให้เลือกไฟล์วิดีโอของสินค้านี้ก่อน
    // (ต้องเปิดหน้าต่างเลือกไฟล์ทันทีหลังกดปุ่ม Chrome จึงจะยอม)
    const needClips = act === 'merge' || !(await ClipStore.get(p.id, 'final'));
    if (needClips && (await missingScenes(p)).length && !(await askClipsForProduct(p))) return;
    // ขออนุญาตโฟลเดอร์หลักตอนกดปุ่ม (ตอนบันทึกหลังรวมคลิปเสร็จจะขอเองไม่ได้แล้ว)
    await RootFolder.ready(true).catch(() => null);
    showFolder();
    running = true;
    aborted = false;
    setRunningUI();
    try {
      if (act === 'merge') await mergeProduct(p);
      else if (act === 'facebook') await prepareFacebook(p);
      else await prepareTikTok(p);
    } catch (e) {
      log(`${{ merge: 'รวมคลิป', tiktok: 'TikTok: เตรียมโพสต์', facebook: 'Facebook: เตรียมโพสต์' }[act]}ไม่สำเร็จ: ${e.message}`, 'error');
    } finally {
      running = false;
      setRunningUI();
    }
    return;
  }
  if (act === 'del') {
    queue = queue.filter((x) => x.id !== id);
    await ClipStore.clear(id).catch(() => {});
  }
  if (act === 'product') {
    const v = prompt(`รหัสสินค้า TikTok Shop ของ "${p.name}" (ดูได้จากลิงก์หน้าแก้ไขสินค้าใน Seller Center)\nเว้นว่างไว้ = ค้นจากชื่อสินค้า`, p.productId || '');
    if (v === null) return;
    p.productId = v.replace(/\D/g, '');
    log(p.productId ? `ตั้งรหัสสินค้า TikTok Shop ของ "${p.name}" = ${p.productId}` : `"${p.name}" จะค้นตะกร้าจากชื่อสินค้า`, 'ok');
  }
  if (act === 'reset') p.status = 'pending';
  if (act === 'restart') {
    p.status = 'pending';
    delete p.progress;
    delete p.tiktokPostedAt;
    delete p.fbPostedAt;
    await ClipStore.clear(id).catch(() => {});
  }
  await saveQueue();
}

// ย่อรูปไม่ให้ใหญ่เกิน เพื่อประหยัดพื้นที่และอัปโหลดเร็วขึ้น
async function fileToDataUrl(file, max = 1536) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.92);
}

// ---------- helpers ----------

function checkAbort() {
  if (aborted) throw new Error('ABORTED');
}

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...GC_DEFAULTS, ...settings };
}

const pad = (n) => String(n).padStart(2, '0');

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '') || 'product';
}

function imageExt(dataUrl) {
  const m = /^data:image\/(\w+)/.exec(dataUrl);
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png';
}

// ดาวน์โหลดโดยตั้งชื่อไฟล์เอง: เพราะมี onDeterminingFilename อยู่ (ไว้เปลี่ยนชื่อไฟล์จาก Flow)
// Chrome จะไม่ใช้ filename ที่ส่งไปตอนสั่งดาวน์โหลด จึงต้องจำชื่อไว้แล้วตั้งซ้ำใน listener
const ownDownloads = new Map(); // url -> ชื่อไฟล์ที่ต้องการ
function downloadAs(url, filename) {
  ownDownloads.set(url, filename);
  return chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
}

function download(url, folder, name) {
  return downloadAs(url, `GenClip/${folder}/${name}`);
}

function downloadText(text, folder, name) {
  return download(`data:text/plain;charset=utf-8,${encodeURIComponent('﻿' + text)}`, folder, name);
}

async function fetchAsDataUrl(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`ดาวน์โหลดภาพไม่สำเร็จ (${res.status})`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function parsePlan(text) {
  const candidates = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      if (Array.isArray(j.scenes) && j.scenes.length) return j;
    } catch {}
  }
  return null;
}

function buildScript(p, plan, scenes, companion) {
  const lines = [`สินค้า: ${p.name} (${p.type})`, `รายละเอียด: ${p.details || '-'}`];
  if (companion) lines.push(`ชุดคู่: ${companion.label} ${companion.name}${companion.sku ? ` (${companion.sku})` : ''} สี${companion.color}`);
  lines.push('');
  scenes.forEach((s, i) => {
    lines.push(
      `=== ฉากที่ ${i + 1} ===`,
      `บทพูด: ${s.script_th || '-'}`,
      `Image prompt: ${s.image_prompt || '-'}`,
      `Video prompt: ${s.video_prompt || '-'}`,
      ''
    );
  });
  lines.push('=== แคปชัน ===', plan.caption || '-', '', (plan.hashtags || []).join(' '), '');
  lines.push('หมายเหตุ: คลิปนี้สร้างด้วย AI ควรติดป้าย "เนื้อหาที่สร้างด้วย AI" ตอนโพสต์');
  return lines.join('\r\n');
}

// ---------- tabs ----------

async function findSiteTabs(site) {
  const tabs = await chrome.tabs.query({ url: SITES[site].match });
  // labs.google มีหลายเครื่องมือ จึงเลือกเฉพาะหน้า Flow ส่วน flow.google.com ใช้ได้ทุกหน้า
  return site === 'flow' ? tabs.filter((t) => /flow\.google\.com|\/tools\/flow/.test(t.url || '')) : tabs;
}

async function getSiteTab(site) {
  const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabs = await findSiteTabs(site);
  let tab = tabs.find((t) => t.windowId === cur?.windowId) || tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: SITES[site].home, active: true, windowId: cur?.windowId });
    await waitComplete(tab.id);
  }
  return tab;
}

async function activate(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function waitComplete(tabId, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    checkAbort();
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') return;
    await sleep(500);
  }
}

async function ensureContent(tabId, site) {
  for (let i = 0; i < 20; i++) {
    checkAbort();
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'gc:ping' });
      if (r?.ok && r.site === site) return;
    } catch {}
    // แท็บที่เปิดไว้ก่อนติดตั้ง extension จะยังไม่มี content script
    if (i === 3) await chrome.scripting.executeScript({ target: { tabId }, files: SITES[site].files }).catch(() => {});
    await sleep(1000);
  }
  throw new Error(`เชื่อมต่อหน้า ${site} ไม่ได้ ลองรีเฟรชแท็บนั้น`);
}

async function call(tab, site, type, payload) {
  checkAbort();
  await ensureContent(tab.id, site);
  const res = await chrome.tabs.sendMessage(tab.id, { type, payload });
  if (!res) throw new Error('หน้าเว็บไม่ตอบกลับ (แท็บอาจถูกรีเฟรชหรือปิด)');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ส่งข้อความหา ChatGPT ถ้าการเชื่อมต่อหลุดกลางทาง (หน้าโหลดใหม่) จะต่อใหม่แล้วรอคำตอบเดิมโดยไม่ส่งซ้ำ
async function askChat(tab, payload) {
  try {
    return await call(tab, 'chatgpt', 'chatgpt:send', payload);
  } catch (e) {
    if (aborted || !/message channel closed|Receiving end does not exist|ไม่ตอบกลับ/i.test(e.message)) throw e;
    log('การเชื่อมต่อกับแท็บ ChatGPT หลุด กำลังต่อใหม่และรอคำตอบเดิม...', 'warn');
    await sleep(3000);
    await waitComplete(tab.id);
    const { prompt, images, ...rest } = payload;
    return call(tab, 'chatgpt', 'chatgpt:wait', rest);
  }
}

// รันใน MAIN world ของหน้า Flow: เมื่อหน้าเว็บเปิดหน้าต่างเลือกไฟล์ ให้ใส่ไฟล์ภาพของเราแทน (ใช้ได้ครั้งเดียว ภายใน 2 นาที)
// จำเป็นเพราะ Flow แบบแชตสร้างช่องอัปโหลดชั่วคราวที่ content script มองไม่เห็น
function installFileHook(dataUrl, name) {
  if (!dataUrl) {
    window.__genclipFile = null;
    return;
  }
  const [meta, b64] = dataUrl.split(',');
  const type = meta.slice(5, meta.indexOf(';')) || 'image/png';
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  window.__genclipFile = { file: new File([bytes], name, { type }), expires: Date.now() + 120000 };
  if (window.__genclipHooked) return;
  window.__genclipHooked = true;

  const take = () => {
    const f = window.__genclipFile;
    window.__genclipFile = null;
    return f && Date.now() < f.expires ? f.file : null;
  };
  const fill = (input, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file') {
      const file = take();
      if (file) return fill(this, file);
    }
    return origClick.call(this);
  };
  const origPicker = HTMLInputElement.prototype.showPicker;
  if (origPicker) {
    HTMLInputElement.prototype.showPicker = function () {
      if (this.type === 'file') {
        const file = take();
        if (file) return fill(this, file);
      }
      return origPicker.call(this);
    };
  }
  if (window.showOpenFilePicker) {
    const orig = window.showOpenFilePicker;
    window.showOpenFilePicker = async (...args) => {
      const file = take();
      if (!file) return orig(...args);
      return [{ kind: 'file', name: file.name, getFile: async () => file }];
    };
  }
}

// ไฟล์ที่ Flow ให้เบราว์เซอร์ดาวน์โหลด (กดปุ่มดาวน์โหลดของ Flow ทั้งโดยระบบหรือผู้ใช้กดเอง)
// ระหว่างทำฉากหนึ่งจะถูกตั้งชื่อเป็น GenClip/<โฟลเดอร์>/scene-NN.mp4
let pendingRename = null;
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId === chrome.runtime.id) {
    // ไฟล์ที่ GenClip สั่งดาวน์โหลดเอง: ตั้งชื่อตามที่กำหนดไว้
    const filename = ownDownloads.get(item.url);
    if (!filename) return;
    ownDownloads.delete(item.url);
    suggest({ filename, conflictAction: 'uniquify' });
    return;
  }
  if (!pendingRename) return;
  const from = `${item.url} ${item.finalUrl || ''} ${item.referrer || ''}`;
  if (!/flow\.google\.com|labs\.google|googleusercontent|googleapis/.test(from) && !/^video\//.test(item.mime || '')) return;
  const { folder, name, resolve } = pendingRename;
  pendingRename = null;
  const ext = (item.filename.match(/\.\w{2,4}$/) || ['.mp4'])[0];
  suggest({ filename: `GenClip/${folder}/${name}${ext}`, conflictAction: 'uniquify' });
  resolve({ file: `${name}${ext}`, url: item.finalUrl || item.url });
});

function expectFlowDownload(folder, name) {
  return new Promise((resolve) => (pendingRename = { folder, name, resolve }));
}

// ตัวช่วยแนบไฟล์แบบรับไฟล์จาก content script (postMessage ส่ง File ข้ามโลกได้ ไม่ต้องแปลงเป็นข้อความ เหมาะกับคลิปใหญ่)
// ใช้กับเว็บที่สร้างช่องเลือกไฟล์ขึ้นมาชั่วคราวแล้วสั่ง click() โดยไม่ใส่ในหน้า (เช่น Meta Business Suite)
// content script ส่ง window.postMessage({ __genclipFile: file }) ไว้ก่อน แล้วกดปุ่ม "เพิ่มวิดีโอ"
function installPageFileHook() {
  if (window.__genclipPageHook) return;
  window.__genclipPageHook = true;
  let pending = null;
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !('__genclipFile' in e.data)) return;
    pending = e.data.__genclipFile ? { file: e.data.__genclipFile, expires: Date.now() + 120000 } : null;
  });
  const take = () => {
    const f = pending;
    pending = null;
    return f && Date.now() < f.expires ? f.file : null;
  };
  const fill = (input, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    window.postMessage({ __genclipFilled: true }, '*');
  };
  const origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file' && pending) {
      const file = take();
      if (file) return fill(this, file);
    }
    return origClick.call(this);
  };
  const origPicker = HTMLInputElement.prototype.showPicker;
  if (origPicker) {
    HTMLInputElement.prototype.showPicker = function () {
      if (this.type === 'file' && pending) {
        const file = take();
        if (file) return fill(this, file);
      }
      return origPicker.call(this);
    };
  }
  // คลิกโดนช่องเลือกไฟล์ในหน้าโดยตรง: ไม่เปิดหน้าต่างของระบบ ใส่ไฟล์ให้แทน
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type === 'file' && pending) {
        e.preventDefault();
        fill(t, take());
      }
    },
    true
  );
  if (window.showOpenFilePicker) {
    const orig = window.showOpenFilePicker;
    window.showOpenFilePicker = async (...args) => {
      const file = take();
      if (!file) return orig(...args);
      window.postMessage({ __genclipFilled: true }, '*');
      return [{ kind: 'file', name: file.name, getFile: async () => file }];
    };
  }
}

async function setFlowFileHook(tabId, frame) {
  await chrome.scripting
    .executeScript({ target: { tabId }, world: 'MAIN', func: installFileHook, args: frame ? [frame.dataUrl, frame.name] : [null, null] })
    .catch((e) => log(`ติดตั้งตัวช่วยแนบไฟล์ไม่สำเร็จ: ${e.message}`, 'warn'));
}

// คำที่ทำให้ตัวกรอง "บุคคลที่มีชื่อเสียง" ของ Flow ทำงานโดยไม่จำเป็น (เช่น non-famous, celebrity) ตัดออกจาก video prompt
function cleanVideoPrompt(s) {
  return s
    .replace(/\b(a |an )?(fictional,?\s*)?(ordinary,?\s*)?non-?famous( person)?/gi, 'an ordinary everyday person')
    // ประโยคที่พูดถึงคนดัง (เช่น She is not a celebrity.) ตัดทั้งประโยค
    .replace(/[^.]*\b(celebrit(y|ies)|famous|public figures?|prominent (person|people)|look-?alike)\b[^.]*\.\s*/gi, ' ')
    .replace(/\b(celebrit(y|ies)|famous|look-?alike|public figures?|prominent (person|people))\b/gi, '')
    .replace(/\b(fictional|fictitious|imaginary)\s+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// video prompt แบบสั้นที่ปลอดภัย: ใช้ตอน Flow ปฏิเสธ prompt เต็ม (ไม่พูดถึงตัวตน/หน้าตา/ต้นแบบของผู้นำเสนอเลย)
function safeVideoPrompt(scene, { speech = true, textBaked = false } = {}) {
  const line = String(scene.script_th || '').replace(/["'“”‘’]/g, '').trim();
  return [
    'Use the attached image as the start frame and animate it into ONE 8-second vertical 9:16 video. Generate it now without asking follow-up questions.',
    'The woman in the image presents the clothing she is wearing like a friendly shop seller, with natural small hand gestures and a slow gentle camera push-in.',
    speech && line ? `She talks to the camera and says in Thai: '${line}'.` : 'She smiles and gestures toward the garment, with soft background music and no dialogue.',
    'Keep the clothing, fabric pattern, colors and background exactly as in the image.',
    textBaked ? VIDEO_TEXT_RULE : 'No text, logos or watermarks.',
  ].join(' ');
}

// คำสั่งเพิ่มตอนสร้างภาพใหม่หลัง Flow ปฏิเสธเพราะหน้าคล้ายคนดัง
// คงผู้นำเสนอคนเดิม (แนบภาพฉากอื่นเป็นต้นแบบ) เปลี่ยนแค่ท่าทาง มุมกล้อง และระยะ ให้หน้าไม่เด่นเต็มเฟรมเหมือนภาพโปรไฟล์
const POLICY_FACE_FIX =
  'สำคัญ: ระบบสร้างวิดีโอไม่รับภาพเดิมของฉากนี้ ให้สร้างภาพใหม่โดยใช้ผู้นำเสนอคนเดิมทุกอย่าง ' +
  '(ใบหน้า ทรงผม อายุ เสื้อผ้า ให้เหมือนรูปฉากอื่นที่แนบ) แต่เปลี่ยนท่าทางและมุมกล้อง: ' +
  'ถอยกล้องออกให้เห็นตัวมากขึ้น หน้าหันเฉียงเล็กน้อย กำลังพูดหรือหัวเราะอย่างเป็นธรรมชาติ มือกำลังจับหรือชี้สินค้า ' +
  'ไม่ใช่ท่าโพสหน้าตรงแบบภาพโปรไฟล์ ฉาก แสง และสินค้าคงเดิม';

// ---------- ความหลากหลายของคลิป ----------

// ประวัติคลิปของสินค้าแต่ละชื่อ (สไตล์ที่ใช้ + บทเปิด) เก็บล่าสุด 8 รายการ
async function getClipHistory(name) {
  const { clipHistory = {} } = await chrome.storage.local.get('clipHistory');
  return clipHistory[name] || [];
}

async function addClipHistory(name, entry) {
  const { clipHistory = {} } = await chrome.storage.local.get('clipHistory');
  clipHistory[name] = [...(clipHistory[name] || []), { ...entry, at: Date.now() }].slice(-8);
  await chrome.storage.local.set({ clipHistory });
}

// 'auto' = สุ่มสไตล์ที่สินค้านี้ยังไม่เคยใช้ (ใช้ครบแล้วจะเลี่ยงสไตล์ที่ใช้ล่าสุด)
function pickStyle(choice, history) {
  const fixed = CLIP_STYLES.find((s) => s.id === choice);
  if (fixed) return fixed;
  const used = history.map((h) => h.styleId);
  const fresh = CLIP_STYLES.filter((s) => !used.includes(s.id));
  const pool = fresh.length ? fresh : CLIP_STYLES.filter((s) => s.id !== used[used.length - 1]);
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------- ชุดคู่จากเว็บร้าน ----------

const ROLE_LABEL = { top: 'เสื้อ', bottom: 'ผ้าถุง/กระโปรง' };

// รายการชุดคู่ที่มีของ (null = ไม่ใช้ เช่น ปิดในหน้าตั้งค่า สินค้าเป็นชุดเซ็ต หรือดึงจากเว็บไม่ได้)
async function loadCompanionCandidates(p, settings) {
  if (settings.companionMode === 'off') return null;
  const own = Catalog.roleOfQueued(p.type, p.name);
  if (own === 'other') return null;
  const want = own === 'top' ? 'bottom' : 'top';
  const base = (settings.companionSite || GC_DEFAULTS.companionSite).replace(/\/+$/, '');
  try {
    log(`ชุดคู่: กำลังดึง${ROLE_LABEL[want]}จาก ${base} ...`);
    const cands = await Catalog.candidates(base, want, 30);
    if (!cands.length) {
      log(`ชุดคู่: ไม่พบ${ROLE_LABEL[want]}ที่มีของในเว็บ จะไม่ใช้ชุดคู่`, 'warn');
      return null;
    }
    log(`ชุดคู่: ได้${ROLE_LABEL[want]} ${cands.length} แบบที่มีของ ให้ ChatGPT เลือกตัวที่เข้ากับสินค้า`);
    return { want, base, list: cands };
  } catch (e) {
    log(`ชุดคู่: ดึงสินค้าจากเว็บไม่สำเร็จ (${e.message}) จะไม่ใช้ชุดคู่`, 'warn');
    return null;
  }
}

function companionPromptBlock({ want, list }) {
  const lines = list.map((c) => `${c.ref}: ${c.name.slice(0, 70)} | ${c.category} | สีที่มี: ${c.colors.map((x) => x.name).slice(0, 10).join(', ')}`);
  return (
    `ชุดคู่จากร้าน (สินค้าจริงที่มีในสต็อก): ให้เลือก${ROLE_LABEL[want]} 1 แบบ และสี 1 สี จากรายการนี้ ` +
    `ที่แบบและสีเข้ากับสินค้าในรูปมากที่สุด (สีต้องไม่กลืนหรือตีกัน ดูสุภาพและขายได้)\n` +
    lines.join('\n') +
    '\nใส่ผลใน JSON เพิ่ม field: "companion": {"ref": "รหัส C ตามรายการ", "color": "ชื่อสีตามรายการ", "reason": "เหตุผลสั้น ๆ"} ' +
    `และใน image_prompt ทุกฉากให้ผู้นำเสนอสวม${ROLE_LABEL[want]}ที่เลือกนี้ (ระบุแบบและสี) คู่กับสินค้าหลัก`
  );
}

// แปลงตัวที่ ChatGPT เลือกเป็นข้อมูลชุดคู่ + รูปของสีนั้น (เลือกไม่ตรงรายการ = ใช้ตัวแรกที่ขายดีที่สุด)
async function resolveCompanion(choice, cands, p) {
  let item = cands.list.find((c) => c.ref === String(choice?.ref || '').trim().toUpperCase());
  let color = item?.colors.find((x) => x.name === String(choice?.color || '').trim());
  if (!item) {
    item = cands.list[0];
    log(`ชุดคู่: ChatGPT ไม่ได้เลือกจากรายการ ใช้ "${item.name.slice(0, 40)}" แทน`, 'warn');
  }
  color ||= item.colors[0];
  let image = null;
  try {
    const res = await fetch(color.image);
    if (res.ok) image = await fileToDataUrl(await res.blob());
  } catch {}
  if (!image) log('ชุดคู่: ดาวน์โหลดรูปชุดคู่ไม่ได้ จะบอกแบบและสีเป็นข้อความแทน', 'warn');
  log(`ชุดคู่ของ "${p.name.slice(0, 30)}": ${item.name.slice(0, 50)} สี${color.name}${choice?.reason ? ` (${choice.reason})` : ''}`, 'ok');
  return { role: cands.want, label: ROLE_LABEL[cands.want], name: item.name, sku: item.sku, color: color.name, image };
}

// ---------- main flow ----------

// ความคืบหน้าเก็บไว้ใน p.progress เพื่อให้กดทำต่อแล้วข้ามขั้นที่เสร็จแล้ว (แผน, ภาพ, วิดีโอ)
async function processProduct(p, settings, { skipVideo }) {
  p.progress ||= { folder: `${safeName(p.name)}_${stamp()}`, plan: null, frames: [], videosDone: 0 };
  const prog = p.progress;
  const folder = prog.folder;
  const resuming = !!prog.plan;
  log(`▶ ${resuming ? 'ทำต่อ' : 'เริ่ม'}: ${p.name} (โฟลเดอร์ GenClip/${folder})`);

  let chat = null;
  const openChat = async (fresh) => {
    chat = await getSiteTab('chatgpt');
    await activate(chat);
    if (fresh) {
      await chrome.tabs.update(chat.id, { url: SITES.chatgpt.home });
      await sleep(1500);
    }
    await waitComplete(chat.id);
  };

  // 1) ChatGPT: วางแผนฉาก + prompt
  const planThisRun = !prog.plan;
  if (!prog.plan) {
    await openChat(true);
    log('ChatGPT: กำลังวางแผนฉากและเขียน prompt...');
    // สไตล์คลิป + บทที่สินค้านี้เคยใช้ (ให้ ChatGPT คิดใหม่ไม่ซ้ำ)
    const history = await getClipHistory(p.name);
    const style = pickStyle(p.clipStyle, history);
    prog.styleId = style.id;
    log(`สไตล์คลิปรอบนี้: ${style.label}${history.length ? ` (สินค้านี้เคยทำ ${history.length} คลิป จะให้เนื้อหาไม่ซ้ำ)` : ''}`);
    // สุ่มสถานที่ ผู้นำเสนอ บทเปิด มุมกล้อง แสง โดยเลี่ยงค่าที่ใช้ใน 3 คลิปล่าสุดของสินค้านี้
    const recent = history.slice(-3).map((h) => h.variation || {});
    const lastUsed = Object.fromEntries(Object.keys(CLIP_VARIATIONS).map((k) => [k, recent.map((v) => v[k]).filter(Boolean)]));
    const variation = pickVariation(lastUsed);
    log(`องค์ประกอบคลิป: ${variation.location} · ${variation.persona} · ${variation.camera}`);
    // ชุดคู่จากเว็บร้าน (เสื้อ ↔ ผ้าถุง/กระโปรง) ให้ ChatGPT เลือกตัวและสีที่เข้ากับสินค้า
    const companionCands = await loadCompanionCandidates(p, settings);
    // ตัวหนังสือในคลิป: หัวข้อในภาพ (ChatGPT วาด) และ/หรือ ระบบเขียนทับตอนรวมคลิป
    const baked = settings.textInImage === 'all' || (settings.textInImage === 'adpro' && style.id === 'adpro');
    const text = baked || settings.textOverlay !== 'off' ? { baked, promo: p.promo } : null;
    prog.textBaked = baked;
    if (baked) log('ตัวหนังสือ: ให้ ChatGPT ใส่หัวข้อภาษาไทยในภาพ' + (settings.textOverlay !== 'off' ? ' + ระบบใส่ราคา/โปร/ปุ่มสั่งซื้อตอนรวมคลิป' : ''));
    let planBase = fillTemplate(settings.planTemplate, {
        name: p.name,
        type: p.type,
        details: p.details,
        style: p.style,
        scenes: p.scenes,
      });
    if (baked) planBase = planBase.replace(/ห้ามมีตัวหนังสือ โลโก้ หรือลายน้ำในภาพ/g, 'ห้ามมีโลโก้หรือลายน้ำในภาพ (ตัวหนังสือใส่ได้เฉพาะหัวข้อตามที่กำหนดด้านล่าง)');
    const planPrompt =
      planBase +
      '\n\n' +
      planExtras({
        style,
        variation,
        humanGuide: settings.humanGuide,
        avoid: history.map((h) => h.summary),
        companion: companionCands ? companionPromptBlock(companionCands) : '',
        text,
      });
    const planTimeout = settings.planTimeoutSec * 1000;
    let r = await askChat(chat, { prompt: planPrompt, images: p.images, expectJson: true, timeout: planTimeout });
    let plan = parsePlan(r.text);
    if (!plan) {
      log('คำตอบไม่ใช่ JSON กำลังขอใหม่...', 'warn');
      r = await askChat(chat, {
        prompt: "กรุณาตอบกลับเป็น JSON ตามรูปแบบที่กำหนดเท่านั้น ใส่ในกล่องโค้ด ```json ห้ามใช้เครื่องหมาย \" ภายในข้อความ (ใช้ ' แทน)",
        expectJson: true,
        timeout: planTimeout,
      });
      plan = parsePlan(r.text);
    }
    if (!plan) throw new Error('อ่านแผนจาก ChatGPT ไม่ได้ (ไม่ใช่ JSON)');
    plan.scenes = plan.scenes.slice(0, p.scenes);
    // ชุดคู่จากเว็บร้าน: ดาวน์โหลดรูปของสีที่ ChatGPT เลือกเก็บไว้ ใช้แนบตอนสร้างภาพทุกฉาก
    prog.companion = companionCands ? await resolveCompanion(plan.companion, companionCands, p) : null;
    await downloadText(buildScript(p, plan, plan.scenes, prog.companion), folder, 'script.txt');
    prog.plan = plan;
    await addClipHistory(p.name, {
      styleId: style.id,
      variation,
      summary: `[${style.label}] ${plan.scenes[0]?.script_th || ''} / แคปชัน: ${(plan.caption || '').slice(0, 60)}`,
    });
    await saveQueue();
    log(`ได้แผน ${plan.scenes.length} ฉาก บันทึก script.txt แล้ว`, 'ok');
  }
  const scenes = prog.plan.scenes;

  // 2) ChatGPT: สร้างภาพเฟรมแรกของแต่ละฉาก (ทำต่อในแชตเดิม ถ้าเปิดค้างไว้)
  // สร้างเฉพาะฉากที่ยังไม่มีภาพ หรือฉากที่ผู้ใช้สั่งสร้างภาพใหม่ (ปุ่ม 🖼 ในคิว)
  prog.redoFrame ||= [];
  let attachedThisRun = planThisRun;
  let companionSent = false;
  // สร้างภาพเฟรมแรกของฉาก i (extra = คำสั่งเพิ่ม เช่น ตอน Flow ปฏิเสธเพราะหน้าคล้ายคนดัง)
  const makeFrame = async (i, extra = '') => {
    checkAbort();
    if (!chat) await openChat(false);
    const nn = pad(i + 1);
    const redo = !!prog.frames[i]?.dataUrl;
    log(`ChatGPT: กำลังสร้างภาพ${redo ? 'ใหม่' : ''}ฉากที่ ${i + 1}/${scenes.length}...`);
    // ทำต่อในแชตอื่น (เช่น สร้างภาพใหม่ภายหลัง): ChatGPT ไม่เห็นฉากอื่นของคลิปนี้
    // จึงแนบภาพฉากอื่น (ไม่เกิน 2 ภาพ ใกล้ที่สุด) เป็นต้นแบบผู้นำเสนอ/สีผ้า + รูปสินค้าจริงไว้ดูลายผ้า
    let images;
    let prompt = fillTemplate(settings.imageTemplate, {
      index: i + 1,
      total: scenes.length,
      image_prompt: scenes[i].image_prompt,
    });
    // สร้างใหม่หลัง Flow ปฏิเสธ (extra): แนบภาพฉากอื่นเสมอ ให้ได้ผู้นำเสนอคนเดิม
    if (!attachedThisRun || extra) {
      const refs = prog.frames
        .map((f, j) => ({ f, j }))
        .filter(({ f, j }) => j !== i && f?.dataUrl && !prog.redoFrame[j])
        .sort((a, b) => Math.abs(a.j - i) - Math.abs(b.j - i))
        .slice(0, 2)
        .map(({ f }) => f.dataUrl);
      // แชตเดิมเห็นรูปสินค้าแล้ว: แนบแค่ภาพฉากอื่น
      images = attachedThisRun ? refs : [...refs, ...p.images].slice(0, 10);
      if (refs.length) {
        prompt +=
          `\n\nรูปที่แนบ ${refs.length} รูปแรกคือภาพจากฉากอื่นของคลิปเดียวกัน: ผู้นำเสนอในภาพใหม่ต้องเป็นคนเดียวกันทุกอย่าง ` +
          '(ใบหน้า ทรงผม อายุ เสื้อผ้า) ฉากหลัง แสง และสี/ลายของสินค้าต้องเหมือนภาพเหล่านี้ ' +
          (images.length > refs.length ? 'รูปที่เหลือคือรูปสินค้าจริง ใช้ดูรายละเอียดลายผ้าเท่านั้น' : '');
      }
    }
    // ชุดคู่จากเว็บร้าน: แนบรูปครั้งแรกของรอบนี้ แล้วย้ำแบบ/สีทุกฉาก
    const comp = prog.companion;
    if (comp) {
      if (comp.image && !companionSent) {
        images = [...(images || []).slice(0, 9), comp.image];
        prompt += `\n\nรูปสุดท้ายที่แนบคือ${comp.label}ชุดคู่จากร้าน "${comp.name}" สี${comp.color}`;
        companionSent = true;
      }
      prompt += `\nผู้นำเสนอสวม${comp.label} "${comp.name}" สี${comp.color} ตามรูปชุดคู่ (แบบ ลาย สีเดิม) คู่กับสินค้าหลักทุกฉาก`;
    }
    // หัวข้อภาษาไทยในภาพ (แบบโปสเตอร์โฆษณา)
    const headline = prog.textBaked && scenes[i].headline_th;
    if (headline) prompt = prompt.replace(/ไม่มีตัวหนังสือหรือโลโก้/g, 'ไม่มีโลโก้') + imageTextRule(headline);
    // ใช้ทุกฉาก: รูปสินค้าบางรูปเป็นโปสเตอร์ที่มีตัวหนังสือ นางแบบคนอื่น หรือสีอื่น ห้ามคัดลอกมา
    prompt +=
      '\nห้ามคัดลอกตัวหนังสือ กราฟิก ป้าย ตาราง หรือคนจากรูปสินค้าที่แนบ ใช้ผู้นำเสนอคนเดียวกันทุกฉาก ' +
      'และใช้สี/ลายผ้าเดียวกันทุกฉาก (ถ้ารูปสินค้ามีหลายสี ให้ใช้สีเดียวกับฉากก่อนหน้า)';
    if (extra) prompt += `\n\n${extra}`;
    const res = await askChat(chat, {
      prompt,
      images,
      wantImage: true,
      timeout: settings.imageTimeoutSec * 1000,
    });
    attachedThisRun = true;
    const dataUrl = res.image?.dataUrl || (res.image?.url ? await fetchAsDataUrl(res.image.url) : null);
    if (!dataUrl) throw new Error(`ไม่ได้ภาพของฉากที่ ${i + 1}`);
    const name = `scene-${nn}.${imageExt(dataUrl)}`;
    // ภาพเก็บที่ <โฟลเดอร์หลัก>\GenPic\<ชื่อสินค้า>\ ถ้าเลือกโฟลเดอร์หลักไว้ ไม่งั้นเก็บใน Downloads/GenClip/<โฟลเดอร์สินค้า>/
    const savedPath = await saveToRoot([settings.picFolder || GC_DEFAULTS.picFolder, p.name], await (await fetch(dataUrl)).blob(), name);
    if (!savedPath) await download(dataUrl, folder, name);
    prog.frames[i] = { dataUrl, name };
    prog.redoFrame[i] = false;
    // ภาพใหม่ = ต้องทำวิดีโอฉากนี้ใหม่ด้วย
    if (prog.videoDone) prog.videoDone[i] = false;
    prog.videosDone = (prog.videoDone || []).filter(Boolean).length;
    await saveQueue();
    log(`บันทึก ${savedPath || name} แล้ว`, 'ok');
  };
  for (let i = 0; i < scenes.length; i++) {
    if (prog.frames[i]?.dataUrl && !prog.redoFrame[i]) continue;
    await makeFrame(i);
  }

  if (skipVideo) {
    log('ข้ามขั้นสร้างวิดีโอตามที่ตั้งไว้', 'warn');
    return;
  }

  // 3) Flow: สร้างวิดีโอจากภาพเฟรมแรก + video prompt
  const flow = await getSiteTab('flow');
  await activate(flow);
  await waitComplete(flow.id);
  // ฉากที่ล้มเหลวจะข้ามไปฉากถัดไปก่อน แล้วกด ↻ เพื่อลองเฉพาะฉากที่ยังไม่เสร็จได้
  prog.videoDone ||= scenes.map((_, i) => i < (prog.videosDone || 0));
  const failed = [];
  for (let i = 0; i < scenes.length; i++) {
    if (prog.videoDone[i]) continue;
    checkAbort();
    const nn = pad(i + 1);
    let frame = prog.frames[i];
    log(`Flow: กำลังสร้างวิดีโอฉากที่ ${i + 1}/${scenes.length}...`);
    // ลบไฟล์เก่าของฉากนี้ที่เก็บไว้ (ถ้าทำใหม่) ไม่งั้นตอนรวมคลิปอาจได้วิดีโอเก่า
    await ClipStore.put(p.id, i, null);
    await ClipStore.put(p.id, 'final', null);
    await setFlowFileHook(flow.id, frame);
    let renamedFile = null;
    const renamed = expectFlowDownload(folder, `scene-${nn}`).then((f) => (renamedFile = f));
    let stored = false;
    // เก็บไฟล์ของฉากไว้ใน ClipStore เพื่อรวมคลิปอัตโนมัติ (ดึงไม่ได้ก็ไม่เป็นไร ใช้ปุ่มรวมคลิปเองได้)
    const keepClip = async (url) => {
      const blob = await fetchVideoBlob(url, flow.id, i + 1);
      if (blob) {
        await ClipStore.put(p.id, i, blob);
        stored = true;
      }
    };
    // Flow ล้มเหลวบ่อยช่วงคนใช้เยอะ: ส่งคำสั่งใหม่อัตโนมัติ (ตามจำนวนในหน้าตั้งค่า) ก่อนข้ามไปฉากถัดไป
    let res = null;
    // ช่วง Flow มีผู้ใช้งานสูง: ส่งใหม่ได้เพิ่มอีก 2 ครั้ง และเว้นนานขึ้นเรื่อย ๆ (1, 2, 4, 8 นาที) ให้คิวของ Flow ว่างก่อน
    let retries = Math.max(0, parseInt(settings.flowRetries, 10) || 0);
    let busyFails = 0;
    let policyFails = 0;
    let faceRedone = false;
    // ระดับ prompt: 0 = prompt เต็มจาก ChatGPT, 1 = prompt ปลอดภัยแบบสั้น, 2 = แบบสั้นไม่มีบทพูด
    let promptLevel = 0;
    const videoPrompt = () =>
      promptLevel === 0
        ? cleanVideoPrompt(
            [settings.videoPrefix, scenes[i].video_prompt, prog.textBaked && scenes[i].headline_th && VIDEO_TEXT_RULE, settings.videoSuffix]
              .filter(Boolean)
              .join(' ')
          )
        : safeVideoPrompt(scenes[i], { speech: promptLevel === 1, textBaked: prog.textBaked && !!scenes[i].headline_th });
    for (let attempt = 0; attempt <= retries && !res; attempt++) {
      if (attempt) {
        const wait = busyFails ? Math.min(8, 2 ** (busyFails - 1)) * 60000 : 10000;
        log(
          `ฉากที่ ${i + 1}: Flow สร้างไม่สำเร็จ${busyFails ? ' (ผู้ใช้งานสูง)' : ''} ` +
            `จะส่งใหม่ครั้งที่ ${attempt}/${retries} ใน ${wait >= 60000 ? `${wait / 60000} นาที` : `${wait / 1000} วินาที`}...`,
          'warn'
        );
        // รอแบบกดหยุดได้ทันที
        for (const end = Date.now() + wait; Date.now() < end && !aborted; ) await sleep(1000);
        checkAbort();
        await setFlowFileHook(flow.id, frame);
      }
      try {
        res = await call(flow, 'flow', 'flow:video', {
          imageDataUrl: frame.dataUrl,
          fileName: frame.name,
          prompt: videoPrompt(),
          hint: `GenClip/${folder}/${frame.name}`,
          timeout: settings.videoTimeoutSec * 1000,
          approveMode: settings.flowApproveMode,
          model: settings.flowModel,
        });
      } catch (e) {
        if (aborted || e.message === 'ABORTED') {
          await setFlowFileHook(flow.id, null);
          throw e;
        }
        // ส่งใหม่เฉพาะกรณี Flow แจ้งล้มเหลว (ไม่ใช่กรณีอื่น เช่น หาช่องพิมพ์ไม่เจอ)
        const retryable = /สร้างวิดีโอไม่สำเร็จ|ปฏิเสธ/.test(e.message);
        const busy = /\[busy\]/.test(e.message);
        if (busy && ++busyFails === 1) retries += 2;
        // Flow ปฏิเสธเรื่องบุคคลที่มีชื่อเสียง: มักเกิดจากถ้อยคำใน prompt ของฉากนั้น (ฉากอื่นหน้าเดียวกันผ่าน)
        //   ครั้งที่ 1 → ส่งใหม่ด้วย prompt ปลอดภัยแบบสั้น (ภาพเดิม), ครั้งที่ 2 → แบบสั้นไม่มีบทพูด,
        //   ครั้งที่ 3 → ให้ ChatGPT สร้างภาพใหม่ (ผู้นำเสนอคนเดิม เปลี่ยนท่า/มุมกล้อง)
        const policy = /\[policy\]/.test(e.message);
        if (policy) policyFails++;
        if (policy && policyFails <= 2) {
          promptLevel = policyFails;
          retries = Math.max(retries, attempt + 1);
          log(
            `ฉากที่ ${i + 1}: Flow ปฏิเสธ prompt (เรื่องบุคคลที่มีชื่อเสียง) จะส่งใหม่ด้วย prompt แบบสั้นที่ปลอดภัยกว่า` +
              (promptLevel === 2 ? ' (ไม่มีบทพูด)' : ' (ภาพเดิม)'),
            'warn'
          );
          continue;
        }
        if (policy && !faceRedone) {
          faceRedone = true;
          log(`ฉากที่ ${i + 1}: Flow ปฏิเสธซ้ำเพราะหน้าผู้นำเสนออาจคล้ายคนมีชื่อเสียง กำลังให้ ChatGPT สร้างภาพใหม่ (ผู้นำเสนอคนเดิม เปลี่ยนท่าและมุมกล้อง)...`, 'warn');
          try {
            await makeFrame(i, POLICY_FACE_FIX);
            frame = prog.frames[i];
            await activate(flow);
            promptLevel = 1;
            retries = Math.max(retries, attempt + 2);
            continue;
          } catch (err) {
            if (aborted || err.message === 'ABORTED') throw err;
            log(`ฉากที่ ${i + 1}: สร้างภาพใหม่ไม่สำเร็จ: ${err.message}`, 'error');
          }
        }
        if (!retryable || attempt === retries) {
          failed.push(i + 1);
          log(`✖ ฉากที่ ${i + 1}: ${e.message} (ข้ามไปฉากถัดไป)`, 'error');
          // Flow ล้มเหลวซ้ำทุกรอบ = มักเป็นที่ภาพเฟรมแรก: ตั้งฉากนี้เป็น 🖼 ให้เอง กด ↻ แล้วจะสร้างภาพใหม่ + วิดีโอใหม่
          if (busy) {
            log(`ฉากที่ ${i + 1}: Flow มีผู้ใช้งานสูง ลองกด ↻ ใหม่ภายหลัง (ภาพเดิมใช้ได้ ไม่ต้องสร้างใหม่)`, 'warn');
          } else if (retryable) {
            prog.redoFrame ||= [];
            prog.redoFrame[i] = true;
            await saveQueue();
            log(`ฉากที่ ${i + 1}: ตั้งเป็น 🖼 (สร้างภาพใหม่) ให้แล้ว กด ↻ เพื่อสร้างภาพและวิดีโอฉากนี้ใหม่`, 'warn');
          }
          break;
        }
      }
    }
    await setFlowFileHook(flow.id, null);
    if (!res) continue;
    const videos = res.videos || [];
    for (let j = 0; j < videos.length; j++) {
      if (videos[j].clicked) {
        // ระบบกดปุ่มดาวน์โหลดของ Flow แล้ว รอเบราว์เซอร์เริ่มดาวน์โหลด (ตั้งชื่อไฟล์ให้ใน onDeterminingFilename)
        await Promise.race([renamed, sleep(30000)]);
        if (renamedFile) {
          log(`บันทึก ${renamedFile.file} แล้ว (ดาวน์โหลดผ่าน Flow)`, 'ok');
          if (!stored) await keepClip(renamedFile.url);
        } else log(`ฉากที่ ${i + 1}: กดดาวน์โหลดใน Flow แล้วแต่ไม่เห็นไฟล์เริ่มดาวน์โหลด`, 'warn');
        continue;
      }
      const name = `scene-${nn}${j ? '-' + String.fromCharCode(97 + j) : ''}.mp4`;
      const url = videos[j].dataUrl || videos[j].url;
      await download(url, folder, name);
      log(`บันทึก ${name} แล้ว`, 'ok');
      if (j === 0) await keepClip(url);
    }
    if (!videos.length && renamedFile) {
      log(`บันทึก ${renamedFile.file} แล้ว (ไฟล์ที่ดาวน์โหลดเอง)`, 'ok');
      await keepClip(renamedFile.url);
    } else if (!videos.length) log(`ฉากที่ ${i + 1}: ไม่ได้ดาวน์โหลดวิดีโออัตโนมัติ`, 'warn');
    // ดึงจากลิงก์ไม่ได้: ตอนรวมคลิปจะอ่านจากไฟล์ที่ดาวน์โหลดลงเครื่องแทน (ไม่ต้องแจ้งเตือนตรงนี้)
    pendingRename = null;
    prog.videoDone[i] = true;
    prog.videosDone = prog.videoDone.filter(Boolean).length;
    await saveQueue();
    if (i < scenes.length - 1 && settings.sceneDelaySec) await sleep(settings.sceneDelaySec * 1000);
  }
  pendingRename = null;
  if (failed.length) throw new Error(`วิดีโอฉากที่ ${failed.join(', ')} ไม่สำเร็จ กด ↻ เพื่อลองเฉพาะฉากที่เหลือ`);

  // ครบทุกฉากแล้ว: รวมคลิปอัตโนมัติ แล้วเตรียมโพสต์ TikTok (ถ้าไม่สำเร็จ งานสินค้ายังถือว่าเสร็จ)
  try {
    await mergeProduct(p);
  } catch (e) {
    log(`รวมคลิปไม่สำเร็จ: ${e.message}`, 'error');
  }
  if (settings.autoTikTok === 'on' && !p.tiktokPostedAt && (await ClipStore.get(p.id, 'final'))) {
    try {
      await prepareTikTok(p);
    } catch (e) {
      if (aborted || e.message === 'ABORTED') throw e;
      log(`TikTok: เตรียมโพสต์ไม่สำเร็จ: ${e.message}`, 'error');
    }
  }
  // โพสต์ Reels ลงเพจ Facebook (ทำต่อแม้ TikTok ไม่สำเร็จ)
  if (settings.autoFacebook === 'on' && !p.fbPostedAt && (await ClipStore.get(p.id, 'final'))) {
    try {
      await prepareFacebook(p);
    } catch (e) {
      if (aborted || e.message === 'ABORTED') throw e;
      log(`Facebook: เตรียมโพสต์ไม่สำเร็จ: ${e.message}`, 'error');
    }
  }
}

// ราคาของสินค้า: ช่องราคา หรือ "ราคา 199 บาท" ในรายละเอียด (ที่ดึงจาก TikTok)
function productPrice(p) {
  if (p.price) return String(p.price).trim();
  const m = (p.details || '').match(/ราคา\s*:?\s*([\d,]+(?:\.\d+)?(?:\s*[-–\/]\s*[\d,]+(?:\.\d+)?)?)/);
  return m ? m[1].replace(/,/g, '').replace(/\s+/g, ' ') : '';
}

// ตัวหนังสือที่ระบบเขียนทับตอนรวมคลิป (null = ปิด)
function overlaySpec(p, settings) {
  if (settings.textOverlay === 'off') return null;
  const scenes = p.progress?.plan?.scenes || [];
  return {
    // หัวข้อแต่ละฉาก: ใส่เฉพาะคลิปที่ไม่ได้ให้ ChatGPT วาดหัวข้อลงในภาพแล้ว
    headlines: p.progress?.textBaked ? null : scenes.map((s) => (s.headline_th || '').trim()),
    price: productPrice(p),
    promo: (p.promo || '').trim(),
    cta: (settings.ctaText ?? GC_DEFAULTS.ctaText).trim(),
    url: (settings.shopUrlText ?? GC_DEFAULTS.shopUrlText).trim(),
  };
}

// รวมคลิปของสินค้าจากไฟล์ที่เก็บไว้ (ใช้ทั้งตอนจบงานและปุ่ม 🎬 ในคิว)
async function mergeProduct(p) {
  const n = p.progress?.plan?.scenes.length || 0;
  const blobs = await Promise.all([...Array(n)].map((_, i) => ClipStore.get(p.id, i)));
  // ฉากที่ยังไม่มีไฟล์เก็บไว้: อ่านจากไฟล์ที่ดาวน์โหลดลงเครื่องแล้ว (Downloads/GenClip/<โฟลเดอร์>/scene-NN.mp4)
  if (n && blobs.some((b) => !b)) {
    for (let i = 0; i < n; i++) {
      if (blobs[i]) continue;
      blobs[i] = await blobFromDownloads(p.progress.folder, `scene-${pad(i + 1)}`);
      if (blobs[i]) await ClipStore.put(p.id, i, blobs[i]);
    }
  }
  const missing = blobs.map((b, i) => (b ? null : i + 1)).filter(Boolean);
  if (!n || missing.length) {
    log(
      `รวมคลิปอัตโนมัติไม่ได้: ไม่มีไฟล์ของฉากที่ ${missing.join(', ') || '-'} ` +
        `กด 🎬 ที่สินค้านี้ในคิว แล้วเลือกไฟล์วิดีโอของสินค้านี้ ระบบจะเก็บไว้และรวมให้`,
      'warn'
    );
    return;
  }
  const { blob } = await mergeAndSave(blobs, p.progress.folder, overlaySpec(p, await loadSettings()));
  await ClipStore.put(p.id, 'final', blob);
}

// อ่านไฟล์วิดีโอที่ดาวน์โหลดลงเครื่องแล้วกลับมา (ใช้ประวัติดาวน์โหลดหาตำแหน่งไฟล์ แล้วเปิดผ่าน file://)
// ต้องเปิด "อนุญาตให้เข้าถึง URL ของไฟล์" ของ GenClip ใน chrome://extensions ก่อน
let warnedFileAccess = false;
async function blobFromDownloads(folder, baseName) {
  if (!(await chrome.extension.isAllowedFileSchemeAccess())) {
    if (!warnedFileAccess) {
      warnedFileAccess = true;
      log(
        'รวมคลิปอัตโนมัติต้องอ่านไฟล์วิดีโอที่ดาวน์โหลดไว้: เปิด chrome://extensions → GenClip → รายละเอียด → ' +
          'เปิดสวิตช์ "อนุญาตให้เข้าถึง URL ของไฟล์" (ทำครั้งเดียว) แล้วกด 🎬 อีกครั้ง',
        'warn'
      );
    }
    return null;
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ชื่อไฟล์อาจเป็น scene-01.mp4 หรือ scene-01 (1).mp4 (ถ้าดาวน์โหลดซ้ำ) ในโฟลเดอร์ของสินค้า
  const filenameRegex = `${esc(folder)}[\\\\/]${esc(baseName)}( \\(\\d+\\))?\\.(mp4|webm|mov)$`;
  const deadline = Date.now() + 120000;
  for (;;) {
    const items = await chrome.downloads.search({ filenameRegex, orderBy: ['-startTime'] });
    const done = items.find((it) => it.state === 'complete' && it.exists !== false);
    if (done) {
      try {
        const url = 'file:///' + encodeURI(done.filename.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
        const res = await fetch(url);
        if (res.ok) return await res.blob();
        log(`อ่านไฟล์ ${done.filename} ไม่ได้ (HTTP ${res.status})`, 'warn');
      } catch (e) {
        log(`อ่านไฟล์ ${done.filename} ไม่ได้ (${e.message})`, 'warn');
      }
      return null;
    }
    // ยังดาวน์โหลดไม่เสร็จ: รอ (สูงสุด 2 นาที) ถ้าไม่เคยดาวน์โหลดเลยก็เลิก
    if (!items.some((it) => it.state === 'in_progress') || Date.now() > deadline) return null;
    await sleep(2000);
  }
}

// ให้หน้า Flow ดึงไฟล์เอง (ใช้คุกกี้/สิทธิ์ของหน้า Flow และเปิด blob: URL ของหน้านั้นได้)
async function blobFromTab(tabId, url) {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'flow:fetchBlob', payload: { url } });
  if (!res?.ok) throw new Error(res?.error || 'หน้า Flow ไม่ตอบ');
  return (await fetch(res.data)).blob();
}

// ดึงไฟล์วิดีโอมาเก็บ ลองหลายวิธี ถ้าไม่ได้ทุกวิธีจะบอกเหตุผลของแต่ละวิธีใน log
async function fetchVideoBlob(url, flowTabId, sceneNo) {
  if (url.startsWith('data:')) return (await fetch(url)).blob();
  const reasons = [];
  const attempt = async (label, fn) => {
    try {
      const blob = await fn();
      // หน้า error / หน้า login จะได้ HTML หรือไฟล์เล็กมาแทนวิดีโอ
      if (blob && blob.size > 20000 && !/html|json|text/.test(blob.type)) return blob;
      reasons.push(`${label}: ได้ ${blob ? `${blob.type || 'ไม่ทราบชนิด'} ${blob.size} ไบต์` : 'ไฟล์ว่าง'}`);
    } catch (e) {
      reasons.push(`${label}: ${e.message}`);
    }
    return null;
  };
  const viaPanel = (credentials) => async () => {
    const res = await fetch(url, { credentials });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  };
  const blob =
    (!url.startsWith('blob:') && (await attempt('ดึงพร้อมคุกกี้', viaPanel('include')))) ||
    (!url.startsWith('blob:') && (await attempt('ดึงไม่ใช้คุกกี้', viaPanel('omit')))) ||
    (await attempt('ดึงจากหน้า Flow', () => blobFromTab(flowTabId, url)));
  // ไม่เป็นไร: ตอนรวมคลิปจะอ่านจากไฟล์ที่ดาวน์โหลดลงเครื่องแทน
  if (!blob) console.warn(`ฉากที่ ${sceneNo}: ดึงไฟล์วิดีโอจากลิงก์ไม่ได้ (${url.slice(0, 70)}…) · ${reasons.join(' | ')}`);
  return blob || null;
}

async function fetchBlob(url) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

// บันทึกลงโฟลเดอร์หลักที่ผู้ใช้เลือก (เช่น D:\ClipGen\<subdirs>\<name>) คืนพาธที่บันทึก หรือ null ถ้าทำไม่ได้
// (ถ้าคืน null ผู้เรียกจะบันทึกใน Downloads แทน)
// แจ้งเหตุผลครั้งเดียวต่อรอบการทำงาน (ภาพหลายฉากจะได้ไม่ขึ้นข้อความซ้ำ) แต่การรวมคลิปแจ้งทุกครั้ง
let warnedNoPermission = false;
async function saveToRoot(subdirs, blob, name, { alwaysWarn = false } = {}) {
  const root = await RootFolder.ready(navigator.userActivation?.isActive).catch(() => null);
  if (!root) {
    if (alwaysWarn || !warnedNoPermission) {
      warnedNoPermission = true;
      const chosen = await RootFolder.get().catch(() => null);
      log(
        chosen
          ? `ยังไม่ได้รับอนุญาตให้เขียนโฟลเดอร์ "${chosen.name}" ในรอบนี้ จึงบันทึกใน Downloads แทน (กด 📁 เพื่ออนุญาต)`
          : 'ยังไม่ได้เลือกโฟลเดอร์หลัก จึงบันทึกใน Downloads แทน (กด 📁 แล้วเลือก D:\\ClipGen)',
        'warn'
      );
    }
    return null;
  }
  try {
    return await RootFolder.save(root, subdirs.map(safeName), blob, name);
  } catch (e) {
    log(`บันทึกลงโฟลเดอร์ ${root.name} ไม่สำเร็จ (${e.message}) จะบันทึกใน Downloads แทน`, 'warn');
    return null;
  }
}

async function mergeAndSave(blobs, folder, overlay = null) {
  const { finalFolder, clipSpeed, mergeResolution } = await loadSettings();
  const resolution = parseInt(mergeResolution, 10) || 0;
  const speed = Math.min(2, Math.max(0.5, parseFloat(clipSpeed) || 1));
  log(`กำลังรวม ${blobs.length} คลิป${speed !== 1 ? ` ที่ความเร็ว ${speed} เท่า` : ''}${overlay ? ' พร้อมใส่ตัวหนังสือ' : ''} (ห้ามปิดแผงนี้)...`);
  const { blob, ext } = await mergeClips(blobs, (i, n) => log(`รวมคลิป: กำลังเล่นคลิปที่ ${i + 1}/${n}`), { speed, overlay, resolution });
  const dir = safeName(finalFolder || GC_DEFAULTS.finalFolder);

  // 1) โฟลเดอร์หลักที่ผู้ใช้เลือก: <หลัก>\ClipFinal\<สินค้า>_<วันเวลา>.mp4
  const saved = await saveToRoot([dir], blob, `${folder}.${ext}`, { alwaysWarn: true });
  if (saved) {
    log(`✔ รวมคลิปเสร็จ บันทึกที่ ${saved}`, 'ok');
    return { blob, ext };
  }

  // 2) สำรอง: Downloads/ClipFinal/
  const filename = `${dir}/${folder}.${ext}`;
  const url = URL.createObjectURL(blob);
  try {
    await downloadAs(url, filename);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  log(`✔ รวมคลิปเสร็จ บันทึกที่ Downloads/${filename}`, 'ok');
  return { blob, ext };
}

// ---------- โพสต์ TikTok (กึ่งอัตโนมัติ: ระบบเตรียมให้ ผู้ใช้กดโพสต์เอง) ----------

// ส่งไฟล์ใหญ่ไปที่หน้าเว็บทีละ 3 MB
async function sendFileToTab(tabId, blob) {
  const id = crypto.randomUUID();
  const size = 3 * 1024 * 1024;
  const total = Math.ceil(blob.size / size);
  for (let index = 0; index < total; index++) {
    checkAbort();
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob.slice(index * size, (index + 1) * size));
    });
    const res = await chrome.tabs.sendMessage(tabId, { type: 'gc:chunk', payload: { id, index, total, b64: dataUrl.split(',')[1] } });
    if (!res?.ok) throw new Error('ส่งไฟล์ไปที่หน้าเว็บไม่สำเร็จ');
  }
  return id;
}

function buildCaption(p) {
  const plan = p.progress?.plan;
  const tags = (plan?.hashtags || []).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  return [plan?.caption || p.name, tags].filter(Boolean).join('\n\n');
}

async function prepareTikTok(p) {
  let final = await ClipStore.get(p.id, 'final');
  if (!final) {
    await mergeProduct(p);
    final = await ClipStore.get(p.id, 'final');
  }
  if (!final) return log('TikTok: ยังไม่มีคลิปที่รวมแล้วของสินค้านี้ จึงเตรียมโพสต์ไม่ได้', 'warn');

  log('TikTok: กำลังเปิดหน้าอัปโหลด...');
  // เปิดแท็บใหม่ทุกครั้ง เพื่อไม่ทับโพสต์ที่ยังไม่ได้กดโพสต์
  const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = await chrome.tabs.create({ url: SITES.tiktok.home, active: true, windowId: cur?.windowId });
  await waitComplete(tab.id);
  await ensureContent(tab.id, 'tiktok');
  const ext = final.type.includes('webm') ? 'webm' : 'mp4';
  const fileId = await sendFileToTab(tab.id, final);
  // เวลาโพสต์: ทันที / ตามช่วงเวลาที่กำหนด / สุ่ม (เว้นระยะจากคลิปอื่นที่ตั้งเวลาไว้แล้ว)
  const settings = await loadSettings();
  const { postSchedule = [] } = await chrome.storage.local.get('postSchedule');
  const when = pickPostTime(settings, postSchedule);
  if ((settings.postTiming === 'fixed' || settings.postTiming === 'random') && !when) {
    log('TikTok: หาเวลาโพสต์ที่ว่างไม่ได้ (เต็มทุกช่วงใน 9 วัน) จะหยุดให้ตั้งเวลาเอง', 'warn');
  }
  if (settings.postTiming === 'interval') {
    const last = postSchedule.map((t) => new Date(t)).sort((a, b) => b - a)[0];
    log(
      `TikTok: คลิปล่าสุด ${last ? last.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '(ยังไม่มี)'} → ` +
        (when ? `ตั้งเวลาโพสต์ ${when.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}` : 'โพสต์ทันที')
    );
  }
  const schedule = when
    ? { y: when.getFullYear(), mo: when.getMonth() + 1, d: when.getDate(), h: when.getHours(), mi: when.getMinutes() }
    : undefined;
  const r = await call(tab, 'tiktok', 'tiktok:prepare', {
    schedule,
    fileId,
    name: `${p.progress.folder}.${ext}`,
    type: final.type || 'video/mp4',
    caption: buildCaption(p),
    // ปักตะกร้า: ค้นด้วยรหัสสินค้า TikTok Shop ถ้ามี ไม่งั้นค้นจากชื่อสินค้า
    productId: p.productId || '',
    productName: p.name,
    // โพสต์อัตโนมัติเมื่อผ่านครบ (ตั้งค่าได้ในหน้าตั้งค่า ค่าเริ่มต้นปิด)
    autoPost: settings.autoPostTikTok === 'on',
  });
  // บันทึกเวลาโพสต์ (ตั้งเวลาไว้ หรือโพสต์ทันที) ใช้เว้นระยะคลิปถัดไป และให้โหมดสุ่มระยะรู้ว่าคลิปล่าสุดคือเมื่อไร
  const postedAt = r.scheduledAt && when ? when : r.posted && !schedule ? new Date() : null;
  if (postedAt) {
    const history = [...postSchedule, postedAt.toISOString()].sort().slice(-100);
    await chrome.storage.local.set({ postSchedule: history });
  }
  if (r.posted) {
    p.tiktokPostedAt = (postedAt || new Date()).toISOString();
    await saveQueue();
  }
  const summary =
    `แคปชัน ${r.captionOk ? '✓' : '✗'} · ป้าย AI ${r.aiOk ? '✓' : '✗'} · ` +
    `ตะกร้า ${r.cartOk ? '✓' : `✗${r.cartError ? ` ${r.cartError}` : ''}`} · อัปโหลดเสร็จ ${r.postReady ? '✓' : 'ยังไม่เสร็จ'}` +
    (schedule ? ` · เวลาโพสต์ ${r.scheduledAt || `✗ ${r.scheduleError || ''}`}` : '');
  if (r.posted) log(`✔ TikTok: ${schedule ? `ตั้งเวลาโพสต์แล้ว ${r.scheduledAt}` : 'โพสต์แล้ว'} (${summary})`, 'ok');
  else
    log(
      `TikTok: เตรียมโพสต์แล้ว (${summary})${r.postError ? ` · ${r.postError}` : ''} ตรวจแล้วกด "โพสต์" เองในแท็บ TikTok`,
      r.aiOk && r.captionOk && r.cartOk ? 'ok' : 'warn'
    );
}

// ---------- โพสต์ Reels ลงเพจ Facebook (Meta Business Suite) ----------

// ค่าตั้งเวลาของเพจ (แยกจาก TikTok) แปลงเป็นชื่อเดียวกับของ TikTok เพื่อใช้ pickPostTime ร่วมกัน
const fbTimingSettings = (s) => ({
  postTiming: s.fbPostTiming,
  postFixedTimes: s.fbFixedTimes,
  postRandomStart: s.fbRandomStart,
  postRandomEnd: s.fbRandomEnd,
  postMinGapMin: s.fbMinGapMin,
  postIntervalMin: s.fbIntervalMin,
  postIntervalMax: s.fbIntervalMax,
});

async function prepareFacebook(p) {
  let final = await ClipStore.get(p.id, 'final');
  if (!final) {
    await mergeProduct(p);
    final = await ClipStore.get(p.id, 'final');
  }
  if (!final) return log('Facebook: ยังไม่มีคลิปที่รวมแล้วของสินค้านี้ จึงเตรียมโพสต์ไม่ได้', 'warn');

  const settings = await loadSettings();
  const url = (settings.fbComposerUrl || '').trim() || SITES.facebook.home;
  log('Facebook: กำลังเปิดหน้าสร้างรีลใน Business Suite...');
  const [cur] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = await chrome.tabs.create({ url, active: true, windowId: cur?.windowId });
  await waitComplete(tab.id);
  // ยังไม่ได้ล็อกอิน: Business Suite พาไปหน้าเข้าสู่ระบบ
  const now = await chrome.tabs.get(tab.id);
  if (!/business\.facebook\.com/.test(now.url || '') || /login|checkpoint/.test(now.url || '')) {
    throw new Error('ยังไม่ได้ล็อกอิน Facebook / Business Suite ในเบราว์เซอร์นี้ กรุณาล็อกอินแล้วกด 📘 อีกครั้ง');
  }
  await ensureContent(tab.id, 'facebook');
  await chrome.scripting
    .executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: installPageFileHook })
    .catch((e) => log(`Facebook: ติดตั้งตัวช่วยแนบไฟล์ไม่สำเร็จ: ${e.message}`, 'warn'));
  const ext = final.type.includes('webm') ? 'webm' : 'mp4';
  const fileId = await sendFileToTab(tab.id, final);

  // เวลาโพสต์ของเพจ (สุ่มแยกจาก TikTok ตามค่าในหน้าตั้งค่า)
  const timing = fbTimingSettings(settings);
  const { fbSchedule = [] } = await chrome.storage.local.get('fbSchedule');
  const when = pickPostTime(timing, fbSchedule);
  if (timing.postTiming !== 'now' && !when) {
    log(timing.postTiming === 'interval' ? 'Facebook: ถึงเวลาโพสต์แล้ว จะแชร์ทันที' : 'Facebook: หาเวลาโพสต์ที่ว่างไม่ได้ จะแชร์ทันที', 'warn');
  }
  if (when) log(`Facebook: เวลาโพสต์ ${when.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}`);
  const schedule = when
    ? { y: when.getFullYear(), mo: when.getMonth() + 1, d: when.getDate(), h: when.getHours(), mi: when.getMinutes() }
    : undefined;
  const r = await call(tab, 'facebook', 'facebook:prepare', {
    schedule,
    fileId,
    name: `${p.progress.folder}.${ext}`,
    type: final.type || 'video/mp4',
    caption: buildCaption(p),
    autoPost: settings.autoPostFacebook === 'on',
  });
  const postedAt = r.posted ? (schedule ? when : new Date()) : null;
  if (postedAt) {
    const history = [...fbSchedule, postedAt.toISOString()].sort().slice(-100);
    await chrome.storage.local.set({ fbSchedule: history });
    p.fbPostedAt = postedAt.toISOString();
    await saveQueue();
  }
  const summary =
    `คำอธิบาย ${r.captionOk ? '✓' : '✗'} · ป้าย AI ${r.aiOk === null ? '-' : r.aiOk ? '✓' : '✗'} · อัปโหลดเสร็จ ${r.postReady ? '✓' : 'ยังไม่เสร็จ'}` +
    (schedule ? ` · เวลาโพสต์ ${r.scheduledAt || `✗ ${r.scheduleError || ''}`}` : '');
  if (r.posted) log(`✔ Facebook: ${schedule ? `กำหนดเวลาแล้ว ${r.scheduledAt}` : 'แชร์รีลแล้ว'} (${summary})`, 'ok');
  else log(`Facebook: เตรียมรีลแล้ว (${summary})${r.postError ? ` · ${r.postError}` : ''} ตรวจแล้วกดแชร์เองในแท็บ Facebook`, 'warn');
}

// เลือกเวลาโพสต์ TikTok ตามหน้าตั้งค่า คืน Date หรือ null (= โพสต์ทันที)
//   fixed : ช่วงเวลาที่ว่างถัดไปจากรายการ เช่น "11:30, 19:00"
//   random: สุ่มในช่วง เช่น 10:00–21:00 (ปัดเป็นทีละ 5 นาที)
// TikTok ตั้งเวลาได้ล่วงหน้าอย่างน้อย ~15 นาที ไม่เกิน 10 วัน และเว้นระยะจากคลิปอื่นที่จองไว้ตาม postMinGapMin
function pickPostTime(settings, taken, now = new Date()) {
  const mode = settings.postTiming;
  if (mode === 'interval') return pickIntervalTime(settings, taken, now);
  if (mode !== 'fixed' && mode !== 'random') return null;
  const minAhead = 20 * 60e3;
  const maxAhead = 9 * 24 * 3600e3;
  const gap = Math.max(0, Number(settings.postMinGapMin) || 0) * 60e3;
  const busy = taken.map((t) => +new Date(t)).filter((t) => t > +now);
  const ok = (t) => +t >= +now + minAhead && +t <= +now + maxAhead && busy.every((b) => Math.abs(b - t) >= gap);
  const at = (day, hm) => {
    const [h, m] = hm;
    const t = new Date(now);
    t.setDate(t.getDate() + day);
    t.setHours(h, m, 0, 0);
    return t;
  };
  const parseHM = (s) => {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s).trim());
    return m && +m[1] < 24 && +m[2] < 60 ? [+m[1], +m[2]] : null;
  };
  if (mode === 'fixed') {
    const slots = String(settings.postFixedTimes || '')
      .split(/[,\s]+/)
      .map(parseHM)
      .filter(Boolean)
      .sort((a, b) => a[0] * 60 + a[1] - (b[0] * 60 + b[1]));
    for (let day = 0; day < 10; day++) for (const s of slots) if (ok(at(day, s))) return at(day, s);
    return null;
  }
  const start = parseHM(settings.postRandomStart) || [10, 0];
  const end = parseHM(settings.postRandomEnd) || [21, 0];
  const span = end[0] * 60 + end[1] - (start[0] * 60 + start[1]);
  if (span <= 0) return null;
  for (let day = 0; day < 10; day++) {
    for (let k = 0; k < 40; k++) {
      const mins = start[0] * 60 + start[1] + Math.floor((Math.random() * span) / 5) * 5;
      const t = at(day, [Math.floor(mins / 60), mins % 60]);
      if (ok(t)) return t;
    }
  }
  return null;
}

// โหมด "เว้นระยะแบบคนโพสต์เอง": เวลาโพสต์ = คลิปล่าสุด (ที่โพสต์/ตั้งเวลาไว้) + สุ่ม postIntervalMin–postIntervalMax นาที
//   ถ้าเวลานั้นผ่านมาแล้ว = โพสต์ทันที (คืน null) / ยังไม่ถึง = ตั้งเวลา
//   ถ้าตกนอกช่วงที่อนุญาต (postRandomStart–postRandomEnd เช่น 10:00–21:00) เลื่อนไปต้นช่วงถัดไป + สุ่มอีก 0–45 นาที
function pickIntervalTime(settings, taken, now = new Date()) {
  const minGap = Math.max(1, Number(settings.postIntervalMin) || 30);
  const maxGap = Math.max(minGap, Number(settings.postIntervalMax) || 300);
  const parseHM = (s, def) => {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s || '').trim());
    return m ? +m[1] * 60 + +m[2] : def;
  };
  const winStart = parseHM(settings.postRandomStart, 10 * 60);
  const winEnd = parseHM(settings.postRandomEnd, 21 * 60);
  const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();
  const inWindow = (d) => winEnd <= winStart || (minutesOf(d) >= winStart && minutesOf(d) < winEnd);
  // เลื่อนไปต้นช่วงที่อนุญาตครั้งถัดไป แล้วสุ่มเพิ่ม 0–45 นาที ไม่ให้ตรงเวลาเป๊ะทุกวัน
  const nextWindow = (d) => {
    const t = new Date(d);
    if (minutesOf(t) >= winEnd) t.setDate(t.getDate() + 1);
    t.setHours(Math.floor(winStart / 60), winStart % 60 + Math.floor(Math.random() * 10) * 5, 0, 0);
    return t;
  };
  const roundTo5 = (d) => new Date(Math.ceil(+d / 300e3) * 300e3);

  const last = taken.map((t) => +new Date(t)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const gapMin = minGap + Math.floor(Math.random() * (maxGap - minGap + 1));
  let target = last ? new Date(last + gapMin * 60e3) : new Date(+now);

  // ถึงเวลาแล้ว (หรือยังไม่เคยโพสต์) และอยู่ในช่วงที่อนุญาต = โพสต์ทันที
  if (+target <= +now && inWindow(now)) return null;
  if (+target <= +now) target = new Date(+now);
  // TikTok ตั้งเวลาได้ล่วงหน้าอย่างน้อย ~15 นาที
  if (+target < +now + 20 * 60e3) target = new Date(+now + 20 * 60e3);
  if (!inWindow(target)) target = nextWindow(target);
  return roundTo5(target);
}

// ---------- events ----------

$('openOptions').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

$('pImages').onchange = async (e) => {
  const srcs = await Promise.all([...e.target.files].map((f) => fileToDataUrl(f)));
  addToPool(srcs, srcs.length);
  e.target.value = '';
};

$('importBtn').onclick = async () => {
  const btn = $('importBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังดึงข้อมูล...';
  try {
    const p = await importFromActiveTab();
    // ถ้าช่องไหนกรอกไว้แล้วจะไม่ทับ เพื่อให้กดดึงซ้ำหลังสลับแท็บในหน้า Seller Center ได้
    if (!$('pName').value.trim()) $('pName').value = p.name;
    if (p.name) $('pType').value = p.type;
    if (p.productId && !$('pProductId').value.trim()) $('pProductId').value = p.productId;
    if (p.price && !$('pPrice').value.trim()) $('pPrice').value = String(p.price).replace(/[^\d.,\/\s-]/g, '').trim();
    if (!$('pDetails').value.trim()) {
      $('pDetails').value = [p.price && `ราคา ${p.price} บาท`, p.description].filter(Boolean).join('\n');
    }
    const known = new Set(imagePool.map((i) => i.src));
    const fresh = p.images.filter((s) => !known.has(s));
    addToPool(fresh, imagePool.length ? 0 : 3);
    const missing = [!p.name && 'ชื่อ', !p.price && 'ราคา', !p.description && 'รายละเอียด', !fresh.length && 'รูป'].filter(Boolean);
    log(`ดึงสินค้าแล้ว: ${p.name || '(ไม่พบชื่อ)'} · รูป ${fresh.length} รูป`, 'ok');
    if (missing.length) log(`ไม่พบ: ${missing.join(', ')} ลองเลื่อนหน้า/สลับแท็บใน Seller Center แล้วกดดึงอีกครั้ง หรือกรอกเอง`, 'warn');
  } catch (e) {
    log(`ดึงสินค้าไม่สำเร็จ: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'ดึงสินค้าจากแท็บ TikTok ที่เปิดอยู่';
  }
};

$('addBtn').onclick = async () => {
  const name = $('pName').value.trim();
  const pendingImages = selectedImages();
  if (!name) return alert('กรุณาใส่ชื่อสินค้า');
  if (!pendingImages.length) return alert('กรุณาเลือกรูปสินค้าจริงอย่างน้อย 1 รูป');
  queue.push({
    id: crypto.randomUUID(),
    name,
    type: $('pType').value,
    details: $('pDetails').value.trim(),
    price: $('pPrice').value.trim(),
    promo: $('pPromo').value.trim(),
    style: $('pStyle').value.trim(),
    productId: $('pProductId').value.replace(/\D/g, ''),
    clipStyle: $('pClipStyle').value,
    scenes: Math.min(8, Math.max(1, parseInt($('pScenes').value, 10) || 3)),
    images: pendingImages,
    status: 'pending',
  });
  await saveQueue();
  ['pName', 'pDetails', 'pPrice', 'pPromo', 'pStyle', 'pProductId', 'pImages'].forEach((id) => ($(id).value = ''));
  imagePool = [];
  renderPreview();
  log(`เพิ่ม "${name}" เข้าคิวแล้ว`);
};

$('startBtn').onclick = async () => {
  // ขออนุญาตเขียนโฟลเดอร์หลักตอนกดปุ่มนี้ (ระหว่างทำงานอัตโนมัติไม่มีการกดปุ่ม จึงขอเองไม่ได้)
  await RootFolder.ready(true).catch(() => null);
  warnedNoPermission = false;
  showFolder();
  if (!(await chrome.extension.isAllowedFileSchemeAccess())) {
    log(
      'ยังรวมคลิปอัตโนมัติไม่ได้: เปิด chrome://extensions → GenClip → รายละเอียด → เปิดสวิตช์ "อนุญาตให้เข้าถึง URL ของไฟล์" (ทำครั้งเดียว)',
      'warn'
    );
  }
  const todo = queue.filter((p) => p.status !== 'done');
  if (!todo.length) return log('ไม่มีสินค้าที่ต้องทำในคิว', 'warn');
  running = true;
  aborted = false;
  setRunningUI();
  const settings = await loadSettings();
  const skipVideo = $('skipVideo').checked;
  for (const p of todo) {
    if (aborted) break;
    await setStatus(p, 'running');
    try {
      await processProduct(p, settings, { skipVideo });
      await setStatus(p, 'done');
      log(`✔ เสร็จ: ${p.name}`, 'ok');
    } catch (e) {
      if (aborted || e.message === 'ABORTED') {
        await setStatus(p, 'pending');
        log('หยุดการทำงานแล้ว', 'warn');
        break;
      }
      await setStatus(p, 'error');
      log(`✖ ${p.name}: ${e.message}`, 'error');
    }
  }
  running = false;
  setRunningUI();
};

$('stopBtn').onclick = async () => {
  aborted = true;
  log('กำลังหยุด...', 'warn');
  for (const site of Object.keys(SITES)) {
    for (const t of await findSiteTabs(site)) chrome.tabs.sendMessage(t.id, { type: 'gc:abort' }).catch(() => {});
  }
};

$('clearLogBtn').onclick = () => ($('log').innerHTML = '');

// โฟลเดอร์หลัก (เช่น D:\ClipGen) เลือกครั้งเดียว ระบบสร้าง ClipFinal และ GenPic\<สินค้า> ให้เอง
// Chrome อาจขออนุญาตใหม่หลังเปิดเบราว์เซอร์ใหม่
async function showFolder() {
  const { finalFolder, picFolder } = await loadSettings();
  const fin = finalFolder || GC_DEFAULTS.finalFolder;
  const pic = picFolder || GC_DEFAULTS.picFolder;
  const handle = await RootFolder.get().catch(() => null);
  if (!handle) {
    $('folderHint').textContent = `ตอนนี้บันทึกใน Downloads (กด 📁 เพื่อเลือกโฟลเดอร์หลัก เช่น D:\\ClipGen)`;
    return;
  }
  const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  $('folderHint').textContent =
    `คลิปที่รวมแล้ว → ${handle.name}\\${fin} · ภาพ → ${handle.name}\\${pic}\\<ชื่อสินค้า>` +
    (granted ? '' : ' (ยังไม่ได้อนุญาตในรอบนี้ กด 📁 หรือเริ่มทำงานเพื่ออนุญาต)');
}

$('pickFolderBtn').onclick = async () => {
  try {
    // มีโฟลเดอร์อยู่แล้วแต่ยังไม่ได้อนุญาต: ขออนุญาตก่อน ไม่ต้องเลือกใหม่
    const existing = await RootFolder.get();
    if (existing && (await existing.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      if ((await existing.requestPermission({ mode: 'readwrite' })) === 'granted') {
        log(`อนุญาตให้บันทึกที่โฟลเดอร์ "${existing.name}" แล้ว`, 'ok');
        warnedNoPermission = false;
        return showFolder();
      }
    }
    const handle = await RootFolder.pick();
    warnedNoPermission = false;
    log(`เลือกโฟลเดอร์หลัก "${handle.name}" แล้ว`, 'ok');
    if (/^(clipfinal|genpic)$/i.test(handle.name)) {
      log(`โฟลเดอร์ที่เลือกชื่อ "${handle.name}" ซึ่งน่าจะเป็นโฟลเดอร์ย่อย ควรเลือกโฟลเดอร์หลัก (เช่น D:\\ClipGen) แทน ไม่งั้นจะได้ ${handle.name}\\ClipFinal ซ้อนกัน`, 'warn');
    }
  } catch (e) {
    if (e.name !== 'AbortError') log(`เลือกโฟลเดอร์ไม่สำเร็จ: ${e.message}`, 'error');
  }
  showFolder();
};
showFolder();

// รวมคลิปจากไฟล์ที่เลือกเอง (เรียงตามชื่อไฟล์ เช่น scene-01, scene-02, ...)
$('mergeBtn').onclick = async () => {
  // ขออนุญาตโฟลเดอร์หลักก่อนเลือกไฟล์ เพราะตอนรวมเสร็จ (หลายสิบวินาทีต่อมา) จะขอเองไม่ได้แล้ว
  const root = await RootFolder.get().catch(() => null);
  if (root && (await root.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    const ok = (await root.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted';
    log(
      ok
        ? `อนุญาตโฟลเดอร์ "${root.name}" แล้ว (ถ้าหน้าต่างเลือกไฟล์ไม่ขึ้น กดปุ่มรวมคลิปอีกครั้ง)`
        : `ไม่ได้อนุญาตโฟลเดอร์ "${root.name}" คลิปที่รวมจะบันทึกใน Downloads`,
      ok ? 'ok' : 'warn'
    );
    showFolder();
  }
  $('mergeFiles').click();
};
// เรียงไฟล์คลิปตามลำดับฉาก: ชื่อแบบ scene-01, scene-02 เรียงตามชื่อ
// ถ้าชื่อไม่มีเลขฉาก (เช่น ชื่อเป็นรหัสยาว ๆ) เรียงตามเวลาที่ดาวน์โหลด
function sortClipFiles(picked) {
  const byName = picked.every((f) => /\d/.test(f.name) && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(f.name));
  if (!byName) log('ชื่อไฟล์ไม่มีเลขฉาก จึงเรียงตามเวลาที่ดาวน์โหลด (ไฟล์ที่ได้ก่อนอยู่ก่อน)', 'warn');
  return byName
    ? [...picked].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    : [...picked].sort((a, b) => a.lastModified - b.lastModified);
}

// เปิดหน้าต่างเลือกไฟล์วิดีโอ (ต้องเรียกทันทีหลังผู้ใช้กดปุ่ม) คืน [] ถ้ากดยกเลิก
function pickVideoFiles() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.multiple = true;
    input.onchange = () => resolve([...input.files]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

async function missingScenes(p) {
  const n = p.progress?.plan?.scenes.length || 0;
  const have = await Promise.all([...Array(n)].map((_, i) => ClipStore.get(p.id, i)));
  return have.map((b, i) => (b ? null : i)).filter((i) => i !== null);
}

// ให้ผู้ใช้เลือกไฟล์วิดีโอของสินค้านี้ แล้วเก็บไว้เป็นคลิปของแต่ละฉาก
// เลือกครบทุกฉาก หรือเลือกเฉพาะฉากที่ขาดก็ได้ (เรียงตามลำดับฉาก)
async function askClipsForProduct(p) {
  const n = p.progress?.plan?.scenes.length || 0;
  if (!n) {
    log(`"${p.name}" ยังไม่มีแผนฉาก จึงรวมคลิปไม่ได้`, 'warn');
    return false;
  }
  const missing = await missingScenes(p);
  log(`ยังไม่มีไฟล์วิดีโอของฉากที่ ${missing.map((i) => i + 1).join(', ')} กรุณาเลือกไฟล์วิดีโอของ "${p.name}" (ทั้ง ${n} ไฟล์ หรือเฉพาะ ${missing.length} ฉากที่ขาด)`);
  const picked = await pickVideoFiles();
  if (!picked.length) {
    log('ยกเลิกการเลือกไฟล์ (ถ้าหน้าต่างเลือกไฟล์ไม่ขึ้น กดปุ่มอีกครั้ง)', 'warn');
    return false;
  }
  const files = sortClipFiles(picked);
  const targets = files.length === n ? [...Array(n).keys()] : files.length === missing.length ? missing : null;
  if (!targets) {
    log(`เลือกมา ${files.length} ไฟล์ แต่สินค้านี้มี ${n} ฉาก (ขาด ${missing.length} ฉาก) กรุณาเลือกใหม่ให้จำนวนตรงกัน`, 'error');
    return false;
  }
  for (let k = 0; k < files.length; k++) await ClipStore.put(p.id, targets[k], files[k]);
  await ClipStore.put(p.id, 'final', null).catch(() => {});
  log(`เก็บไฟล์แล้ว: ${files.map((f, k) => `ฉาก ${targets[k] + 1} = ${f.name}`).join(' · ')}`, 'ok');
  return true;
}

$('mergeFiles').onchange = async (e) => {
  const files = sortClipFiles([...e.target.files]);
  e.target.value = '';
  if (files.length < 2) return log('กรุณาเลือกคลิปอย่างน้อย 2 ไฟล์', 'warn');
  $('mergeBtn').disabled = true;
  try {
    log(`ลำดับคลิป: ${files.map((f) => f.name).join(' → ')}`);
    await mergeAndSave(files, `รวมคลิป_${stamp()}`);
  } catch (err) {
    log(`รวมคลิปไม่สำเร็จ: ${err.message}`, 'error');
  } finally {
    $('mergeBtn').disabled = false;
  }
};

// เก็บโครงสร้างหน้า ChatGPT/Flow ที่เปิดอยู่ แล้วคัดลอกไว้ส่งให้ผู้พัฒนาปรับ selector
$('inspectBtn').onclick = async () => {
  const report = {};
  for (const site of Object.keys(SITES)) {
    const [tab] = await findSiteTabs(site);
    if (!tab) {
      report[site] = 'ไม่ได้เปิดแท็บ';
      continue;
    }
    try {
      await ensureContent(tab.id, site);
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'gc:inspect' });
      report[site] = res?.ok ? res.data : res?.error;
    } catch (e) {
      report[site] = e.message;
    }
  }
  const text = JSON.stringify(report, null, 2);
  log(text);
  try {
    await navigator.clipboard.writeText(text);
    log('คัดลอกข้อมูลตรวจหน้าเว็บแล้ว วางส่งให้ผู้พัฒนาได้เลย', 'ok');
  } catch {
    log('คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกข้อความด้านบนเอง', 'warn');
  }
};

// คลิกแบบเมาส์จริง (ผ่าน DevTools ของ Chrome) ให้หน้าเว็บที่ไม่รับคลิกจำลอง เช่น ปุ่มในหน้าต่างเพิ่มลิงก์ของ TikTok
// ระหว่างคลิก Chrome จะแสดงแถบ "GenClip เริ่มแก้ไขข้อบกพร่องเบราว์เซอร์นี้" ชั่วครู่
async function trustedClick(tabId, x, y) {
  const target = { tabId };
  await chrome.debugger.attach(target, '1.3').catch((e) => {
    if (!/already attached/i.test(e.message)) throw e;
  });
  try {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    }
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'gc:trustedClick' || !sender.tab) return;
  trustedClick(sender.tab.id, msg.x, msg.y).then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: e.message })
  );
  return true;
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'gc:log') log(msg.msg, msg.kind || 'info');
});

(async () => {
  ({ queue = [] } = await chrome.storage.local.get('queue'));
  queue.forEach((p) => p.status === 'running' && (p.status = 'pending'));
  renderQueue();
})();

$('ver').textContent = `v${chrome.runtime.getManifest().version}`;

// ---------- อัปเดตเวอร์ชัน (ใช้ในทีม) ----------
// ทุกเครื่องดึงโค้ดใหม่จาก GitHub ลงโฟลเดอร์ GenClip อัตโนมัติ (tools/setup-team.bat ตั้งงานตั้งเวลาไว้)
// GenClip อ่าน manifest.json ในโฟลเดอร์ (ไฟล์บนดิสก์) เทียบกับเวอร์ชันที่โหลดอยู่ ถ้าใหม่กว่าจะขึ้นแถบให้กดรีโหลด
const newerThan = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

// อัปเดต 2 แบบ:
//   'reload' = ไฟล์บนเครื่องใหม่กว่าที่โหลดอยู่ (อัปเดตด้วย git หรือแตก zip ทับแล้ว) แค่รีโหลด
//   'remote' = มีเวอร์ชันใหม่บนเซิร์ฟเวอร์ กด "อัปเดต" แล้วระบบดาวน์โหลดไฟล์ เขียนทับ และรีโหลดให้เอง (lib/updater.js)
let updateMode = '';
async function checkForUpdate() {
  try {
    const loaded = chrome.runtime.getManifest().version;
    const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    const onDisk = (await res.json()).version;
    if (newerThan(onDisk, loaded)) {
      updateMode = 'reload';
      $('updateText').textContent = `มีเวอร์ชันใหม่ v${onDisk} (ตอนนี้ v${loaded})`;
      $('reloadBtn').textContent = 'รีโหลด GenClip';
    } else {
      const remote = await Updater.check();
      if (!remote) return;
      updateMode = 'remote';
      $('updateText').textContent = `มีอัปเดตระบบใหม่ v${remote} (ตอนนี้ v${loaded})`;
      $('reloadBtn').textContent = 'อัปเดต';
    }
    $('updateBar').hidden = false;
    $('reloadBtn').disabled = running;
    $('reloadBtn').title = running ? 'รอให้งานที่กำลังทำเสร็จก่อน แล้วค่อยกดอัปเดต' : '';
  } catch {}
}

$('reloadBtn').onclick = async () => {
  if (running) return alert('กำลังทำงานอยู่ รอให้เสร็จหรือกดหยุดก่อน แล้วค่อยอัปเดต');
  if (updateMode !== 'remote') return chrome.runtime.reload();
  const btn = $('reloadBtn');
  btn.disabled = true;
  try {
    const version = await Updater.apply((msg) => ($('updateText').textContent = msg));
    log(`อัปเดตเป็น v${version} แล้ว กำลังรีโหลด GenClip...`, 'ok');
    await sleep(800);
    chrome.runtime.reload();
  } catch (e) {
    if (e.name === 'AbortError') $('updateText').textContent = 'ยกเลิกการเลือกโฟลเดอร์ กด "อัปเดต" อีกครั้งเมื่อพร้อม';
    else {
      $('updateText').textContent = `อัปเดตไม่สำเร็จ: ${e.message}`;
      log(`อัปเดตไม่สำเร็จ: ${e.message}`, 'error');
    }
    btn.disabled = false;
  }
};
checkForUpdate();
setInterval(checkForUpdate, 30 * 60 * 1000);

// ตัวเลือกสไตล์คลิป: ค่าเริ่มต้นสุ่มสไตล์ที่สินค้านี้ยังไม่เคยใช้
$('pClipStyle').innerHTML =
  '<option value="auto">สุ่มสไตล์ที่ไม่ซ้ำกับคลิปก่อน ๆ ของสินค้านี้ (แนะนำ)</option>' +
  CLIP_STYLES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
