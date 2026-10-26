# Hostinger staging preparation

## Status and boundary

This is a staging foundation, not a complete CRM deployment.
It builds the web application and API, then prepares private PostgreSQL storage.
The optional agent overlay builds and starts the native Eve agent.
Native AI acceptance remains blocked until the rootless agent workflow and host sandbox checks pass.
Do not report this foundation as an AI-ready CRM.

The staging project uses synthetic CRM records only.
Production needs a separate database, password, application secrets, and storage volumes.
Do not point this project at production storage.
Do not merge or deploy production as part of staging setup.

The files contain no real credentials.
Creating the Compose project generates persistent staging credentials.
Get explicit approval before that action.
Get separate approval for Google mailbox consent and any paid model call.

## Services and boundaries

| Service | Purpose | Public exposure |
| --- | --- | --- |
| `secrets-init` | Generate missing server-only secret files once | None; network disabled |
| `postgres` | Store staging records in `crm_staging` | None; no host port |
| `migrate` | Apply committed Prisma migrations | None; exits after migration |
| `api` | Serve authenticated CRM API requests | Only auth and tRPC paths through Traefik |
| `app` | Serve the sign-in page and session-protected CRM | Approved staging hostname through Traefik |

The host firewall stays unchanged.
The existing Traefik service stays unchanged.
This template requires the inspected host-network Traefik deployment.
A bridge-network Traefik deployment needs an explicitly shared proxy network instead.
No service receives the host Docker socket, host networking, or privileged mode.
The application and API drop Linux capabilities and block privilege escalation.
The database and secret files use named volumes.
The application receives no provider encryption key.
The API receives the provider encryption key for admin key storage.

The backend network permits outbound traffic for OAuth and application requests.
It does not publish database ports.
This network is not the future agent sandbox network.
Future sandbox sessions require a separate deny-all network boundary.

## Exact source and build

Set `CRM_SOURCE_SHA` to the full reviewed commit in the public fork.
Use a commit that includes the dependency fixes and these deployment files.
Never use a moving branch as the deployment source.

Docker fetches that Git commit and builds `deploy/hostinger/Dockerfile`.
The image uses Bun 1.4.0 and Node 24.22.1.
The Node image also pins its verified multi-architecture digest.
Eve 0.69 requires Node 24 or newer.
The image runs application processes as the non-root `node` user.
The build uses public dummy values, not runtime credentials.
Those dummy values exist only in build commands.
Runtime startup loads real values from the private secret volumes.

Run this on a host with Docker before deployment:

```sh
docker build \
  --file deploy/hostinger/Dockerfile \
  --build-arg STAGING_ORIGIN=https://staging.example.com \
  --tag crm-staging:reviewed .
node --test deploy/hostinger/bootstrap.test.mjs
```

Use the final staging origin for the real build.
Next.js embeds the public API origin during its build.
Changing that origin requires a rebuild.

## Hostinger execution path

The Hostinger connector supports these operations:

1. Read `vps_virtual-machines_get` for the approved VPS.
2. Read `vps_docker_list` and confirm `crm-staging` does not already exist.
3. Confirm the existing Traefik service uses host networking before introducing these routes.
4. Get approval for secret generation, staging publication, and the selected hostname.
5. Confirm the staging DNS record points to the approved VPS.
6. Set the non-secret deployment inputs in Hostinger Docker Manager.
7. Enter Google credentials directly in the authenticated Hostinger interface.
8. Call `vps_docker_create` with the approved Compose content and project name `crm-staging`.
9. Read `vps_docker_list`, `vps_docker_containers`, and `vps_docker_logs` until startup reaches a terminal result.
10. Verify TLS, redirects, health, migrations, and unauthorized access before any sign-in.

The connector uses `params` for operation inputs.
The create operation accepts `virtualMachineId`, `project_name`, `content`, and optional `environment`.
It accepts raw Compose content or a raw file URL.
A repository URL alone resolves a default Compose path and branch.
Use the explicit reviewed Compose content instead.

The create operation replaces an existing project with the same name.
Read the current state before each use.
Replacement needs approval and a rollback plan.
Do not delete volumes for a retry.

The Docker Manager environment needs:

| Input | Value |
| --- | --- |
| `CRM_SOURCE_SHA` | Full reviewed commit SHA |
| `STAGING_HOSTNAME` | Approved staging hostname only |
| `ALLOWED_SIGN_IN` | Approved single email address only |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Corresponding client secret |

Leave both Google fields unset until credential setup is authorized.
Half of a Google credential pair fails closed.
No configured identity provider means no user can sign in.
This is a blocker, not an authentication bypass.

