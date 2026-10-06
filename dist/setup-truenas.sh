#!/bin/sh
# TrueNAS SCALE setup (single file). Usage (run on the NAS):
#   sudo sh setup-truenas.sh <POOL> '<ssh public key from Windows installer>' [PC_IP]
set -eu
[ "$(id -u)" -eq 0 ] || exec sudo sh "$0" "$@"
POOL="${1:?usage: setup-truenas.sh <pool> '<pubkey>' [pc_ip]}"; PUBKEY="${2:?missing public key}"; PC_IP="${3:-10.0.0.14}"
NAS_IP="${NAS_IP:-10.0.0.15}"
D="/mnt/$POOL/scripts"
command -v rtcwake >/dev/null || { echo "rtcwake not found"; exit 1; }

echo "== 1/5 dataset + script"
zfs list "$POOL/scripts" >/dev/null 2>&1 || zfs create "$POOL/scripts"
cat > "$D/nas-sleep.sh" <<'NAS_SLEEP_EOF'
#!/bin/sh
# Runs on the NAS (as root). Powers the NAS down and arms an RTC alarm so it
# powers itself back on at WAKE_TIME. Called over SSH by the PC at shutdown.
set -eu

CONF="${NAS_SLEEP_CONF:-$(dirname "$(readlink -f "$0")")/nas-sleep.conf}"   # lives next to the script (survives TrueNAS updates)
[ -f "$CONF" ] || CONF=/etc/nas-sleep.conf
WAKE_TIME="08:00"      # local time to wake
MODE="off"             # off = full power-off + RTC wake, mem = suspend-to-RAM
GRACE=30               # seconds to wait so the SSH call returns / PC can abort
PC_HOST=""             # optional: if this host answers ping after GRACE, abort
INHIBIT=/var/run/nas-sleep.inhibit   # touch this file to keep the NAS awake
[ -f "$CONF" ] && . "$CONF"

log() { logger -t nas-sleep "$*"; echo "$*"; }

[ -e "$INHIBIT" ] && { log "inhibit file present, staying awake"; exit 0; }

now=$(date +%s)
target=$(date -d "today $WAKE_TIME" +%s)
if [ "$target" -gt "$now" ] && [ $((target - now)) -lt 900 ]; then
  log "wake time is <15 min away, staying awake"; exit 0
fi
[ "$target" -le "$now" ] && target=$(date -d "tomorrow $WAKE_TIME" +%s)

do_sleep() {
  sleep "$GRACE"
  if [ -n "$PC_HOST" ] && ping -c1 -W2 "$PC_HOST" >/dev/null 2>&1; then
    log "$PC_HOST is back up (restart?), aborting"; return
  fi
  [ -e "$INHIBIT" ] && { log "inhibit appeared, aborting"; return; }
  sync
  log "sleeping (mode=$MODE), waking at $(date -d @"$target")"
  if ! rtcwake -m "$MODE" --auto -t "$target"; then
    log "rtcwake failed - falling back to poweroff (needs Wake-on-LAN to return)"
    poweroff
  fi
}

# detach so the SSH session returns immediately
do_sleep </dev/null >/dev/null 2>&1 &
log "scheduled sleep in ${GRACE}s"
NAS_SLEEP_EOF
cat > "$D/nas-sleep.conf" <<EOF
WAKE_TIME="08:00"
MODE="off"
GRACE=30
PC_HOST="$PC_IP"
EOF
chmod 755 "$D/nas-sleep.sh"

echo "== 2/5 Wake-on-LAN on the NIC carrying $NAS_IP (persisted as post-init command)"
NIC=$(ip -o -4 addr show | awk -v ip="$NAS_IP" '$4 ~ "^"ip"/" {print $2}')
if [ -n "$NIC" ]; then
  ethtool -s "$NIC" wol g || echo "warning: ethtool wol failed on $NIC"
  midclt call initshutdownscript.create "{\"type\":\"COMMAND\",\"command\":\"ethtool -s $NIC wol g\",\"when\":\"POSTINIT\",\"enabled\":true,\"comment\":\"nas-sleep WoL\"}" >/dev/null || true
  echo "NIC=$NIC MAC=$(cat /sys/class/net/$NIC/address)"
else echo "warning: no NIC has $NAS_IP"; fi

echo "== 3/5 restricted user 'nassleep'"
if ! midclt call user.query '[["username","=","nassleep"]]' | grep -q nassleep; then
  KEYLINE="command=\"sudo $D/nas-sleep.sh\",restrict $PUBKEY"
  midclt call user.create "$(python3 - "$KEYLINE" "$D" <<'PY'
import json,sys
print(json.dumps({"username":"nassleep","full_name":"NAS sleep trigger","group_create":True,
 "password_disabled":True,"smb":False,"shell":"/usr/bin/bash","home":sys.argv[2]+"/nassleep-home","home_create":True,
 "sshpubkey":sys.argv[1],"sudo_commands_nopasswd":[sys.argv[2]+"/nas-sleep.sh"]}))
PY
)" >/dev/null && echo created || echo "FAILED: create user in UI instead (see nas/TRUENAS.md step 3)"
else echo "already exists"; fi

echo "== 4/5 enable SSH service"
midclt call service.update ssh '{"enable":true}' >/dev/null
midclt call service.control START ssh >/dev/null 2>&1 || true

echo "== 5/5 RTC wake capability"
rtcwake -m show --auto || true
echo
echo "Done. Verify RTC wake yourself ONCE (NAS will suspend ~60 s):  sudo rtcwake -m mem -s 60"
echo "Then test the whole chain from Windows:  ssh -i C:\\ProgramData\\nas-sleep\\id_ed25519 nassleep@$NAS_IP"
