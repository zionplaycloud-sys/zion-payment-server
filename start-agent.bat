@echo off
title ZION PLAY - AUTO START

echo 🚀 Starting Zion Play System...

:: ================================
:: 1. WEBRTC SERVER
:: ================================
start "WebRTC Server" cmd /k "cd /d E:\zion-stream && node webrtc-server.js"
timeout /t 2 >nul

:: ================================
:: 2. AGENT SERVER
:: ================================
start "Agent Server" cmd /k "cd /d E:\zion-agent && node agent.js"
timeout /t 3 >nul

:: ================================
:: 4. ELECTRON AGENT UI
:: ================================
start "Agent UI" cmd /k "cd /d E:\zion-agent-ui && npm start"
timeout /t 2 >nul

:: ================================
:: 5. CLIENT UI
:: ================================
start "Client UI" cmd /k "cd /d E:\zion-client && npm start"

echo ✅ All systems started!
pause