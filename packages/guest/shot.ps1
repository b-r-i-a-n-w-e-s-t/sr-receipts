Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save("$env:USERPROFILE\nvda-rig\screen.png")
Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.Name) :: $($_.MainWindowTitle)" }
