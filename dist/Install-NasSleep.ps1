# NAS auto sleep/wake - Windows installer (single file).
# Run:  powershell -ExecutionPolicy Bypass -File .\Install-NasSleep.ps1
#       (optional: -NasHost 10.0.0.15 -LocalIp 10.0.0.14 | -Uninstall)
param($NasHost='10.0.0.15', $LocalIp='10.0.0.14', [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -NasHost $NasHost -LocalIp $LocalIp $(if($Uninstall){'-Uninstall'})"; exit }
$dir = "$env:ProgramData\nas-sleep"
if ($Uninstall) {
  'NAS-Sleep','NAS-Wake' | % { Unregister-ScheduledTask $_ -Confirm:$false -ErrorAction SilentlyContinue }
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue; 'Removed.'; Read-Host 'Enter to close'; exit }

if (-not (Test-Path "$env:SystemRoot\System32\OpenSSH\ssh.exe")) {
  throw 'OpenSSH client missing: Settings > System > Optional features > Add > OpenSSH Client' }
if (-not (Test-Connection $NasHost -Count 2 -Quiet)) { throw "NAS $NasHost not reachable - power it on first." }
$mac = (Get-NetNeighbor -IPAddress $NasHost -ErrorAction SilentlyContinue | ? LinkLayerAddress | select -First 1).LinkLayerAddress
if (-not $mac) { throw "Could not learn the NAS MAC for $NasHost" }
New-Item -ItemType Directory -Force $dir | Out-Null

@'
# Runs at PC shutdown (SYSTEM, via scheduled task on event 1074). Tells the NAS to sleep.
$cfg = Get-Content "$env:ProgramData\nas-sleep\config.json" | ConvertFrom-Json
$ev = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1074} -MaxEvents 1 -ErrorAction SilentlyContinue
if ($ev -and $ev.Message -match 'restart') { exit 0 }   # don't sleep the NAS on reboot
& "$env:SystemRoot\System32\OpenSSH\ssh.exe" -i $cfg.KeyPath -o BatchMode=yes -o ConnectTimeout=5 `
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$env:ProgramData\nas-sleep\known_hosts" `
  "nassleep@$($cfg.NasHost)" nas-sleep
'@ | Set-Content "$dir\nas-sleep.ps1"
@'
# Runs at PC startup: sends a Wake-on-LAN magic packet so the NAS is up when you are.
$cfg = Get-Content "$env:ProgramData\nas-sleep\config.json" | ConvertFrom-Json
$mac = [byte[]]($cfg.NasMac -split '[:-]' | ForEach-Object { [Convert]::ToByte($_,16) })
$pkt = [byte[]](,0xFF * 6) + [byte[]]($mac * 16)
# Send out of the dedicated NAS link (if LocalIp set) to its subnet broadcast (/24 assumed).
$dest = '255.255.255.255'
if ($cfg.LocalIp) {
  $o = $cfg.LocalIp -split '\.'; $dest = "$($o[0]).$($o[1]).$($o[2]).255"
  $udp = New-Object System.Net.Sockets.UdpClient([System.Net.IPEndPoint]::new([IPAddress]::Parse($cfg.LocalIp), 0))
} else { $udp = New-Object System.Net.Sockets.UdpClient }
$udp.EnableBroadcast = $true
# the link may not be up yet at boot; retry for ~30 s
1..10 | ForEach-Object { try { [void]$udp.Send($pkt, $pkt.Length, $dest, 9) } catch {}; Start-Sleep 3 }
$udp.Close()
'@ | Set-Content "$dir\nas-wake.ps1"

$key = "$dir\id_ed25519"
if (-not (Test-Path $key)) { & "$env:SystemRoot\System32\OpenSSH\ssh-keygen.exe" -q -t ed25519 -N '""' -f $key -C nas-sleep }
icacls $key /inheritance:r /grant:r "SYSTEM:(R)" "Administrators:(R)" | Out-Null
@{NasHost=$NasHost; NasMac=$mac; LocalIp=$LocalIp; KeyPath=$key} | ConvertTo-Json | Set-Content "$dir\config.json"

$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$st = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries
$pr = New-ScheduledTaskPrincipal -UserId SYSTEM -RunLevel Highest
$cls = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
$trg = New-CimInstance -CimClass $cls -ClientOnly -Property @{ Enabled=$true
  Subscription='<QueryList><Query Id="0"><Select Path="System">*[System[Provider[@Name=''User32''] and EventID=1074]]</Select></Query></QueryList>' }
Register-ScheduledTask NAS-Sleep -Force -Principal $pr -Settings $st -Trigger $trg `
  -Action (New-ScheduledTaskAction $ps "-NoProfile -ExecutionPolicy Bypass -File `"$dir\nas-sleep.ps1`"") | Out-Null
Register-ScheduledTask NAS-Wake -Force -Principal $pr -Settings $st -Trigger (New-ScheduledTaskTrigger -AtStartup) `
  -Action (New-ScheduledTaskAction $ps "-NoProfile -ExecutionPolicy Bypass -File `"$dir\nas-wake.ps1`"") | Out-Null

$pub = (Get-Content "$key.pub").Trim()
Write-Host "`nPC side installed. NAS MAC detected: $mac`n" -ForegroundColor Green
Write-Host "NEXT: on the NAS (System > Shell), after copying setup-truenas.sh over, run:`n"
Write-Host "  sudo sh setup-truenas.sh <POOLNAME> '$pub' $LocalIp`n" -ForegroundColor Yellow
Set-Clipboard "sudo sh setup-truenas.sh <POOLNAME> '$pub' $LocalIp"; Write-Host '(copied to clipboard - replace <POOLNAME>)'
Read-Host 'Enter to close'
