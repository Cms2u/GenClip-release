// อัปเดต GenClip จากหน้า side panel (ไม่ต้องมีบัญชี GitHub / ไม่ต้องติดตั้ง git)
// ไฟล์เวอร์ชันล่าสุดอยู่ใน repo สาธารณะ Cms2u/GenClip-release (ผู้พัฒนาส่งขึ้นด้วย tools/release.ps1)
//   manifest.json = เวอร์ชันล่าสุด, files.json = รายการไฟล์ทั้งหมดของ extension
// กดปุ่ม "อัปเดต" → เลือกโฟลเดอร์ GenClip ที่ติดตั้งไว้ (ครั้งแรกครั้งเดียว) → ดาวน์โหลดไฟล์ใหม่เขียนทับ → รีโหลด extension
const Updater = (() => {
  const BASE = 'https://raw.githubusercontent.com/Cms2u/GenClip-release/main/';
  const url = (path) => `${BASE}${path.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`;

  // เก็บโฟลเดอร์ที่ติดตั้ง extension ไว้ใน IndexedDB (ฐานเดียวกับโฟลเดอร์หลัก)
  let dbPromise;
  const db = () =>
    (dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('genclip-updater', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  async function store(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('handles', mode);
      const req = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  const newer = (a, b) => {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    }
    return false;
  };

  // เวอร์ชันล่าสุดบนเซิร์ฟเวอร์ (null = ไม่มีอัปเดต หรือเช็กไม่ได้)
  async function check() {
    try {
      const res = await fetch(url('manifest.json'), { cache: 'no-store' });
      if (!res.ok) return null;
      const remote = (await res.json()).version;
      return newer(remote, chrome.runtime.getManifest().version) ? remote : null;
    } catch {
      return null;
    }
  }

  // โฟลเดอร์ที่เลือกต้องเป็นโฟลเดอร์ของ GenClip ตัวที่ติดตั้งอยู่จริง (มี manifest.json ชื่อเดียวกัน)
  async function isOurFolder(dir) {
    try {
      const text = await (await (await dir.getFileHandle('manifest.json')).getFile()).text();
      return JSON.parse(text).name === chrome.runtime.getManifest().name;
    } catch {
      return false;
    }
  }
  async function hasGit(dir) {
    try {
      await dir.getDirectoryHandle('.git');
      return true;
    } catch {
      return false;
    }
  }

  // ต้องเรียกจากการกดปุ่มของผู้ใช้ (ขอสิทธิ์เขียนโฟลเดอร์)
  async function extensionFolder() {
    let dir = await store('readonly', (s) => s.get('ext'));
    if (dir && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted' && (await isOurFolder(dir))) return dir;
    alert('ครั้งแรก: กรุณาเลือกโฟลเดอร์ GenClip ที่ติดตั้งไว้ (โฟลเดอร์ที่มีไฟล์ manifest.json ที่แตกจาก zip)\nแล้วกด "อนุญาต/แก้ไขไฟล์" เพื่อให้ระบบเขียนไฟล์อัปเดตได้');
    dir = await window.showDirectoryPicker({ id: 'genclip-ext', mode: 'readwrite' });
    if (!(await isOurFolder(dir))) throw new Error('โฟลเดอร์ที่เลือกไม่ใช่โฟลเดอร์ GenClip (ไม่พบ manifest.json ของ GenClip)');
    await store('readwrite', (s) => s.put(dir, 'ext'));
    return dir;
  }

  async function writeFile(root, path, blob) {
    const parts = path.split('/');
    let dir = root;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  // ดาวน์โหลดไฟล์ทั้งหมดก่อน แล้วค่อยเขียนทับ (ถ้าเน็ตหลุดกลางทาง ไฟล์เดิมยังอยู่ครบ) manifest.json เขียนท้ายสุด
  async function apply(onProgress = () => {}) {
    const dir = await extensionFolder();
    if (await hasGit(dir)) throw new Error('โฟลเดอร์นี้อัปเดตด้วย git อยู่แล้ว (เครื่องผู้พัฒนา/เครื่องที่ใช้ setup-team.bat) ไม่ต้องกดอัปเดตจากหน้านี้');
    const list = await (await fetch(url('files.json'), { cache: 'no-store' })).json();
    const files = (list.files || []).filter((f) => f.path && !f.path.includes('..'));
    if (!files.some((f) => f.path === 'manifest.json')) throw new Error('รายการไฟล์อัปเดตไม่ครบ');
    const blobs = [];
    for (let i = 0; i < files.length; i++) {
      onProgress(`กำลังดาวน์โหลด ${i + 1}/${files.length}`);
      const res = await fetch(url(files[i].path), { cache: 'no-store' });
      if (!res.ok) throw new Error(`ดาวน์โหลด ${files[i].path} ไม่สำเร็จ (HTTP ${res.status})`);
      const blob = await res.blob();
      if (files[i].size != null && blob.size !== files[i].size) throw new Error(`ไฟล์ ${files[i].path} ไม่ครบ ลองใหม่อีกครั้ง`);
      blobs.push(blob);
    }
    const order = files.map((f, i) => i).sort((a, b) => (files[a].path === 'manifest.json') - (files[b].path === 'manifest.json'));
    for (const i of order) {
      onProgress(`กำลังติดตั้ง ${files[i].path}`);
      await writeFile(dir, files[i].path, blobs[i]);
    }
    return list.version;
  }

  return { check, apply };
})();
