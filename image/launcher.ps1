# Runs at logon inside the golden image (Scheduled Task, user session, auto-login enabled).
# Waits for the platform to drop launch.flag, then starts the app on the visible desktop.
while ($true) {
  if (Test-Path C:\cloudplay\launch.flag) {
    Remove-Item C:\cloudplay\launch.flag
    $b = [IO.File]::ReadAllBytes('C:\cloudplay\app.bin')[0..1]
    if ($b[0] -eq 0x4D) { Rename-Item C:\cloudplay\app.bin app.exe -Force; Start-Process C:\cloudplay\app.exe }
    else { Rename-Item C:\cloudplay\app.bin app.msi -Force; Start-Process msiexec -ArgumentList '/i C:\cloudplay\app.msi /qb' }
    # Stream server reads C:\cloudplay\token.txt as its access token.
  }
  Start-Sleep 2
}
