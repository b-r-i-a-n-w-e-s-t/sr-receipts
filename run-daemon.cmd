@echo off
cd /d "%~dp0"
if not exist artifacts mkdir artifacts
call "%~dp0run-node.cmd" daemon.ts > artifacts\daemon.out 2>&1
exit /b %ERRORLEVEL%
