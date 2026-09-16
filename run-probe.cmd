cd /d "%~dp0"
if not exist artifacts mkdir artifacts
node probe.ts > artifacts\probe.out 2>&1