`vps_docker_get` returns environment values.
Do not log its full response after credentials exist.
The generated application secrets never enter the Compose environment string.
Do not echo secret files or copy them into Git, chat, logs, or build arguments.

## Generated secrets

The initializer generates 32 random bytes per secret.
It creates missing values only and rejects invalid existing files.
It uses mode `0700` for directories and `0400` for files.
The test suite uses deterministic fixtures, then removes them.

| Named volume | Runtime value | Purpose |
| --- | --- | --- |
| `database-secret` | PostgreSQL password | Access to the isolated staging database |
| `auth-secret` | `BETTER_AUTH_SECRET` | Session and authentication security |
| `bridge-secret` | `AGENT_BRIDGE_SECRET` | Signed application-to-agent requests |
| `provider-secret` | `AI_PROVIDER_ENCRYPTION_KEY` | Encrypt saved OpenAI and Anthropic keys |
| `chat-secret` | `CHAT_EVENT_ENCRYPTION_KEY` | Encrypt builder chat events |

The database password uses hexadecimal encoding for safe URL construction.
The other values use base64 encoding.
Back up secret volumes separately from database backups before storing valuable data.
Do not rotate the database password by deleting its volume.
An initialized database retains its existing password.

MCP connections and sync cron remain unconfigured.
`MCP_ENCRYPTION_KEY` and `CRON_SECRET` stay unset.
No scheduled mailbox sync or optional integration grant is authorized by this template.

## Google consent

