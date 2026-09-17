"=== arch";            $env:PROCESSOR_ARCHITECTURE
"=== windows";         (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion") | Select-Object ProductName, DisplayVersion, CurrentBuild, UBR | Format-List
"=== firefox builds";  Get-ChildItem "C:\Program Files*\Mozilla Firefox*\firefox.exe","C:\Program Files (x86)\Mozilla Firefox\firefox.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.VersionInfo | Select-Object FileName, ProductVersion } | Format-List
"=== nvda hand install"; Get-ChildItem "C:\Program Files*\NVDA\nvda.exe","C:\Program Files (x86)\NVDA\nvda.exe" -ErrorAction SilentlyContinue | ForEach-Object { $_.VersionInfo | Select-Object FileName, ProductVersion, FileVersion } | Format-List
"=== nvda guidepup asset"; Get-ChildItem "$env:LOCALAPPDATA\guidepup\nvda\all" -Name
"=== guidepup"; cmd /c "cd /d %USERPROFILE%\nvda-rig && npm ls @guidepup/guidepup --workspace @sr-receipts/guest 2>nul"
"=== node"; node -v
"=== sessions"; query session
"=== nvda firewall rules"; $n = (Get-ChildItem "$env:LOCALAPPDATA\guidepup\nvda\all" -Recurse -Filter nvda.exe | Select-Object -First 1).FullName; $n; Get-NetFirewallApplicationFilter -Program $n -ErrorAction SilentlyContinue | Get-NetFirewallRule | Select-Object DisplayName, Direction, Action, Enabled, Profile | Format-Table -AutoSize
"=== rig dir"; Get-ChildItem "$env:USERPROFILE\nvda-rig" -Name; Get-ChildItem "$env:USERPROFILE\nvda-rig\packages\guest\fixtures" -Name
