@echo off
cd /d "%~dp0"
echo CronoBalance Industrial disponivel em http://localhost:4173
echo Pressione Ctrl+C para encerrar.
py -m http.server 4173
