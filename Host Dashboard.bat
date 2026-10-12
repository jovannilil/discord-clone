@echo off
title Host Dashboard (keep this window open while hosting)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org & pause & exit /b 1)
if not exist "server\node_modules" call npm run setup
node host\host.js
if errorlevel 1 pause
