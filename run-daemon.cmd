cd /d "%~dp0"
if not exist artifacts mkdir artifacts
node daemon.ts > artifacts\daemon.out 2>&1
