// บันทึกไฟล์ลงโฟลเดอร์หลักที่ผู้ใช้เลือกเอง (เช่น D:\ClipGen) ด้วย File System Access API
// Chrome ดาวน์โหลดได้เฉพาะในโฟลเดอร์ Downloads จึงใช้วิธีนี้แทน ระบบสร้างโฟลเดอร์ย่อยให้เอง เช่น
//   D:\ClipGen\ClipFinal\<สินค้า>_<วันเวลา>.mp4   และ   D:\ClipGen\GenPic\<สินค้า>\scene-01.png
// ผู้ใช้เลือกโฟลเดอร์หลักครั้งเดียว (เก็บไว้ใน IndexedDB) แต่ Chrome อาจขออนุญาตใหม่เมื่อเปิดเบราว์เซอร์ใหม่
const RootFolder = (() => {
  let dbPromise;
  const db = () =>
    (dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('genclip-folder', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('handles', mode);
      const req = fn(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  const get = () => run('readonly', (s) => s.get('root'));

  // ต้องเรียกจากการกดปุ่มของผู้ใช้
  async function pick() {
    const handle = await window.showDirectoryPicker({ id: 'genclip-root', mode: 'readwrite' });
    await run('readwrite', (s) => s.put(handle, 'root'));
    return handle;
  }

  // interactive = true เมื่อเรียกจากการกดปุ่ม (ขออนุญาตได้) ไม่งั้นแค่ตรวจว่าได้รับอนุญาตแล้วหรือยัง
  async function ready(interactive) {
    const handle = await get();
    if (!handle) return null;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return handle;
    if (interactive && (await handle.requestPermission(opts)) === 'granted') return handle;
    return null;
  }

  // ถ้ามีไฟล์ชื่อเดียวกันอยู่แล้ว ต่อท้ายด้วย (2), (3), ...
  async function uniqueName(dir, name) {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${base} (${n})${ext}`;
      try {
        await dir.getFileHandle(candidate);
      } catch {
        return candidate;
      }
    }
  }

  // บันทึก blob ลง <root>/<subdirs...>/<name> (สร้างโฟลเดอร์ย่อยให้ถ้ายังไม่มี) คืนค่าพาธที่บันทึก
  async function save(root, subdirs, blob, name) {
    let dir = root;
    for (const part of subdirs.filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: true });
    const finalName = await uniqueName(dir, name);
    const file = await dir.getFileHandle(finalName, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return [root.name, ...subdirs.filter(Boolean), finalName].join('\\');
  }

  return { get, pick, ready, save };
})();
