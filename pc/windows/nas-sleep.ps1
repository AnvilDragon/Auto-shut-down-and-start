# Runs at PC shutdown (SYSTEM, via scheduled task on event 1074). Tells the NAS to sleep.
$cfg = Get-Content "$env:ProgramData\nas-sleep\config.json" | ConvertFrom-Json
$ev = Get-WinEvent -FilterHashtable @{LogName='System'; Id=1074} -MaxEvents 1 -ErrorAction SilentlyContinue
if ($ev -and $ev.Message -match 'restart') { exit 0 }   # don't sleep the NAS on reboot
& "$env:SystemRoot\System32\OpenSSH\ssh.exe" -i $cfg.KeyPath -o BatchMode=yes -o ConnectTimeout=5 `
  -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$env:ProgramData\nas-sleep\known_hosts" `
  "nassleep@$($cfg.NasHost)" nas-sleep
