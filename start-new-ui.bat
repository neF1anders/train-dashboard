@echo off
cd /d "%~dp0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr LISTENING ^| findstr :5173') do taskkill /PID %%p /F >nul 2>&1
echo Sirius: http://localhost:5173
start "" http://localhost:5173
python -m app.server --port 5173
