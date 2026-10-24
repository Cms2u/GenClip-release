# ต่อวิดีโอทุกฉากในโฟลเดอร์สินค้าเป็นไฟล์เดียว (ต้องติดตั้ง ffmpeg และอยู่ใน PATH)
# ใช้งาน: powershell -ExecutionPolicy Bypass -File tools\concat.ps1 "$env:USERPROFILE\Downloads\GenClip\<โฟลเดอร์สินค้า>"
param([Parameter(Mandatory = $true)][string]$Folder)

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error 'ไม่พบ ffmpeg ติดตั้งด้วยคำสั่ง: winget install Gyan.FFmpeg'
    exit 1
}

# ใช้เฉพาะเวอร์ชันหลักของแต่ละฉาก (scene-01.mp4) ไม่รวม scene-01-b.mp4
$files = Get-ChildItem -LiteralPath $Folder -Filter 'scene-*.mp4' |
    Where-Object { $_.BaseName -match '^scene-\d+$' } |
    Sort-Object Name
if (-not $files) {
    Write-Error "ไม่พบไฟล์ scene-XX.mp4 ใน $Folder"
    exit 1
}

$list = Join-Path $Folder 'concat-list.txt'
# ffmpeg อ่านไฟล์รายการที่มี BOM ไม่ได้ จึงเขียนเป็น UTF-8 แบบไม่มี BOM
$lines = $files | ForEach-Object { "file '$($_.FullName -replace "'", "'\''")'" }
[System.IO.File]::WriteAllLines($list, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
$out = Join-Path $Folder 'final.mp4'
ffmpeg -y -f concat -safe 0 -i $list -c copy $out
Remove-Item -LiteralPath $list
Write-Host "เสร็จแล้ว: $out"
