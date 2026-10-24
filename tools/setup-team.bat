@echo off
chcp 65001 >nul
setlocal
rem ติดตั้ง GenClip สำหรับคนในทีม (ทำครั้งเดียวต่อเครื่อง)
rem  1) ดาวน์โหลดโค้ดจาก GitHub ลงโฟลเดอร์ %USERPROFILE%\GenClip
rem  2) ตั้งงานตั้งเวลาของ Windows ให้ดึงเวอร์ชันใหม่ทุก 30 นาที (ทำงานเงียบ ๆ ไม่มีหน้าต่างเด้ง)
rem  3) เปิดหน้า chrome://extensions ให้กด "โหลดส่วนขยายที่คลายการบีบอัด" เลือกโฟลเดอร์ GenClip

set "REPO=https://github.com/Cms2u/GenClip.git"
set "DIR=%USERPROFILE%\GenClip"

where git >nul 2>&1
if errorlevel 1 (
  echo ไม่พบโปรแกรม Git กำลังติดตั้ง...
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
  echo.
  echo ติดตั้ง Git เสร็จแล้ว กรุณาปิดหน้าต่างนี้ แล้วดับเบิลคลิกไฟล์นี้อีกครั้ง
  pause
  exit /b
)

if exist "%DIR%\.git" (
  echo มี GenClip อยู่แล้วที่ %DIR% กำลังอัปเดตเป็นเวอร์ชันล่าสุด...
  git -C "%DIR%" pull --ff-only
) else (
  echo กำลังดาวน์โหลด GenClip ไปที่ %DIR% ...
  echo ถ้ามีหน้าต่างให้ล็อกอิน GitHub ให้ล็อกอินด้วยบัญชีที่ได้รับสิทธิ์เข้า repo
  git clone "%REPO%" "%DIR%"
  if errorlevel 1 (
    echo.
    echo ดาวน์โหลดไม่สำเร็จ: ตรวจว่าบัญชี GitHub ได้รับเชิญเข้า repo แล้ว และต่ออินเทอร์เน็ตอยู่
    pause
    exit /b 1
  )
)

schtasks /create /f /sc minute /mo 30 /tn "GenClip Auto Update" /tr "wscript.exe \"%DIR%\tools\auto-update.vbs\"" >nul
if errorlevel 1 (
  echo ตั้งงานอัปเดตอัตโนมัติไม่สำเร็จ ใช้ไฟล์ tools\update-now.bat อัปเดตเองได้
) else (
  echo ตั้งงานอัปเดตอัตโนมัติทุก 30 นาทีแล้ว
)

echo.
echo ===== ขั้นสุดท้าย (ทำครั้งเดียว) =====
echo 1. ในหน้า chrome://extensions ที่เปิดขึ้น เปิด "โหมดนักพัฒนาซอฟต์แวร์" (มุมขวาบน)
echo 2. กด "โหลดส่วนขยายที่คลายการบีบอัด" แล้วเลือกโฟลเดอร์: %DIR%
echo 3. กด "รายละเอียด" ของ GenClip แล้วเปิด "อนุญาตให้เข้าถึง URL ของไฟล์"
echo.
echo หลังจากนี้เมื่อมีเวอร์ชันใหม่ GenClip จะขึ้นแถบ "มีเวอร์ชันใหม่" ให้กดปุ่ม "รีโหลด GenClip"
start "" chrome "chrome://extensions"
pause
