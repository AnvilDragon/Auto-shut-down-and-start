#!/bin/sh
# Run as root on the NAS:  ./install.sh "<PC public key line>"
# Creates a locked-down 'nassleep' user that can only trigger nas-sleep.sh.
set -eu
PUBKEY="${1:?usage: install.sh \"ssh-ed25519 AAAA... comment\"}"
DIR=$(dirname "$0")
install -m 0755 "$DIR/nas-sleep.sh" /usr/local/sbin/nas-sleep.sh
[ -f /etc/nas-sleep.conf ] || install -m 0644 "$DIR/nas-sleep.conf.example" /etc/nas-sleep.conf
id nassleep >/dev/null 2>&1 || useradd -m -s /bin/sh nassleep
echo "nassleep ALL=(root) NOPASSWD: /usr/local/sbin/nas-sleep.sh" > /etc/sudoers.d/nas-sleep
chmod 440 /etc/sudoers.d/nas-sleep
H=/home/nassleep/.ssh; mkdir -p "$H"
echo "command=\"sudo /usr/local/sbin/nas-sleep.sh\",restrict $PUBKEY" > "$H/authorized_keys"
chown -R nassleep: "$H"; chmod 700 "$H"; chmod 600 "$H/authorized_keys"
echo "Installed. Edit /etc/nas-sleep.conf, then test: rtcwake -m show --auto"
