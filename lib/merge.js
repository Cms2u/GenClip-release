// รวมคลิปหลายไฟล์เป็นไฟล์เดียวในเบราว์เซอร์ (ไม่ต้องติดตั้งโปรแกรมเพิ่ม)
// วิธี: เล่นคลิปทีละไฟล์ วาดลง canvas แล้วอัดใหม่ด้วย MediaRecorder พร้อมเสียง
// ใช้เวลาเท่ากับความยาวรวมของคลิป และต้องเปิด side panel ค้างไว้ระหว่างรวม

const MERGE_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

function loadVideo(video, blob) {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('เปิดไฟล์วิดีโอไม่ได้'));
    video.src = URL.createObjectURL(blob);
  });
}

// blobs: Blob/File ของแต่ละฉากตามลำดับ, onProgress(index, total)
// speed: ความเร็ว (เช่น 1.25) เล่นเร็วขึ้นตอนอัด เสียงไม่แหลม (preservesPitch) คลิปจะสั้นลงตามสัดส่วน
// overlay: ตัวหนังสือที่เขียนทับ (ดู lib/overlay.js)
// resolution: ความละเอียดด้านสั้นของคลิปที่ได้ (1080 = 1080x1920, 1440 = 1440x2560, 0 = เท่าคลิปต้นฉบับ)
//   คลิปจาก Flow เป็น 720p จะขยายด้วยการย่อขยายคุณภาพสูง ให้ได้ไฟล์ 1080p ที่ TikTok/Facebook แสดงคมกว่า
async function mergeClips(blobs, onProgress = () => {}, { speed = 1, overlay = null, resolution = 1080 } = {}) {
  const mimeType = MERGE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) throw new Error('เบราว์เซอร์นี้อัดวิดีโอไม่ได้');

  const video = document.createElement('video');
  video.playsInline = true;
  await loadVideo(video, blobs[0]);
  const canvas = document.createElement('canvas');
  const short = Math.min(video.videoWidth || 720, video.videoHeight || 1280);
  // มีตัวหนังสือทับแต่ตั้งเป็นเท่าต้นฉบับ: ยังขยายเป็นอย่างน้อย 1080 ให้ตัวหนังสือคม
  const target = resolution || (overlay ? 1080 : 0);
  const up = target ? Math.max(1, target / short) : 1;
  canvas.width = Math.round(((video.videoWidth || 720) * up) / 2) * 2;
  canvas.height = Math.round(((video.videoHeight || 1280) * up) / 2) * 2;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (overlay) await Overlay.loadFont();
  let current = 0;

  // เสียงจากคลิปส่งเข้าเครื่องอัดเท่านั้น ไม่ออกลำโพง
  const audioCtx = new AudioContext();
  await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaElementSource(video).connect(dest);

  const stream = canvas.captureStream(30);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  // บิตเรตตามขนาดภาพ (1080x1920 ≈ 12 Mbps, 1440x2560 ≈ 20 Mbps)
  const bitrate = Math.round(Math.min(24, Math.max(8, ((canvas.width * canvas.height) / (1080 * 1920)) * 12)) * 1e6);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (recorder.onstop = r));

  // วาดแบบเต็มกรอบ (ตัดขอบถ้าสัดส่วนไม่ตรง) เพื่อให้ทุกคลิปขนาดเท่ากัน
  const draw = () => {
    const s = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const w = video.videoWidth * s;
    const h = video.videoHeight * s;
    ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    if (overlay) Overlay.draw(ctx, canvas.width, canvas.height, overlay, current, blobs.length, video.currentTime);
  };

  recorder.start(1000);
  for (let i = 0; i < blobs.length; i++) {
    onProgress(i, blobs.length);
    current = i;
    if (i > 0) await loadVideo(video, blobs[i]);
    // ต้องตั้งใหม่ทุกคลิป เพราะการเปลี่ยน src จะรีเซ็ตความเร็ว
    video.preservesPitch = true;
    video.defaultPlaybackRate = speed;
    video.playbackRate = speed;
    await new Promise((resolve, reject) => {
      const onFrame = () => {
        draw();
        if (!video.ended) video.requestVideoFrameCallback(onFrame);
      };
      video.onended = () => {
        draw();
        resolve();
      };
      video.onerror = () => reject(new Error(`เล่นคลิปที่ ${i + 1} ไม่ได้`));
      video.requestVideoFrameCallback(onFrame);
      video.play().catch(reject);
    });
    URL.revokeObjectURL(video.src);
  }
  recorder.stop();
  await stopped;
  await audioCtx.close();
  return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), ext: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' };
}
