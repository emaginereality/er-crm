#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ ${GITHUB_ACTIONS-} == true && ${RUNNER_ENVIRONMENT-} == github-hosted && ${RUNNER_OS-} == Linux ]] || fail 'This script requires a disposable GitHub-hosted Linux runner.'
[[ ${1-} == --apply-ci ]] || fail 'Use --apply-ci followed by the runner hostname.'
expected_hostname=${2:?Pass the runner hostname}
[[ $(id -u) == 0 ]] || fail 'Run through the authorized CI sudo step.'
[[ $(hostname) == "$expected_hostname" ]] || fail 'The server hostname does not match.'
[[ $(uname -m) == x86_64 ]] || fail 'This pinned runtime requires x86_64.'
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || fail 'This script requires Ubuntu 24.04.'
systemctl is-active --quiet docker || fail 'The existing Docker service is not active.'
systemctl is-active --quiet apparmor || fail 'AppArmor is not active. No changes are permitted.'
[[ $(sysctl -n kernel.apparmor_restrict_unprivileged_userns) == 1 ]] || fail 'System-wide user namespace restrictions are not active.'

rootful() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host unix:///var/run/docker.sock "$@"
}
[[ $(rootful info --format '{{.CgroupVersion}}') == 2 ]] || fail 'Cgroup v2 is required.'
rootful_version=$(rootful info --format '{{.ServerVersion}}')
rootful_id=$(rootful info --format '{{.ID}}')
rootful_pid=$(systemctl show docker.service --property MainPID --value)
rootful_start=$(systemctl show docker.service --property ActiveEnterTimestampMonotonic --value)
rootful_binary=$(command -v docker)
rootful_checksum=$(sha256sum "$rootful_binary")
prefix=/opt/crm-ci-docker-29.9.2
[[ ! -e "$prefix" && ! -L "$prefix" ]] || fail 'The CI runtime prefix already exists.'
[[ -r /sys/kernel/security/apparmor/profiles ]] || fail 'Loaded AppArmor profiles cannot be verified.'
! grep -q '^crm-ci-rootlesskit ' /sys/kernel/security/apparmor/profiles || fail 'A conflicting AppArmor profile exists.'
for command in curl tar dpkg-deb apparmor_parser; do
  command -v "$command" >/dev/null || fail "Missing runner prerequisite: $command."
done

account=crm-sandbox
account_id=2001
home=/var/lib/crm-sandbox
! getent passwd "$account" >/dev/null || fail 'The sandbox account already exists. Inspect it before any further setup.'
! getent passwd "$account_id" >/dev/null || fail 'UID 2001 is already in use.'
! getent group "$account" >/dev/null || fail 'The sandbox group already exists.'
! getent group "$account_id" >/dev/null || fail 'GID 2001 is already in use.'
[[ ! -e "$home" ]] || fail 'The proposed sandbox home already exists.'
[[ ! -e /run/user/2001 ]] || fail 'The proposed sandbox runtime directory already exists.'
[[ ! -e /var/lib/systemd/linger/crm-sandbox ]] || fail 'A previous sandbox linger configuration exists.'
! systemctl is-active --quiet user@2001.service || fail 'A user manager already runs for UID 2001.'
command -v python3 >/dev/null || fail 'Python 3 is required for subordinate-range validation.'
for path in /etc/skel/.config/systemd /etc/skel/.config/docker /etc/skel/.config/environment.d /etc/skel/.docker; do
  [[ ! -e $path ]] || fail 'The default home template contains unknown runtime configuration.'
done

apt-get update
packages=(uidmap dbus-user-session slirp4netns fuse-overlayfs)
simulation=$(LC_ALL=C apt-get --simulate --no-install-recommends --no-upgrade install "${packages[@]}")
if grep -q '^Remv ' <<< "$simulation"; then
  fail 'Package simulation removes existing packages. No installation is permitted.'
fi
while read -r package; do
  [[ -z $package ]] && continue
  status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
  [[ $status != 'install ok installed' ]] || fail "Package simulation changes installed package $package."
