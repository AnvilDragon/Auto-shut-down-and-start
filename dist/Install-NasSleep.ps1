# NAS auto sleep/wake - Windows installer (single file).
# Run:  powershell -ExecutionPolicy Bypass -File .\Install-NasSleep.ps1
#       (optional: -NasHost 10.0.0.15 -LocalIp 10.0.0.14 | -Uninstall)
param($NasHost='10.0.0.15', $LocalIp='10.0.0.14', $Pool='', [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')) {
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -NasHost $NasHost -LocalIp $LocalIp -Pool '$Pool' $(if($Uninstall){'-Uninstall'})"; exit }
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
Write-Host "`nPC side installed. NAS MAC detected: $mac" -ForegroundColor Green
if (-not $Pool) { $Pool = Read-Host 'TrueNAS pool name (e.g. tank)' }
$b64 = 'IyEvYmluL3NoCiMgVHJ1ZU5BUyBTQ0FMRSBzZXR1cCAoc2luZ2xlIGZpbGUpLiBVc2FnZSAocnVuIG9uIHRoZSBOQVMpOgojICAgc3VkbyBzaCBzZXR1cC10cnVlbmFzLnNoIDxQT09MPiAnPHNzaCBwdWJsaWMga2V5IGZyb20gV2luZG93cyBpbnN0YWxsZXI+JyBbUENfSVBdCnNldCAtZXUKWyAiJChpZCAtdSkiIC1lcSAwIF0gfHwgZXhlYyBzdWRvIHNoICIkMCIgIiRAIgpQT09MPSIkezE6P3VzYWdlOiBzZXR1cC10cnVlbmFzLnNoIDxwb29sPiAnPHB1YmtleT4nIFtwY19pcF19IjsgUFVCS0VZPSIkezI6P21pc3NpbmcgcHVibGljIGtleX0iOyBQQ19JUD0iJHszOi0xMC4wLjAuMTR9IgpOQVNfSVA9IiR7TkFTX0lQOi0xMC4wLjAuMTV9IgpEPSIvbW50LyRQT09ML3NjcmlwdHMiCmNvbW1hbmQgLXYgcnRjd2FrZSA+L2Rldi9udWxsIHx8IHsgZWNobyAicnRjd2FrZSBub3QgZm91bmQiOyBleGl0IDE7IH0KCmVjaG8gIj09IDEvNSBkYXRhc2V0ICsgc2NyaXB0Igp6ZnMgbGlzdCAiJFBPT0wvc2NyaXB0cyIgPi9kZXYvbnVsbCAyPiYxIHx8IHpmcyBjcmVhdGUgIiRQT09ML3NjcmlwdHMiCmNhdCA+ICIkRC9uYXMtc2xlZXAuc2giIDw8J05BU19TTEVFUF9FT0YnCiMhL2Jpbi9zaAojIFJ1bnMgb24gdGhlIE5BUyAoYXMgcm9vdCkuIFBvd2VycyB0aGUgTkFTIGRvd24gYW5kIGFybXMgYW4gUlRDIGFsYXJtIHNvIGl0CiMgcG93ZXJzIGl0c2VsZiBiYWNrIG9uIGF0IFdBS0VfVElNRS4gQ2FsbGVkIG92ZXIgU1NIIGJ5IHRoZSBQQyBhdCBzaHV0ZG93bi4Kc2V0IC1ldQoKQ09ORj0iJHtOQVNfU0xFRVBfQ09ORjotJChkaXJuYW1lICIkKHJlYWRsaW5rIC1mICIkMCIpIikvbmFzLXNsZWVwLmNvbmZ9IiAgICMgbGl2ZXMgbmV4dCB0byB0aGUgc2NyaXB0IChzdXJ2aXZlcyBUcnVlTkFTIHVwZGF0ZXMpClsgLWYgIiRDT05GIiBdIHx8IENPTkY9L2V0Yy9uYXMtc2xlZXAuY29uZgpXQUtFX1RJTUU9IjA4OjAwIiAgICAgICMgbG9jYWwgdGltZSB0byB3YWtlCk1PREU9Im9mZiIgICAgICAgICAgICAgIyBvZmYgPSBmdWxsIHBvd2VyLW9mZiArIFJUQyB3YWtlLCBtZW0gPSBzdXNwZW5kLXRvLVJBTQpHUkFDRT0zMCAgICAgICAgICAgICAgICMgc2Vjb25kcyB0byB3YWl0IHNvIHRoZSBTU0ggY2FsbCByZXR1cm5zIC8gUEMgY2FuIGFib3J0ClBDX0hPU1Q9IiIgICAgICAgICAgICAgIyBvcHRpb25hbDogaWYgdGhpcyBob3N0IGFuc3dlcnMgcGluZyBhZnRlciBHUkFDRSwgYWJvcnQKSU5ISUJJVD0vdmFyL3J1bi9uYXMtc2xlZXAuaW5oaWJpdCAgICMgdG91Y2ggdGhpcyBmaWxlIHRvIGtlZXAgdGhlIE5BUyBhd2FrZQpbIC1mICIkQ09ORiIgXSAmJiAuICIkQ09ORiIKCmxvZygpIHsgbG9nZ2VyIC10IG5hcy1zbGVlcCAiJCoiOyBlY2hvICIkKiI7IH0KClsgLWUgIiRJTkhJQklUIiBdICYmIHsgbG9nICJpbmhpYml0IGZpbGUgcHJlc2VudCwgc3RheWluZyBhd2FrZSI7IGV4aXQgMDsgfQoKbm93PSQoZGF0ZSArJXMpCnRhcmdldD0kKGRhdGUgLWQgInRvZGF5ICRXQUtFX1RJTUUiICslcykKaWYgWyAiJHRhcmdldCIgLWd0ICIkbm93IiBdICYmIFsgJCgodGFyZ2V0IC0gbm93KSkgLWx0IDkwMCBdOyB0aGVuCiAgbG9nICJ3YWtlIHRpbWUgaXMgPDE1IG1pbiBhd2F5LCBzdGF5aW5nIGF3YWtlIjsgZXhpdCAwCmZpClsgIiR0YXJnZXQiIC1sZSAiJG5vdyIgXSAmJiB0YXJnZXQ9JChkYXRlIC1kICJ0b21vcnJvdyAkV0FLRV9USU1FIiArJXMpCgpkb19zbGVlcCgpIHsKICBzbGVlcCAiJEdSQUNFIgogIGlmIFsgLW4gIiRQQ19IT1NUIiBdICYmIHBpbmcgLWMxIC1XMiAiJFBDX0hPU1QiID4vZGV2L251bGwgMj4mMTsgdGhlbgogICAgbG9nICIkUENfSE9TVCBpcyBiYWNrIHVwIChyZXN0YXJ0PyksIGFib3J0aW5nIjsgcmV0dXJuCiAgZmkKICBbIC1lICIkSU5ISUJJVCIgXSAmJiB7IGxvZyAiaW5oaWJpdCBhcHBlYXJlZCwgYWJvcnRpbmciOyByZXR1cm47IH0KICBzeW5jCiAgbG9nICJzbGVlcGluZyAobW9kZT0kTU9ERSksIHdha2luZyBhdCAkKGRhdGUgLWQgQCIkdGFyZ2V0IikiCiAgaWYgISBydGN3YWtlIC1tICIkTU9ERSIgLS1hdXRvIC10ICIkdGFyZ2V0IjsgdGhlbgogICAgbG9nICJydGN3YWtlIGZhaWxlZCAtIGZhbGxpbmcgYmFjayB0byBwb3dlcm9mZiAobmVlZHMgV2FrZS1vbi1MQU4gdG8gcmV0dXJuKSIKICAgIHBvd2Vyb2ZmCiAgZmkKfQoKIyBkZXRhY2ggc28gdGhlIFNTSCBzZXNzaW9uIHJldHVybnMgaW1tZWRpYXRlbHkKZG9fc2xlZXAgPC9kZXYvbnVsbCA+L2Rldi9udWxsIDI+JjEgJgpsb2cgInNjaGVkdWxlZCBzbGVlcCBpbiAke0dSQUNFfXMiCk5BU19TTEVFUF9FT0YKY2F0ID4gIiREL25hcy1zbGVlcC5jb25mIiA8PEVPRgpXQUtFX1RJTUU9IjA4OjAwIgpNT0RFPSJvZmYiCkdSQUNFPTMwClBDX0hPU1Q9IiRQQ19JUCIKRU9GCmNobW9kIDc1NSAiJEQvbmFzLXNsZWVwLnNoIgoKZWNobyAiPT0gMi81IFdha2Utb24tTEFOIG9uIHRoZSBOSUMgY2FycnlpbmcgJE5BU19JUCAocGVyc2lzdGVkIGFzIHBvc3QtaW5pdCBjb21tYW5kKSIKTklDPSQoaXAgLW8gLTQgYWRkciBzaG93IHwgYXdrIC12IGlwPSIkTkFTX0lQIiAnJDQgfiAiXiJpcCIvIiB7cHJpbnQgJDJ9JykKaWYgWyAtbiAiJE5JQyIgXTsgdGhlbgogIGV0aHRvb2wgLXMgIiROSUMiIHdvbCBnIHx8IGVjaG8gIndhcm5pbmc6IGV0aHRvb2wgd29sIGZhaWxlZCBvbiAkTklDIgogIG1pZGNsdCBjYWxsIGluaXRzaHV0ZG93bnNjcmlwdC5jcmVhdGUgIntcInR5cGVcIjpcIkNPTU1BTkRcIixcImNvbW1hbmRcIjpcImV0aHRvb2wgLXMgJE5JQyB3b2wgZ1wiLFwid2hlblwiOlwiUE9TVElOSVRcIixcImVuYWJsZWRcIjp0cnVlLFwiY29tbWVudFwiOlwibmFzLXNsZWVwIFdvTFwifSIgPi9kZXYvbnVsbCB8fCB0cnVlCiAgZWNobyAiTklDPSROSUMgTUFDPSQoY2F0IC9zeXMvY2xhc3MvbmV0LyROSUMvYWRkcmVzcykiCmVsc2UgZWNobyAid2FybmluZzogbm8gTklDIGhhcyAkTkFTX0lQIjsgZmkKCmVjaG8gIj09IDMvNSByZXN0cmljdGVkIHVzZXIgJ25hc3NsZWVwJyIKaWYgISBtaWRjbHQgY2FsbCB1c2VyLnF1ZXJ5ICdbWyJ1c2VybmFtZSIsIj0iLCJuYXNzbGVlcCJdXScgfCBncmVwIC1xIG5hc3NsZWVwOyB0aGVuCiAgS0VZTElORT0iY29tbWFuZD1cInN1ZG8gJEQvbmFzLXNsZWVwLnNoXCIscmVzdHJpY3QgJFBVQktFWSIKICBtaWRjbHQgY2FsbCB1c2VyLmNyZWF0ZSAiJChweXRob24zIC0gIiRLRVlMSU5FIiAiJEQiIDw8J1BZJwppbXBvcnQganNvbixzeXMKcHJpbnQoanNvbi5kdW1wcyh7InVzZXJuYW1lIjoibmFzc2xlZXAiLCJmdWxsX25hbWUiOiJOQVMgc2xlZXAgdHJpZ2dlciIsImdyb3VwX2NyZWF0ZSI6VHJ1ZSwKICJwYXNzd29yZF9kaXNhYmxlZCI6VHJ1ZSwic21iIjpGYWxzZSwic2hlbGwiOiIvdXNyL2Jpbi9iYXNoIiwiaG9tZSI6c3lzLmFyZ3ZbMl0rIi9uYXNzbGVlcC1ob21lIiwiaG9tZV9jcmVhdGUiOlRydWUsCiAic3NocHVia2V5IjpzeXMuYXJndlsxXSwic3Vkb19jb21tYW5kc19ub3Bhc3N3ZCI6W3N5cy5hcmd2WzJdKyIvbmFzLXNsZWVwLnNoIl19KSkKUFkKKSIgPi9kZXYvbnVsbCAmJiBlY2hvIGNyZWF0ZWQgfHwgZWNobyAiRkFJTEVEOiBjcmVhdGUgdXNlciBpbiBVSSBpbnN0ZWFkIChzZWUgbmFzL1RSVUVOQVMubWQgc3RlcCAzKSIKZWxzZSBlY2hvICJhbHJlYWR5IGV4aXN0cyI7IGZpCgplY2hvICI9PSA0LzUgZW5hYmxlIFNTSCBzZXJ2aWNlIgptaWRjbHQgY2FsbCBzZXJ2aWNlLnVwZGF0ZSBzc2ggJ3siZW5hYmxlIjp0cnVlfScgPi9kZXYvbnVsbAptaWRjbHQgY2FsbCBzZXJ2aWNlLmNvbnRyb2wgU1RBUlQgc3NoID4vZGV2L251bGwgMj4mMSB8fCB0cnVlCgplY2hvICI9PSA1LzUgUlRDIHdha2UgY2FwYWJpbGl0eSIKcnRjd2FrZSAtbSBzaG93IC0tYXV0byB8fCB0cnVlCmVjaG8KZWNobyAiRG9uZS4gVmVyaWZ5IFJUQyB3YWtlIHlvdXJzZWxmIE9OQ0UgKE5BUyB3aWxsIHN1c3BlbmQgfjYwIHMpOiAgc3VkbyBydGN3YWtlIC1tIG1lbSAtcyA2MCIKZWNobyAiVGhlbiB0ZXN0IHRoZSB3aG9sZSBjaGFpbiBmcm9tIFdpbmRvd3M6ICBzc2ggLWkgQzpcXFByb2dyYW1EYXRhXFxuYXMtc2xlZXBcXGlkX2VkMjU1MTkgbmFzc2xlZXBAJE5BU19JUCIK'
$cmd = "echo '$b64' | base64 -d > /tmp/setup-truenas.sh && sudo sh /tmp/setup-truenas.sh '$Pool' '$pub' $LocalIp"
Set-Clipboard $cmd
$cmd | Set-Content "$env:USERPROFILE\Desktop\truenas-command.txt"
Write-Host "`nNEXT: open TrueNAS UI > System > Shell, right-click paste (already on your clipboard), Enter." -ForegroundColor Yellow
Write-Host "Backup copy: Desktop\truenas-command.txt"
Read-Host 'Enter to close'
