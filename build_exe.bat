@echo off
setlocal
cd /d "%~dp0"

rem Kill any running instance so files are not locked
taskkill /F /IM AGV_Simulator.exe >nul 2>&1

echo [1/4] Building frontend...
pushd frontend
call npm install
call npm run build
popd
if not exist "frontend\dist\index.html" ( echo [ERROR] frontend build failed & pause & exit /b 1 )

echo [2/4] Packaging exe with PyInstaller...
cd backend
if exist build rmdir /S /Q build
if exist dist rmdir /S /Q dist
call "venv\Scripts\pyinstaller.exe" --name AGV_Simulator --onedir --noconfirm --console --add-data "..\frontend\dist;frontend\dist" --collect-all uvicorn --collect-all websockets main.py
if not exist "dist\AGV_Simulator\AGV_Simulator.exe" ( echo [ERROR] pyinstaller failed & pause & exit /b 1 )

echo [3/4] Copying default configs and readme...
copy /Y obstacles.json   "dist\AGV_Simulator\" >nul
copy /Y agvs.json        "dist\AGV_Simulator\" >nul
copy /Y map_config.json  "dist\AGV_Simulator\" >nul
xcopy /Y /I "pkg_files\*" "dist\AGV_Simulator\" >nul

echo [4/4] Zipping to Desktop...
powershell -NoProfile -Command "$z=Join-Path $env:USERPROFILE 'Desktop\AGV_Simulator.zip'; if(Test-Path $z){Remove-Item $z -Force}; Compress-Archive -Path 'dist\AGV_Simulator\*' -DestinationPath $z -CompressionLevel Optimal"

echo.
echo Done. Ready-to-send zip is on your Desktop: AGV_Simulator.zip
echo (Source folder: backend\dist\AGV_Simulator)
pause