done < <(awk '/^Inst / {print $2}' <<< "$simulation")
printf '%s\n' "$simulation"
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get --yes --no-install-recommends --no-upgrade install "${packages[@]}"
install -d -m 0755 "$prefix" "$prefix/bin"
install -d -m 0700 "$prefix/downloads"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://download.docker.com/linux/static/stable/x86_64/docker-29.9.2.tgz \
  --output "$prefix/downloads/docker.tgz"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  'https://download.docker.com/linux/ubuntu/dists/noble/pool/stable/amd64/docker-ce-rootless-extras_29.9.2-1~ubuntu.24.04~noble_amd64.deb' \
  --output "$prefix/downloads/rootless-extras.deb"
printf '%s  %s\n' \
  9ac225999fd5e863f7694c728ef23d480616b1e5639328fa309befd4243d69eb "$prefix/downloads/docker.tgz" \
  19533f8712a28e0a16a052250a4a157eccebd2dbe710ed9c8b801c26688a100c "$prefix/downloads/rootless-extras.deb" | sha256sum --check --strict -
[[ $(dpkg-deb --field "$prefix/downloads/rootless-extras.deb" Package) == docker-ce-rootless-extras ]] || fail 'Unexpected rootless package name.'
[[ $(dpkg-deb --field "$prefix/downloads/rootless-extras.deb" Version) == '5:29.9.2-1~ubuntu.24.04~noble' ]] || fail 'Unexpected rootless package version.'
[[ $(dpkg-deb --field "$prefix/downloads/rootless-extras.deb" Architecture) == amd64 ]] || fail 'Unexpected rootless package architecture.'
tar --extract --gzip --file "$prefix/downloads/docker.tgz" --directory "$prefix/bin" --strip-components=1 --no-same-owner
dpkg-deb --extract "$prefix/downloads/rootless-extras.deb" "$prefix/downloads/extras"
for binary in dockerd-rootless.sh dockerd-rootless-setuptool.sh rootlesskit; do
  install -m 0755 "$prefix/downloads/extras/usr/bin/$binary" "$prefix/bin/$binary"
done
chown -R root:root "$prefix"
[[ $("$prefix/bin/docker" --version) == 'Docker version 29.9.2,'* ]] || fail 'The isolated Docker CLI version does not match.'
[[ $("$prefix/bin/dockerd" --version) == 'Docker version 29.9.2,'* ]] || fail 'The isolated Docker daemon version does not match.'
cat > "$prefix/rootlesskit.apparmor" <<'APPARMOR'
abi <abi/4.0>,
include <tunables/global>
profile crm-ci-rootlesskit /opt/crm-ci-docker-29.9.2/bin/rootlesskit flags=(unconfined) {
  userns,
}
APPARMOR
apparmor_parser --add "$prefix/rootlesskit.apparmor"

useradd --uid "$account_id" --user-group --create-home --home-dir "$home" --shell /usr/sbin/nologin "$account"
chmod 0700 "$home"
python3 - "$account" <<'PYRANGES'
import grp
import pathlib
import pwd
import sys

account = sys.argv[1]
account_owners = {account, str(pwd.getpwnam(account).pw_uid)}
for filename, assigned in [
    ("/etc/subuid", {item.pw_uid for item in pwd.getpwall()}),
    ("/etc/subgid", {item.gr_gid for item in grp.getgrall()}),
]:
    ranges = []
    for line in pathlib.Path(filename).read_text().splitlines():
        if not line.strip():
            continue
        fields = line.split(":")
        if len(fields) != 3 or not fields[1].isdigit() or not fields[2].isdigit():
            raise SystemExit(f"Invalid allocation syntax in {filename}.")
        owner, start, count = fields[0], int(fields[1]), int(fields[2])
        if count < 1 or start + count > 4294967295:
            raise SystemExit(f"Invalid allocation bounds in {filename}.")
        ranges.append((owner, start, start + count))
    selected = [row for row in ranges if row[0] in account_owners]
    if not selected or not any(end - start >= 65536 for _, start, end in selected):
        raise SystemExit(f"No usable sandbox allocation in {filename}.")
    for own in selected:
        _, start, end = own
        if start < 100000:
            raise SystemExit(f"Unsafe sandbox allocation start in {filename}.")
        if any(start <= identifier < end for identifier in assigned):
            raise SystemExit(f"Sandbox allocation overlaps a host identity in {filename}.")
        for other in ranges:
            if other is own:
                continue
            if max(start, other[1]) < min(end, other[2]):
                raise SystemExit(f"Overlapping allocation in {filename}.")
    print(f"Validated isolated sandbox allocation in {filename}.")
