"""The callback that keeps canopy's run lease while a play runs, and gives it back.

The callback is driven directly rather than through a play, because a play
would have to last longer than the extension interval to show an extension.
"""

import importlib.util
import json
import os
import time
import unittest
from pathlib import Path

from test_canopy_inventory import CALLBACKS, LEASE, StubCanopy

LEASE_ENV = "CANOPY_INVENTORY_LEASE"


def load_callback():
    spec = importlib.util.spec_from_file_location("canopy_lease_under_test", CALLBACKS / "canopy_lease.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class KeepingTheLease(unittest.TestCase):
    def setUp(self):
        self.callback = load_callback()
        self.addCleanup(os.environ.pop, LEASE_ENV, None)

    def hold(self, canopy):
        os.environ[LEASE_ENV] = json.dumps({"url": canopy.url, "lease_id": LEASE["id"]})
        module = self.callback.CallbackModule()
        module.v2_playbook_on_start(None)
        return module

    def test_it_extends_while_the_play_runs_and_releases_at_the_end(self):
        self.callback.EXTEND_EVERY = 0.05
        with StubCanopy() as canopy:
            module = self.hold(canopy)
            deadline = time.monotonic() + 10
            while "extend_lease" not in canopy.calls and time.monotonic() < deadline:
                time.sleep(0.01)
            module.v2_playbook_on_stats(None)
        self.assertEqual(canopy.calls[-1], "release_lease")
        self.assertEqual(canopy.calls.count("release_lease"), 1)
        self.assertEqual(
            set(canopy.paths), {"/api/ansible/extend_lease", "/api/ansible/release_lease"}
        )

    def test_it_extends_every_eight_minutes(self):
        self.assertEqual(self.callback.EXTEND_EVERY, 8 * 60)

    def test_it_does_nothing_where_no_lease_was_read(self):
        with StubCanopy() as canopy:
            module = self.callback.CallbackModule()
            module.v2_playbook_on_start(None)
            module.v2_playbook_on_stats(None)
        self.assertEqual(canopy.calls, [])

    def test_it_never_calls_the_old_paths(self):
        source = Path(CALLBACKS / "canopy_lease.py").read_text()
        self.assertNotIn("/api/inventory", source)


if __name__ == "__main__":
    unittest.main()
