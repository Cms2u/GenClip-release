// เก็บไฟล์วิดีโอของแต่ละฉากไว้ใน IndexedDB ของ extension (คีย์ = รหัสสินค้า:ลำดับฉาก)
// เพื่อรวมคลิปอัตโนมัติได้ แม้ฉากจะทำเสร็จต่างรอบกัน
const ClipStore = (() => {
  let dbPromise;
  const db = () =>
    (dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open('genclip', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('clips');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  async function run(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('clips', mode);
      const req = fn(tx.objectStore('clips'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    put: (productId, index, blob) => run('readwrite', (s) => s.put(blob, `${productId}:${index}`)),
    get: (productId, index) => run('readonly', (s) => s.get(`${productId}:${index}`)),
    clear: (productId) => run('readwrite', (s) => s.delete(IDBKeyRange.bound(`${productId}:`, `${productId}:￿`))),
  };
})();
