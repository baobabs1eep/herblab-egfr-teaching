@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "本地服务\server.cjs"
pause