The current CRM requests these permissions:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/calendar.readonly`

It requests offline access for refresh tokens.
Google login without mailbox permissions does not unlock the current CRM flow.
Do not change authentication to bypass that consent decision.

Create a Google OAuth Web Application client in the approved Google project.
Enable Gmail API and Google Calendar API only after approval.
Use the approved consent audience and test account.
The approved account remains the only address in `ALLOWED_SIGN_IN`.

Set the authorized redirect URI to:

```text
https://<staging-hostname>/api/auth/callback/google
```

Use the staging origin for `APP_URL` and `API_URL`.
No second API hostname or broad cookie domain is required.
The user reviews Google consent directly.
Consent stores the granted login and refresh credentials; it is separate from running a sync.
The current sign-in hook does not fetch mailbox or calendar contents.
The authenticated connection page's “Check now” action starts a sync.
The internal cron endpoint also starts sync, but staging leaves `CRON_SECRET` unset.
The staging proxy does not expose internal sync routes.
Do not click “Check now” or import real mailbox data during synthetic-record validation.

After the agent passes verification, the user enters provider keys in Settings → General over HTTPS.
Saving a key does not authorize a paid model call.
The explicit connection test checks provider authentication, not billing or model access.
Approve the selected account, model, and cost limit before a real generation test.

## Full-agent sandbox plan

The target is the complete native CRM agent, not a disabled-agent replacement.
The current repository declares sandboxes for the root, builder, and runner agents.
Eve eagerly prepares their environments during `eve build`.
The prepared artifacts must remain available to the production runtime.

Prefer a separate rootless Docker daemon on the VPS under a dedicated non-login service account.
This requires explicit approval for host changes and supported shell or console access.
Keep Ubuntu AppArmor restrictions active.
Prefer the packaged rootless extras and the scoped RootlessKit AppArmor profile.
Do not disable unprivileged namespace restrictions system-wide.
Do not stop or replace the existing rootful Docker daemon.
The Hostinger connector does not expose a terminal command operation.
Do not simulate one through privileged Compose containers or host filesystem mounts.

Start with the read-only console preflight:

```sh
bash deploy/hostinger/rootless-preflight.sh <approved-vps-hostname>
```

It checks identity, packages, namespaces, cgroups, capacity, and the proposed service account.
It does not install packages or change host settings.
Stop on an unexpected hostname or existing conflicting service account.
Choose a sandbox UID distinct from the application container UID `1000`.
Use UID `2001` only after confirming that it is unused.
Keep the service account password locked and its shell set to `nologin`.
Grant no SSH key, sudo access, or membership in the host Docker group.

`rootless-setup.sh` is a guarded first-run script for the approved console.
It refuses an existing account, home, runtime directory, or service configuration.
A partial failure requires inspection before any retry.
It does not overwrite an unknown account to achieve idempotency.
It previews packages and refuses changes to installed packages.
It validates subordinate identity ranges before starting the user service.
It creates no SSH key, application credential, sandbox container, or published daemon port.
Do not execute it before host-specific review and explicit setup approval.

The approved host setup must provide:

1. `uidmap` and rootless Docker prerequisites.
2. Separate subordinate UID and GID ranges for the sandbox account.
3. A user systemd service and persistence after logout.
4. A private Unix socket for only the sandbox daemon.
5. Private persistent sandbox storage, with no application secrets.
6. A shared resource path visible at the same path to Eve and the sandbox daemon.
7. Verified cgroup support and resource limits.
8. A full Eve build against that daemon, then a production start against the same artifacts.
9. Persistent Eve workflow state under `.eve/.workflow-data`.
10. Verified deny-all egress and absence of database credentials inside every sandbox.

Do not mount `/var/run/docker.sock` into the agent.
Docker documents rootless Docker-in-Docker with privileged mode.
That mode is not approved here.
Microsandbox requires Linux KVM access, which is unverified on the selected VPS.
Just-bash has no native process or network isolation.
Do not substitute it silently for the declared isolation boundary.

Eve supports `defaultTools: false` and individual `disableTool()` declarations.
Those settings do not remove declared sandbox preparation.
`--skip-sandbox-prewarm` produces output that is not a verified deployable agent.
Neither option constitutes the requested native AI acceptance test.

References:

- [Docker rootless requirements](https://docs.docker.com/engine/security/rootless/)
- [Rootless Docker-in-Docker restrictions](https://docs.docker.com/engine/security/rootless/tips/)
- Installed Eve docs: `docs/guides/deployment/self-hosting.md`
- Installed Eve docs: `docs/sandbox/default.mdx`, `docker.mdx`, `microsandbox.mdx`, and `just-bash.mdx`

## Acceptance gates

The `Staging image` workflow runs a disposable Docker foundation smoke test.
It uses synthetic ephemeral credentials and no published host ports.
It removes its containers and volumes after every run.
It checks migrations, service health, anonymous denial, redirects, and secret-file permissions.
It does not test Google consent or the complete agent.

The following gates remain mandatory:

1. Full Docker build succeeds on the exact reviewed commit.
2. Migrations complete against staging only.
3. PostgreSQL, API, and application health checks pass.
4. No database or administrative service listens publicly.
5. HTTPS works for the approved staging hostname.
6. Unauthenticated and non-allowed users cannot read or mutate CRM records.
7. Google sign-in works only after the user approves consent.
8. Synthetic create, read, update, and delete flows pass.
9. Provider keys remain encrypted, masked, and absent from logs and client responses.
10. Rootless sandbox build, persistence, resource limits, and deny-all egress pass.
11. Full agent health, bridge authorization, and workflow resumption pass.
12. An explicitly approved native AI call succeeds within its cost limit.
13. Restart preserves records, encrypted keys, and agent history.
14. Rollback and offsite backup restoration pass before production approval.

## Issues

1. NOT DONE — Docker build and runtime tests have not run on Hostinger.
   Fix: complete approvals, then build and verify the exact source commit.
2. NOT DONE — This Compose foundation has no agent service.
   Fix: approve and verify the separate rootless sandbox route before adding the agent.
3. NOT DONE — Google credentials and consent are pending.
   Fix: configure the approved OAuth client and review the requested scopes.
4. NOT DONE — No paid AI call is authorized or executed.
   Fix: approve the provider account, model, and test cost limit.
5. UNKNOWN — Named-volume ownership and final routing require Docker runtime verification.
   Fix: inspect container startup and complete the acceptance gates before release.

## Native agent overlay

Use `compose.yaml` together with `compose.agent.yaml` only after rootless runtime verification.
The overlay requires `CRM_SANDBOX_SOCKET_GID`, copied from the verified host socket metadata.
This is a container-only supplementary group, not a host account membership change.
Docker can map its socket group into the dedicated subordinate GID range.
The socket can retain mode `1660`; its sticky bit is expected on this Docker release.
Never widen its permissions or the parent runtime directory.

The approved console must run the reviewed `resource-setup.sh` once.
It creates only `/srv/crm/apps/agent/.eve`, with UID1000, GID2001, and mode2750.
It refuses an existing parent instead of replacing unknown data.
The path carries compiled, non-secret sandbox resources during the build.
Eve and its rootless daemon see the same absolute resource path.
The build service mounts no database, authentication, provider, or chat secret volume.

`agent-build` runs a complete `eve build` against the private daemon.
It does not skip sandbox preparation.
The root, builder, and runner explicitly select Docker with deny-all live networking.
A Docker failure cannot select microsandbox or just-bash in this mode.
Eve prepares trusted template images with temporary outbound access.
Live session containers start with network mode `none`.
The framework sandbox image remains `ghcr.io/vercel/eve:0.69.0`.
The application image pins Node24.22.1 and the Docker29.9.2 CLI digest.

The runtime receives its generated output through a source-specific named volume.
Its separate named state volume persists `.eve/.workflow-data`.
Only the agent and its build service receive the private rootless socket.
Neither receives the host rootful Docker socket.
Session sandboxes receive neither socket nor application secret mounts or environment values.
The agent has no public route or published port.
The app and API reach it on the private backend network with existing bridge authentication.

The rootless agent workflow uses a disposable runner account and synthetic secrets.
It builds all three prepared environments, checks native provider execution and resume,
and verifies no sandbox network, host mounts, application credentials, or anonymous agent access.
It invokes no model and provides no real integration credentials.
It removes Compose resources, the rootless account, and resource files after the test.
A passing workflow is not a browser sign-in, CRM record flow, or paid AI acceptance test.

A daemon restart replaces its Unix socket inode.
Recreate the agent containers after that restart; restarting their processes alone is insufficient.
Host reboot ordering and recovery remain explicit staging acceptance checks.
Do not delete state, database, or secret volumes during recovery.

## Disposable CI runtime

`rootless-ci-setup.sh` is restricted to GitHub-hosted Ubuntu24.04 x86_64 runners.
It does not replace `rootless-setup.sh` on the VPS.
The runner keeps its existing rootful Docker service and CLI.
The test extracts Docker29.9.2 into the fresh, root-owned `/opt/crm-ci-docker-29.9.2` prefix.
Only the dedicated account's clean PATH selects those binaries.
The script verifies both rootless client and daemon versions.
It also verifies the original rootful version, identity, process, start timestamp, and CLI checksum.

The runtime uses these checked artifacts:

| Artifact | Official source | SHA256 |
| --- | --- | --- |
| Docker29.9.2 static x86_64 archive | [Docker static archive](https://download.docker.com/linux/static/stable/x86_64/docker-29.9.2.tgz) | `9ac225999fd5e863f7694c728ef23d480616b1e5639328fa309befd4243d69eb` |
| Matching Ubuntu noble rootless extras | [Docker rootless package](https://download.docker.com/linux/ubuntu/dists/noble/pool/stable/amd64/docker-ce-rootless-extras_29.9.2-1~ubuntu.24.04~noble_amd64.deb) | `19533f8712a28e0a16a052250a4a157eccebd2dbe710ed9c8b801c26688a100c` |

The static archive checksum was calculated from Docker's HTTPS download on 2026-10-26.
The rootless package checksum also matches Docker's signed Ubuntu noble repository metadata.
The verified release key fingerprint is `9DC858229FC7DD38854AE2D88D81803C0EBFCD88`.
The package name, architecture, and version receive separate checks before extraction.
No Docker package is installed, upgraded, or removed through apt.
Missing Ubuntu rootless prerequisites receive the existing no-upgrade and no-removal guards.

A temporary AppArmor profile permits user namespaces for the exact pinned RootlessKit executable path.
This follows Docker's [Ubuntu24.04 rootless guidance](https://docs.docker.com/engine/security/rootless/troubleshoot/).
The profile is a scoped namespace permission, not a claim of additional container AppArmor confinement.
Global namespace restrictions and AppArmor remain active.
The workflow unloads this profile and removes the isolated prefix during cleanup.
It does not restart AppArmor or change system-wide namespace settings.

Docker recommends [static binaries for testing](https://docs.docker.com/engine/install/binaries/), not unattended production updates.
The VPS continues using its inspected, matching Docker CE packages.
Failure diagnostics retain at most 200 log lines from each native agent service before disposable cleanup.


The agent process starts with the pinned Node runtime, not Bun's Node-compatibility layer.
The sandbox probe also attempts TCP access to a reserved documentation address and requires failure.
The runner restarts only its private daemon, then recreates the agent to bind the new socket inode.
A synthetic state marker and sandbox resume checks verify storage and socket recovery.
This does not verify a paid model turn or complete workflow resumption.


## Staging cost-control pause

The agent overlay sets `CRM_BACKGROUND_DISPATCH_PAUSED=1`.
It pauses scheduled background work and all three authenticated dispatch routes.
It also blocks structured queued task, builder, and run targets through the CRM channel.
Queued rows remain stored. The pause does not delete records or cancel existing sessions.
The authenticated dispatch health response reports `paused: true`.
Native interactive chat and its tools remain available; authentication stays unchanged.
Background workflow acceptance remains incomplete until an explicitly approved unpause test.

Before secure provider-key entry, obtain the user's provider, model, test-scope, and budget approval.
Inspect queued work and active sessions first. Do not clear a queue silently.
A working key can enable already-running sessions; the pause does not cancel those sessions.
Keep background dispatch paused during an approved single interactive AI test.
Key storage alone does not authorize paid processing or backlog execution.
All automated staging tests omit real provider keys and make no model call.
