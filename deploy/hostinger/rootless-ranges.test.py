import contextlib
import io
import pathlib
import types
import unittest
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).with_name("rootless-setup.sh").read_text()
VALIDATOR = SCRIPT.split("<<'PYRANGES'\n", 1)[1].split("\nPYRANGES", 1)[0]


class RangeValidationTests(unittest.TestCase):
    def validate(self, rows, identifiers=(0, 1000, 2001, 65534)):
        users = [types.SimpleNamespace(pw_uid=value) for value in identifiers]
        groups = [types.SimpleNamespace(gr_gid=value) for value in identifiers]
        with (
            patch("sys.argv", ["validator", "crm-sandbox"]),
            patch("pathlib.Path.read_text", return_value=rows),
            patch("pwd.getpwnam", return_value=types.SimpleNamespace(pw_uid=2001)),
            patch("pwd.getpwall", return_value=users),
            patch("grp.getgrall", return_value=groups),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            exec(compile(VALIDATOR, "rootless-range-validator", "exec"), {})

    def test_separate_named_range_passes(self):
        self.validate("crm-sandbox:100000:65536\n")

    def test_numeric_account_owner_passes(self):
        self.validate("2001:100000:65536\n")

    def test_overlapping_allocation_fails(self):
        with self.assertRaisesRegex(SystemExit, "Overlapping allocation"):
            self.validate("crm-sandbox:100000:65536\nother:120000:65536\n")

    def test_numeric_owner_cannot_hide_unsafe_allocation(self):
        with self.assertRaisesRegex(SystemExit, "Unsafe sandbox allocation start"):
            self.validate("crm-sandbox:100000:65536\n2001:2000:65536\n")

    def test_assigned_host_identity_fails(self):
        with self.assertRaisesRegex(SystemExit, "host identity"):
            self.validate("crm-sandbox:100000:65536\n", identifiers=(0, 1000, 120001))

    def test_nonnumeric_allocation_fails(self):
        with self.assertRaisesRegex(SystemExit, "Invalid allocation syntax"):
            self.validate("crm-sandbox:one:65536\n")

    def test_short_allocation_fails(self):
        with self.assertRaisesRegex(SystemExit, "No usable sandbox allocation"):
            self.validate("crm-sandbox:100000:100\n")


if __name__ == "__main__":
    unittest.main()
