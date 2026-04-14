@echo off
chcp 65001 >nul 2>&1
title WeChat Manager - Build

:: Kiem tra quyen admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Yeu cau quyen Admin de build...
    echo Chon "Yes" khi Windows hoi.
    echo.
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: Da co quyen admin - chay build
cd /d "%~dp0"
echo ========================================
echo  WeChat Manager - Build installer
echo ========================================
echo.
call npm run build
echo.
if %errorlevel% equ 0 (
    echo ========================================
    echo  BUILD THANH CONG!
    echo  File installer nam trong: dist\
echo ========================================
) else (
    echo ========================================
    echo  BUILD THAT BAI. Xem loi o tren.
    echo ========================================
)
echo.
pause
