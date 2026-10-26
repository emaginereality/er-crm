#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ ${1-} == --apply ]] || fail 'Use --apply followed by the approved VPS hostname.'
expected_hostname=${2:?Pass the approved VPS hostname}
[[ $(id -u) == 0 ]] || fail 'Run through the authorized root console.'
[[ $(hostname) == "$expected_hostname" ]] || fail 'The server hostname does not match.'
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || fail 'This script requires Ubuntu 24.04.'
systemctl is-active --quiet docker || fail 'The existing Docker service is not active.'
systemctl is-active --quiet apparmor || fail 'AppArmor is not active. No changes are permitted.'
[[ $(sysctl -n kernel.apparmor_restrict_unprivileged_userns) == 1 ]] || fail 'System-wide user namespace restrictions are not active.'

rootful() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host unix:///var/run/docker.sock "$@"
}
[[ $(rootful info --format '{{.CgroupVersion}}') == 2 ]] || fail 'Cgroup v2 is required.'
rootful_version=$(dpkg-query -W -f='${Version}' docker-ce 2>/dev/null) || fail 'Docker CE package provenance is required.'
rootful_cli_version=$(dpkg-query -W -f='${Version}' docker-ce-cli 2>/dev/null) || fail 'Docker CE CLI package provenance is required.'
rootful_id=$(rootful info --format '{{.ID}}')

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

existing_extras=$(dpkg-query -W -f='${Version}' docker-ce-rootless-extras 2>/dev/null || true)
[[ -z $existing_extras || $existing_extras == "$rootful_version" ]] || fail 'Installed rootless extras do not match Docker CE.'
apt-get update
packages=("docker-ce-rootless-extras=$rootful_version" uidmap dbus-user-session slirp4netns fuse-overlayfs)
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
DEBIAN_FRONTEND=noninteractive apt-get --yes --no-install-recommends --no-upgrade install "${packages[@]}"
[[ $(dpkg-query -W -f='${Version}' docker-ce) == "$rootful_version" ]] || fail 'Docker CE changed unexpectedly.'
[[ $(dpkg-query -W -f='${Version}' docker-ce-cli) == "$rootful_cli_version" ]] || fail 'Docker CE CLI changed unexpectedly.'
[[ $(rootful info --format '{{.ID}}') == "$rootful_id" ]] || fail 'The rootful Docker daemon identity changed.'
command -v dockerd-rootless-setuptool.sh >/dev/null || fail 'The supported rootless setup tool is absent.'

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
  runuser -u "$account" -- env -i HOME="$home" USER="$account" LOGNAME="$account" PATH=/usr/local/bin:/usr/bin:/bin XDG_RUNTIME_DIR="$runtime" DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus" "$@"
}
as_sandbox dockerd-rootless-setuptool.sh install --force
as_sandbox systemctl --user enable --now docker.service
systemctl set-property "user-$account_id.slice" MemoryMax=2G CPUQuota=100% TasksMax=512
socket=$runtime/docker.sock
[[ -S $socket ]] || fail 'The private rootless socket is absent.'
[[ $(stat -c '%u' "$socket") == "$account_id" ]] || fail 'The private socket has the wrong owner.'
[[ $(stat -c '%a' "$socket") == 660 ]] || fail 'The private socket has unexpected permissions.'
security=$(as_sandbox docker --host "unix://$socket" info --format '{{json .SecurityOptions}}')
grep -q rootless <<< "$security" || fail 'The sandbox daemon does not report rootless mode.'
[[ $(as_sandbox docker --host "unix://$socket" info --format '{{.CgroupDriver}}') == systemd ]] || fail 'The sandbox daemon lacks systemd cgroup support.'
[[ $(rootful info --format '{{.ID}}') == "$rootful_id" ]] || fail 'The rootful Docker daemon identity changed.'
[[ $(sysctl -n kernel.apparmor_restrict_unprivileged_userns) == 1 ]] || fail 'System-wide namespace restrictions changed.'
printf '\nRootless service is ready for sandbox verification.\n'
printf 'Account: %s; UID/GID: %s; private socket: %s\n' "$account" "$account_id" "$socket"
printf 'No application secrets, SSH keys, published daemon ports, or sandbox containers are created.\n'
printf 'Docker CE versions, daemon identity, and namespace restrictions pass verification.\n'
printf 'This script executes no firewall or Traefik configuration command.\n'
printf 'Service continuity requires separate runtime inspection.\n'
