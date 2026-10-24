@echo off
chcp 65001 >nul
rem อัปเดต GenClip ทันที (ไม่ต้องรองานอัตโนมัติทุก 30 นาที)
cd /d "%~dp0.."
echo กำลังดึง GenClip เวอร์ชันล่าสุด...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo อัปเดตไม่สำเร็จ: ตรวจการเชื่อมต่ออินเทอร์เน็ต หรือมีไฟล์ในโฟลเดอร์นี้ถูกแก้ไข
) else (
  echo.
  echo อัปเดตเสร็จแล้ว กดปุ่ม "รีโหลด GenClip" ที่แถบด้านบนของ side panel
)
pause
