@echo off
chcp 65001 >nul
title AGV 模擬器
cd /d "%~dp0"

rem 首次啟動（或前端有更新後刪掉 dist）時自動打包前端
if not exist "frontend\dist\index.html" (
  echo [首次啟動] 正在打包前端，請稍候...
  pushd frontend
  call npm install
  call npm run build
  popd
  if not exist "frontend\dist\index.html" (
    echo [錯誤] 前端打包失敗，請確認已安裝 Node.js / npm。
    pause
    exit /b 1
  )
)

echo 啟動中... 稍候將自動開啟瀏覽器 http://localhost:8000
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:8000/"

cd backend
venv\Scripts\python.exe main.py

echo.
echo 伺服器已停止。按任意鍵關閉視窗。
pause >nul
