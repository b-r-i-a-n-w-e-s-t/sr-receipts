@echo off
cd /d "%~dp0"
if not exist artifacts mkdir artifacts
rem A previous daemon survives the task being stopped: Task Scheduler ends only
rem cmd.exe, and node keeps the port. Its pid is in the file daemon.ts writes.
if exist artifacts\daemon.pid (
  for /f %%p in (artifacts\daemon.pid) do taskkill /PID %%p /F >nul 2>&1
  del /q artifacts\daemon.pid
)
call "%~dp0run-node.cmd" daemon.ts > artifacts\daemon.out 2>&1
exit /b %ERRORLEVEL%
