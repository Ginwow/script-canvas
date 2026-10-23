@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo 请先双击“安装依赖.bat”完成首次安装。
  pause
  exit /b 1
)
call npm start
