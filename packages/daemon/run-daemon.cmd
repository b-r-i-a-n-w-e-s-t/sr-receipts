@echo off
rem The daemon runs from the rig's state directory, never from this package:
rem a reinstall replaces the package, and Windows will not replace a directory
rem a running process is standing in. provisioning\node.ps1 names the same one.
if not exist "%LOCALAPPDATA%\nvda-rig\artifacts" mkdir "%LOCALAPPDATA%\nvda-rig\artifacts"
cd /d "%LOCALAPPDATA%\nvda-rig"
rem A previous daemon survives the task being stopped: Task Scheduler ends only
rem cmd.exe, and node keeps the port. Its pid is in the file daemon.ts writes.
if exist artifacts\daemon.pid (
  for /f %%p in (artifacts\daemon.pid) do taskkill /PID %%p /F >nul 2>&1
  del /q artifacts\daemon.pid
)
call "%~dp0run-node.cmd" "%~dp0dist\daemon.js" > artifacts\daemon.out 2>&1
exit /b %ERRORLEVEL%
