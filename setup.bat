@echo off
chcp 65001 >nul 2>&1
title WeChat Manager — Setup

echo.
echo  =========================================
echo    WeChat Manager — Cai dat tu dong
echo  =========================================
echo.

:: ── 1. Kiem tra Node.js ──────────────────────────────────────
node --version >nul 2>&1
if errorlevel 1 (
    echo  [!] Node.js chua cai dat.
    echo      Tai tai: https://nodejs.org  ^(phien ban LTS^)
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

:: ── 2. Cai npm packages ──────────────────────────────────────
echo  [*] Cai npm packages...
call npm install --silent 2>nul
if errorlevel 1 (
    echo  [!] npm install that bai. Kiem tra ket noi mang.
    pause & exit /b 1
)
echo  [OK] npm packages da cai

:: ── 3. Cai PM2 neu chua co ───────────────────────────────────
pm2 --version >nul 2>&1
if errorlevel 1 (
    echo  [*] Cai PM2 ^(process manager^)...
    call npm install -g pm2 --silent 2>nul
    pm2 --version >nul 2>&1
    if errorlevel 1 (
        echo  [!] Cai PM2 that bai.
        pause & exit /b 1
    )
)
for /f "tokens=*" %%v in ('pm2 --version') do set PM2_VER=%%v
echo  [OK] PM2 v%PM2_VER%

:: ── 4. Tai cloudflared neu chua co ───────────────────────────
if exist cloudflared.exe (
    echo  [OK] cloudflared.exe da co san
    goto :start_pm2
)

echo  [*] Dang tai cloudflared.exe ^(~30 MB^)...
powershell -NoProfile -Command ^
  "try { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' -UseBasicParsing; Write-Host 'OK' } catch { Write-Host 'FAIL' }" 2>nul

if not exist cloudflared.exe (
    echo.
    echo  [!] Khong tai duoc cloudflared tu dong.
    echo      Vui long tai thu cong tai:
    echo      https://github.com/cloudflare/cloudflared/releases/latest
    echo      ^> File: cloudflared-windows-amd64.exe
    echo      ^> Doi ten thanh: cloudflared.exe
    echo      ^> Dat vao thu muc nay: %~dp0
    echo.
    echo  Sau khi dat xong, chay lai setup.bat
    pause & exit /b 1
)
echo  [OK] cloudflared.exe da tai xong

:: ── 5. Khoi dong PM2 ─────────────────────────────────────────
:start_pm2
echo.
echo  [*] Khoi dong tat ca services voi PM2...
pm2 delete wechat-web wechat-imap wechat-tunnel >nul 2>&1
pm2 start ecosystem.config.js
if errorlevel 1 (
    echo  [!] PM2 start that bai. Kiem tra ecosystem.config.js
    pause & exit /b 1
)

:: ── 6. Luu list va tu dong bat cung Windows ──────────────────
echo.
echo  [*] Luu cau hinh PM2...
pm2 save

echo  [*] Cau hinh tu khoi dong cung Windows...
pm2 startup 2>nul

:: ── 7. Xong ──────────────────────────────────────────────────
echo.
echo  =========================================
echo    Khoi dong thanh cong!
echo  =========================================
echo.
echo   Web admin : http://localhost:3000
echo   Dang nhap : mat khau trong file .env
echo.
echo   Cloudflare URL se hien trong log sau ~5 giay:
echo     pm2 logs wechat-tunnel
echo.
echo   Lenh PM2 hay dung:
echo     pm2 status              -- trang thai
echo     pm2 logs                -- xem tat ca log
echo     pm2 logs wechat-tunnel  -- URL cloudflare
echo     pm2 restart all         -- restart tat ca
echo     pm2 stop all            -- dung tat ca
echo.
echo  =========================================
echo.
pause
