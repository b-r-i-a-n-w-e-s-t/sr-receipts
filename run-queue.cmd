cd /d "%~dp0"
if not exist artifacts mkdir artifacts
node runner.ts > artifacts\runner.out 2>&1
