cd /d "%~dp0"
if not exist artifacts mkdir artifacts
set RIG_SMOKE_ARTIFACT=%CD%\artifacts\smoke-log.txt
node smoke.ts control.html > artifacts\smoke-task.out 2>&1
