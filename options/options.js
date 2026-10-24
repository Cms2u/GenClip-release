const $ = (id) => document.getElementById(id);
const TEXT_FIELDS = ['planTemplate', 'imageTemplate', 'videoPrefix', 'videoSuffix', 'finalFolder', 'picFolder', 'humanGuide', 'postFixedTimes', 'postRandomStart', 'postRandomEnd', 'companionSite', 'ctaText', 'shopUrlText', 'fbComposerUrl', 'fbFixedTimes', 'fbRandomStart', 'fbRandomEnd'];
const SELECT_FIELDS = ['mergeResolution', 'flowModel', 'flowApproveMode', 'autoTikTok', 'clipSpeed', 'flowRetries', 'autoPostTikTok', 'postTiming', 'companionMode', 'textInImage', 'textOverlay', 'autoFacebook', 'autoPostFacebook', 'fbPostTiming'];
const NUM_FIELDS = ['planTimeoutSec', 'imageTimeoutSec', 'videoTimeoutSec', 'sceneDelaySec', 'postMinGapMin', 'postIntervalMin', 'postIntervalMax', 'fbMinGapMin', 'fbIntervalMin', 'fbIntervalMax'];

function show(settings) {
  const s = { ...GC_DEFAULTS, ...settings };
  TEXT_FIELDS.forEach((k) => ($(k).value = s[k]));
  NUM_FIELDS.forEach((k) => ($(k).value = s[k]));
  SELECT_FIELDS.forEach((k) => ($(k).value = s[k]));
  $('selectors').value = Object.keys(s.selectors || {}).length ? JSON.stringify(s.selectors, null, 2) : '';
}

function flash(text) {
  $('msg').textContent = text;
  setTimeout(() => ($('msg').textContent = ''), 3000);
}

$('saveBtn').onclick = async () => {
  let selectors = {};
  if ($('selectors').value.trim()) {
    try {
      selectors = JSON.parse($('selectors').value);
    } catch {
      return flash('Selector ไม่ใช่ JSON ที่ถูกต้อง');
    }
  }
  const settings = { selectors };
  TEXT_FIELDS.forEach((k) => (settings[k] = $(k).value));
  NUM_FIELDS.forEach((k) => (settings[k] = Number($(k).value) || GC_DEFAULTS[k]));
  SELECT_FIELDS.forEach((k) => (settings[k] = $(k).value));
  await chrome.storage.local.set({ settings });
  flash('บันทึกแล้ว');
};

$('resetBtn').onclick = async () => {
  await chrome.storage.local.remove('settings');
  show({});
  flash('คืนค่าตั้งต้นแล้ว');
};

chrome.storage.local.get('settings').then(({ settings }) => show(settings || {}));
