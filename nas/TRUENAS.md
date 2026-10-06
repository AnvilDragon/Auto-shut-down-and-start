# TrueNAS SCALE setup

TrueNAS is an appliance: `/etc`, `/usr/local`, `useradd` and `sudoers` edits are wiped by updates,
so everything is done through the UI and the script lives on a pool dataset.

1. **Script location** – create a dataset (e.g. `tank/scripts`), copy `nas-sleep.sh` and
   `nas-sleep.conf.example` (renamed `nas-sleep.conf`) into it, `chmod 755 nas-sleep.sh`.
   Edit the conf (`WAKE_TIME`, `PC_HOST`). Dataset must not be mounted `noexec`.
2. **BIOS** – enable *RTC Alarm / Resume by RTC* and *Wake on LAN*. Test from the TrueNAS shell:
   `sudo rtcwake -m mem -s 60` (resumes after a minute). Then `sudo rtcwake -m show --auto`.
3. **User** – Credentials ▸ Local Users ▸ Add: name `nassleep`, no password login,
   *Allowed sudo commands with no password*: `/mnt/tank/scripts/nas-sleep.sh`,
   shell `sh`/`bash`. In **SSH Public Key** paste the key from the PC installer,
   prefixed with `command="sudo /mnt/tank/scripts/nas-sleep.sh",restrict `.
4. **Services** ▸ enable **SSH** (start automatically).
5. **PC** – run the PC installer; the SSH command it sends is ignored in favour of the forced command.
   Test from the PC: `ssh -i <key> nassleep@<nas-ip>` – the NAS should power off after 30 s.
6. Keep the NAS awake while jobs run: `touch /var/run/nas-sleep.inhibit` (or add a pre-check
   in the script for replication/scrub if you use them overnight).

Notes: don't schedule scrubs/SMART tests/replication while the NAS is off; apps/VMs are stopped
cleanly by the OS shutdown that `rtcwake -m off` triggers.
