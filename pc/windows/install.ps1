# Run in an elevated PowerShell:
#   .\install.ps1 -NasHost 192.168.1.20 -NasMac aa:bb:cc:dd:ee:ff
param([Parameter(Mandatory)]$NasHost, [Parameter(Mandatory)]$NasMac)
$dir = "$env:ProgramData\nas-sleep"; New-Item -ItemType Directory -Force $dir | Out-Null
Copy-Item "$PSScriptRoot\nas-sleep.ps1","$PSScriptRoot\nas-wake.ps1" $dir -Force
$key = "$dir\id_ed25519"
if (-not (Test-Path $key)) { & "$env:SystemRoot\System32\OpenSSH\ssh-keygen.exe" -t ed25519 -N '""' -f $key -C nas-sleep }
icacls $key /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)" | Out-Null
@{NasHost=$NasHost; NasMac=$NasMac; KeyPath=$key} | ConvertTo-Json | Set-Content "$dir\config.json"

$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$st = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries
$pr = New-ScheduledTaskPrincipal -UserId SYSTEM -RunLevel Highest

# Shutdown: fire on "a process initiated a shutdown" (event 1074)
$cls = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
$trg = New-CimInstance -CimClass $cls -ClientOnly -Property @{
  Enabled=$true
  Subscription='<QueryList><Query Id="0"><Select Path="System">*[System[Provider[@Name=''User32''] and EventID=1074]]</Select></Query></QueryList>' }
Register-ScheduledTask NAS-Sleep -Force -Principal $pr -Settings $st -Trigger $trg `
  -Action (New-ScheduledTaskAction $ps "-NoProfile -ExecutionPolicy Bypass -File `"$dir\nas-sleep.ps1`"") | Out-Null
# Startup: wake NAS
Register-ScheduledTask NAS-Wake -Force -Principal $pr -Settings $st -Trigger (New-ScheduledTaskTrigger -AtStartup) `
  -Action (New-ScheduledTaskAction $ps "-NoProfile -ExecutionPolicy Bypass -File `"$dir\nas-wake.ps1`"") | Out-Null

Write-Host "`nAdd this public key on the NAS:  ./install.sh `"<line below>`"`n"
Get-Content "$key.pub"
