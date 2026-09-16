@echo off
setlocal
set "NODE=%LOCALAPPDATA%\nvda-rig\node-v22.18.0-win-arm64\node.exe"
if not exist "%NODE%" (
  echo nvda-rig Node was not found at "%NODE%". Run provisioning\provision.ps1 from the signed-in desktop first. 1>&2
  exit /b 1
)
"%NODE%" %*
exit /b %ERRORLEVEL%
