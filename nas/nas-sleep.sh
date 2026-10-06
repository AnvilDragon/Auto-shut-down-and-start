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
