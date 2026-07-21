@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Building frontend...
pushd frontend
call npm install
call npm run build
popd
if not exist "frontend\dist\index.html" ( echo [ERROR] frontend build failed & pause & exit /b 1 )

echo [2/3] Packaging exe with PyInstaller...
cd backend
call "venv\Scripts\pyinstaller.exe" --name AGV_Simulator --onedir --noconfirm --console --add-data "..\frontend\dist;frontend\dist" --collect-all uvicorn --collect-all websockets main.py
if not exist "dist\AGV_Simulator\AGV_Simulator.exe" ( echo [ERROR] pyinstaller failed & pause & exit /b 1 )

echo [3/3] Copying default configs and readme into the package...
copy /Y obstacles.json   "dist\AGV_Simulator\" >nul
copy /Y agvs.json        "dist\AGV_Simulator\" >nul
copy /Y map_config.json  "dist\AGV_Simulator\" >nul
xcopy /Y /I "pkg_files\*" "dist\AGV_Simulator\" >nul

echo.
echo Done. Deliverable folder: backend\dist\AGV_Simulator
echo Zip that whole folder and send it. Recipient just double-clicks AGV_Simulator.exe
pause
