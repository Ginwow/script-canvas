@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请先安装 Node.js 22 或更新版本。
  pause
  exit /b 1
)
call npm ci
if errorlevel 1 (
  echo 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)
node node_modules\electron\install.js
if errorlevel 1 (
  echo Electron 桌面运行时安装失败。
  pause
  exit /b 1
)
echo 安装完成。现在可以双击“启动桌面程序.bat”。
pause