PYRANGES

loginctl enable-linger "$account"
systemctl start "user@$account_id.service"
runtime=/run/user/$account_id
as_sandbox() {
  runuser -u "$account" -- env -i HOME="$home" USER="$account" LOGNAME="$account" PATH="$prefix/bin:/usr/bin:/bin" XDG_RUNTIME_DIR="$runtime" DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus" "$@"
}
as_sandbox mkdir -p "$home/.config/systemd/user/docker.service.d"
as_sandbox tee "$home/.config/systemd/user/docker.service.d/identity.conf" >/dev/null <<SERVICE
[Service]
Environment=HOME=$home
Environment=USER=$account
Environment=LOGNAME=$account
Environment=XDG_RUNTIME_DIR=$runtime
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=$runtime/bus
SERVICE
as_sandbox systemctl --user daemon-reload
as_sandbox "$prefix/bin/dockerd-rootless-setuptool.sh" install --force
as_sandbox systemctl --user enable --now docker.service
systemctl set-property "user-$account_id.slice" MemoryMax=2G CPUQuota=100% TasksMax=512
socket=$runtime/docker.sock
[[ -S $socket ]] || fail 'The private rootless socket is absent.'
[[ $(stat -c '%u' "$socket") == "$account_id" ]] || fail 'The private socket has the wrong owner.'
socket_group=$(stat -c '%g' "$socket")
if [[ $socket_group != "$account_id" ]]; then
  awk -F: -v account="$account" -v account_id="$account_id" -v socket_group="$socket_group" '
    ($1 == account || $1 == account_id) && socket_group >= $2 && socket_group < $2 + $3 { found = 1 }
    END { exit !found }
  ' /etc/subgid || fail 'The private socket group is outside the isolated sandbox allocation.'
fi
case $(stat -c '%a' "$socket") in
  660|1660) ;;
  *) fail 'The private socket has unexpected permissions.' ;;
esac
security=$(as_sandbox docker --host "unix://$socket" info --format '{{json .SecurityOptions}}')
grep -q rootless <<< "$security" || fail 'The sandbox daemon does not report rootless mode.'
[[ $(as_sandbox docker --host "unix://$socket" info --format '{{.CgroupDriver}}') == systemd ]] || fail 'The sandbox daemon lacks systemd cgroup support.'
[[ $(as_sandbox docker --host "unix://$socket" version --format '{{.Client.Version}}/{{.Server.Version}}') == 29.9.2/29.9.2 ]] || fail 'The rootless client and daemon versions do not match.'
[[ $(rootful info --format '{{.ServerVersion}}') == "$rootful_version" ]] || fail 'The rootful Docker version changed.'
[[ $(rootful info --format '{{.ID}}') == "$rootful_id" ]] || fail 'The rootful Docker daemon identity changed.'
[[ $(systemctl show docker.service --property MainPID --value) == "$rootful_pid" ]] || fail 'The rootful Docker process changed.'
[[ $(systemctl show docker.service --property ActiveEnterTimestampMonotonic --value) == "$rootful_start" ]] || fail 'The rootful Docker start time changed.'
[[ $(sha256sum "$rootful_binary") == "$rootful_checksum" ]] || fail 'The rootful Docker CLI changed.'
[[ $(sysctl -n kernel.apparmor_restrict_unprivileged_userns) == 1 ]] || fail 'System-wide namespace restrictions changed.'
printf '\nRootless service is ready for sandbox verification.\n'
printf 'Account: %s; UID/GID: %s; socket GID: %s; private socket: %s\n' "$account" "$account_id" "$socket_group" "$socket"
printf 'No application secrets, SSH keys, published daemon ports, or sandbox containers are created.\n'
printf 'Isolated client and daemon: 29.9.2. Existing rootful version, identity, process, start time, and CLI checksum pass verification.\n'
printf 'This script executes no firewall or Traefik configuration command.\n'
printf 'The scoped AppArmor profile permits user namespaces only for the pinned CI RootlessKit path.\n'
