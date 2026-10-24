#!/usr/bin/env bash
# ส่ง GenClip เวอร์ชันปัจจุบัน (commit ล่าสุด) ขึ้น repo สาธารณะ Cms2u/GenClip-release
# เครื่องในทีมที่ติดตั้งจาก zip จะเห็นแถบ "มีอัปเดตระบบใหม่" + ปุ่ม "อัปเดต" ใน side panel (lib/updater.js)
# ใช้: bash tools/release.sh   (รันในโฟลเดอร์ repo หลัก หลัง commit แล้ว)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=https://github.com/Cms2u/GenClip-release.git
WORK="${TMPDIR:-${TEMP:-/tmp}}/genclip-release"
VERSION=$(node -p "require('./manifest.json').version")

if [ -n "$(git status --porcelain)" ]; then
  echo "มีไฟล์ที่ยังไม่ได้ commit กรุณา commit ก่อน" >&2
  exit 1
fi

rm -rf "$WORK"
git clone -q --depth 1 "$REPO" "$WORK" 2>/dev/null || { mkdir -p "$WORK"; git -C "$WORK" init -q -b main; git -C "$WORK" remote add origin "$REPO"; }
# ล้างไฟล์เดิม (ยกเว้น .git) แล้วแตกไฟล์จาก commit ล่าสุด
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git archive --format=tar HEAD | tar -x -C "$WORK"
rm -f "$WORK/.gitattributes" "$WORK/.gitignore"
# ไม่แปลงบรรทัดไฟล์ใด ๆ (ขนาดไฟล์ต้องตรงกับ files.json)
printf '* -text\n' > "$WORK/.gitattributes"

# รายการไฟล์ + ขนาด สำหรับตัวอัปเดต
node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1], version = process.argv[2];
const skip = new Set([".git", ".gitattributes", "files.json", "GenClip.zip"]);
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = path.join(dir, name);
    const rel = path.relative(root, p).split(path.sep).join("/");
    if (fs.statSync(p).isDirectory()) walk(p);
    else files.push({ path: rel, size: fs.statSync(p).size });
  }
})(root);
fs.writeFileSync(path.join(root, "files.json"), JSON.stringify({ version, files }, null, 1));
console.log(`files.json: ${files.length} ไฟล์`);
' "$WORK" "$VERSION"

# zip สำหรับติดตั้งเครื่องใหม่ (ดาวน์โหลดได้จาก https://github.com/Cms2u/GenClip-release/raw/main/GenClip.zip)
git archive --format=zip --prefix=GenClip/ -o "$WORK/GenClip.zip" HEAD

git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "ไม่มีอะไรเปลี่ยน (v$VERSION ส่งขึ้นไปแล้ว)"
  exit 0
fi
git -C "$WORK" commit -q -m "GenClip v$VERSION"
git -C "$WORK" push -q -u origin main
echo "ส่ง GenClip v$VERSION ขึ้น Cms2u/GenClip-release แล้ว"
