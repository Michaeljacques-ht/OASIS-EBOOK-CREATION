@echo off
REM ─── OASIS Plateforme — démarrage Windows ───
REM Les clés se configurent dans le fichier .env (copiez .env.exemple).
cd /d "%~dp0"
echo Demarrage d'OASIS Plateforme...
node server.js
pause
