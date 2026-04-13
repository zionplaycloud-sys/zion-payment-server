@echo off
title Zion Stream System

echo Starting WebRTC Server...
start "WebRTC" cmd /k "cd /d E:\zion-stream && node webrtc-server.js"

timeout /t 2 > nul

echo Starting Stream Agent...
start "Agent" cmd /k "cd /d E:\zion-stream && node agent.js"

echo Stream system started!
pause