#!/usr/bin/env bash
set -euo pipefail
[[ ${1:-} == --apply && ${2:-} == "$(hostname)" ]] || { printf 'Use --apply with the inspected hostname.\n' >&2; exit 1; }
[[ $(id -u) == 0 ]] || { printf 'Use the approved root console.\n' >&2; exit 1; }
[[ $(id -u crm-sandbox) == 2001 && $(id -g crm-sandbox) == 2001 ]] || exit 1
[[ -S /run/user/2001/docker.sock ]] || exit 1
[[ $(stat -c '%u' /run/user/2001/docker.sock) == 2001 ]] || exit 1
[[ ! -e /srv/crm ]] || { printf 'The resource parent already exists. Inspect it before a retry.\n' >&2; exit 1; }
install -d -m 0755 /srv/crm /srv/crm/apps /srv/crm/apps/agent /srv/crm/apps/agent/.eve
install -d -o 1000 -g 2001 -m 2750 /srv/crm/apps/agent/.eve/sandbox-cache
printf 'The empty, secret-free agent build resource directory is ready.\n'
