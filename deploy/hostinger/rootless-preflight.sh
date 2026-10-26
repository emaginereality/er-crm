#!/usr/bin/env bash
set -euo pipefail

expected_hostname=${1:?Pass the approved VPS hostname}
actual_hostname=$(hostname)
if [[ "$actual_hostname" != "$expected_hostname" ]]; then
  printf 'Wrong host: expected %s, observed %s.\n' "$expected_hostname" "$actual_hostname" >&2
  exit 1
fi
if [[ "$(id -u)" != 0 ]]; then
  printf 'The Hostinger console must use the authorized root account.\n' >&2
  exit 1
fi

printf '\nHOST\n'
printf '%s\n' "$actual_hostname"
cat /etc/os-release
printf '\nDOCKER\n'
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host unix:///var/run/docker.sock version --format 'Client {{.Client.Version}}; server {{.Server.Version}}'
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host unix:///var/run/docker.sock info --format 'Cgroups {{.CgroupVersion}}; driver {{.CgroupDriver}}; security {{json .SecurityOptions}}'
printf '\nPACKAGES\n'
dpkg-query -W -f='${Package} ${Version}\n' docker-ce docker-ce-cli docker-ce-rootless-extras uidmap dbus-user-session slirp4netns fuse-overlayfs 2>/dev/null || true
printf '\nROOTLESS BINARIES\n'
for command in dockerd-rootless-setuptool.sh rootlesskit newuidmap newgidmap; do
  command -v "$command" || true
done
printf '\nPROPOSED SERVICE ACCOUNT\n'
getent passwd crm-sandbox || true
getent passwd 2001 || true
getent group crm-sandbox || true
printf '\nEXISTING SUBORDINATE RANGES\n'
cat /etc/subuid /etc/subgid
printf '\nAPPARMOR\n'
sysctl kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || true
systemctl is-active apparmor.service || true
printf '\nKVM\n'
if [[ -c /dev/kvm ]]; then
  stat -c '%n %a %U %G' /dev/kvm
else
  printf 'No KVM device.\n'
fi
printf '\nCAPACITY\n'
free -h
df -h / /var/lib/docker
printf '\nRead-only preflight complete. No host configuration changed.\n'
