@echo off
cd /d "%~dp0"
if not exist artifacts mkdir artifacts
call "%~dp0run-node.cmd" runner.ts > artifacts\runner.out 2>&1
exit /b %ERRORLEVEL%
