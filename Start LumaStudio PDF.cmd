@echo off
setlocal
cd /d "%~dp0"
set "LUMA_ENV_PATH=%~dp0.env"
if exist "%~dp0release\mvp\win-unpacked\LumaStudio PDF.exe" (
  start "" "%~dp0release\mvp\win-unpacked\LumaStudio PDF.exe"
) else (
  call npm run desktop
)
