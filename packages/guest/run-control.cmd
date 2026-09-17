@echo off
cd /d "%~dp0"
if not exist artifacts mkdir artifacts
set "RIG_EXECUTION_POSTURE=scheduled-task-cmd"
call "%~dp0run-node.cmd" smoke.ts control.html > artifacts\smoke-task.out 2>&1
exit /b %ERRORLEVEL%
