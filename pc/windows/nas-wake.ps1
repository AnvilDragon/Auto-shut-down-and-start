# Runs at PC startup: sends a Wake-on-LAN magic packet so the NAS is up when you are.
$cfg = Get-Content "$env:ProgramData\nas-sleep\config.json" | ConvertFrom-Json
$mac = [byte[]]($cfg.NasMac -split '[:-]' | ForEach-Object { [Convert]::ToByte($_,16) })
$pkt = [byte[]](,0xFF * 6) + [byte[]]($mac * 16)
$udp = New-Object System.Net.Sockets.UdpClient
$udp.EnableBroadcast = $true
1..3 | ForEach-Object { [void]$udp.Send($pkt, $pkt.Length, '255.255.255.255', 9); Start-Sleep 1 }
$udp.Close()
