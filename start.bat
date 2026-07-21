@echo off
setlocal
cd /d "%~dp0"

rem First run (or after deleting dist): build the frontend
if not exist "frontend\dist\index.html" (
  echo First run: building frontend, please wait...
  pushd frontend
  call npm install
  call npm run build
  popd
)

if not exist "frontend\dist\index.html" (
  echo [ERROR] Frontend build failed. Is Node.js / npm installed?
  pause
  exit /b 1
)

echo Starting AGV Simulator... a browser will open at http://localhost:8000
start "" /min cmd /c "timeout /t 3 >nul & start "" http://localhost:8000/"

cd backend
"venv\Scripts\python.exe" main.py

echo.
echo Server stopped. Press any key to close.
pause >nul
