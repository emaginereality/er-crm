import os
import pathlib
import subprocess
import unittest

DIRECTORY = pathlib.Path(__file__).parent
SCRIPT = DIRECTORY / "rootless-ci-setup.sh"
SOURCE = SCRIPT.read_text()
HOST_SOURCE = (DIRECTORY / "rootless-setup.sh").read_text()


def section(source, start, end):
    return source.split(start, 1)[1].split(end, 1)[0]


class RootlessCiTests(unittest.TestCase):
    def test_refuses_non_github_environments_before_any_host_action(self):
        environment = dict(os.environ)
        for name in ["GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "RUNNER_OS"]:
            environment.pop(name, None)
        result = subprocess.run(
            ["bash", str(SCRIPT), "--apply-ci", "unused"],
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires a disposable GitHub-hosted Linux runner", result.stderr)

    def test_range_validation_matches_reviewed_host_setup(self):
        self.assertEqual(
            section(SOURCE, "<<'PYRANGES'\n", "\nPYRANGES"),
            section(HOST_SOURCE, "<<'PYRANGES'\n", "\nPYRANGES"),
        )

    def test_socket_validation_matches_reviewed_host_setup(self):
        self.assertEqual(
            section(SOURCE, "socket_group=$(stat", "security=$(as_sandbox"),
            section(HOST_SOURCE, "socket_group=$(stat", "security=$(as_sandbox"),
        )

    def test_profile_is_scoped_to_the_root_owned_binary(self):
        self.assertEqual(
            section(SOURCE, "<<'APPARMOR'\n", "\nAPPARMOR"),
            "abi <abi/4.0>,\ninclude <tunables/global>\n"
            "profile crm-ci-rootlesskit /opt/crm-ci-docker-29.9.2/bin/rootlesskit flags=(unconfined) {\n"
            "  userns,\n}",
        )

    def test_static_and_package_downloads_have_verified_pins(self):
        self.assertIn(
            "9ac225999fd5e863f7694c728ef23d480616b1e5639328fa309befd4243d69eb", SOURCE
        )
        self.assertIn(
            "19533f8712a28e0a16a052250a4a157eccebd2dbe710ed9c8b801c26688a100c", SOURCE
        )
        self.assertIn("sha256sum --check --strict -", SOURCE)
        self.assertIn("29.9.2/29.9.2", SOURCE)

    def test_private_service_environment_is_set_before_install(self):
        expected = """[Service]
Environment=HOME=$home
Environment=USER=$account
Environment=LOGNAME=$account
Environment=XDG_RUNTIME_DIR=$runtime
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=$runtime/bus"""
        self.assertEqual(section(SOURCE, "<<SERVICE\n", "\nSERVICE"), expected)
        self.assertIn('as_sandbox mkdir -p "$home/.config/systemd/user/docker.service.d"', SOURCE)
        self.assertIn('as_sandbox tee "$home/.config/systemd/user/docker.service.d/identity.conf"', SOURCE)
        self.assertLess(SOURCE.index("<<SERVICE"), SOURCE.index('dockerd-rootless-setuptool.sh" install'))
        self.assertIn('runtime=/run/user/$account_id', SOURCE)

    def test_shell_syntax(self):
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True)


if __name__ == "__main__":
    unittest.main()
