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
