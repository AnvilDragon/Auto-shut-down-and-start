# Auto shut down and start (PC ⇄ NAS)

When the PC shuts down, the NAS powers off (or suspends) and arms its own RTC alarm
to power back on at **08:00**. When the PC boots, it sends Wake-on-LAN so the NAS is
up if it was asleep.

```
PC shutdown ──ssh (restricted key)──▶ NAS: nas-sleep.sh ─▶ rtcwake -m off -t <next 08:00>
PC startup  ──Wake-on-LAN──────────▶ NAS
```

No always-on helper device is needed: the NAS wakes itself from its hardware clock.

## 1. NAS setup (TrueNAS SCALE: see `nas/TRUENAS.md`; generic Linux below)
1. In BIOS enable **RTC/Resume by Alarm** and **Wake on LAN** (also enable WoL on the NIC: `ethtool -s eth0 wol g`).
2. Verify the RTC can wake it: `sudo rtcwake -m mem -s 60` (should resume after a minute).
3. On the PC run its installer first (it prints a public key), then on the NAS as root:
   `./nas/install.sh "ssh-ed25519 AAAA... nas-sleep"`
4. Edit `/etc/nas-sleep.conf` (wake time, `PC_HOST` for restart-abort).

The key can only run `nas-sleep.sh` (forced command + `restrict` + sudoers limited to that script).
To keep the NAS up temporarily (backup, download): `touch /var/run/nas-sleep.inhibit`.

## 2. PC setup
- **Windows 10/11** (elevated PowerShell): `pc\windows\install.ps1 -NasHost <ip> -NasMac <mac>`
  Registers two SYSTEM tasks: `NAS-Sleep` (shutdown event 1074, skipped on restart) and `NAS-Wake` (startup).
  Needs the OpenSSH Client feature. Disable Fast Startup if shutdown events don't fire reliably.
- **Linux**: edit and install `pc/linux/nas-sleep.service`.

## Behaviour notes
- PC shut down within 15 min before 08:00 → NAS stays on. After 08:00 → wakes tomorrow 08:00.
- 30 s grace before the NAS sleeps; if `PC_HOST` answers ping by then (restart) it aborts.
- If `rtcwake` isn't supported the NAS falls back to `poweroff`; then only Wake-on-LAN
  (PC boot, or `wakeonlan <mac>` from a router/Pi cron at 08:00) can bring it back.
- Not applicable as-is to Synology/QNAP appliances (no `rtcwake`); use their built-in
  power schedule for the 08:00 start and keep just the PC-side shutdown trigger.
- Untested on real hardware; run steps 1–2 before relying on it.
