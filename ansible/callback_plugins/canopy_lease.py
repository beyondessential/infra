"""Hold canopy's run lease for as long as the play runs, then give it back."""

from __future__ import annotations

import http.client
import json
import os
import threading
import urllib.error
import urllib.request

from ansible.plugins.callback import CallbackBase

DOCUMENTATION = r"""
name: canopy_lease
type: aggregate
short_description: Hold and release canopy's run lease around a play
description:
  - The canopy inventory plugin takes the environment's run lease to read the inventory, which is
    what stops a second operator running on it at the same time. A lease is only worth holding for
    as long as the run lasts, and only this can see the run end.
  - Extends the lease while the play runs and releases it once the play is over.
  - Does nothing where the inventory came from anywhere but canopy.
requirements:
  - the canopy inventory plugin, which is what takes the lease
"""

LEASE_ENV = "CANOPY_INVENTORY_LEASE"

# Canopy's lease runs for 30 minutes. Extending well inside that leaves room
# for one attempt to be lost without the environment falling open mid-run.
# spec: LNXANS#inventory
EXTEND_EVERY = 8 * 60
TIMEOUT = 15


def _post(base, path, payload):
    request = urllib.request.Request(
        f"{base}/api/inventory/{path}",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        response.read()


class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = "aggregate"
    CALLBACK_NAME = "canopy_lease"
    CALLBACK_NEEDS_ENABLED = False

    def __init__(self):
        super().__init__()
        self._lease = None
        self._stop = threading.Event()
        self._keeper = None

    def v2_playbook_on_start(self, playbook):
        # Read here rather than in __init__: the inventory is parsed before the
        # callbacks are built, but nothing promises that, and a lease we never
        # saw taken is not ours to release.
        held = os.environ.get(LEASE_ENV)
        if not held or self._lease:
            return
        try:
            self._lease = json.loads(held)
        except json.JSONDecodeError:
            return
        self._keeper = threading.Thread(target=self._keep, args=(self._lease,), daemon=True)
        self._keeper.start()

    def v2_playbook_on_stats(self, stats):
        self._release()

    def _keep(self, lease):
        while not self._stop.wait(EXTEND_EVERY):
            try:
                _post(lease["url"], "extend_lease", {"lease_id": lease["lease_id"]})
            except (urllib.error.URLError, OSError, http.client.HTTPException) as err:
                # A refusal is canopy's answer and the lease is gone; a silence
                # is one lost attempt, and the next tick is still well inside.
                refused = isinstance(err, urllib.error.HTTPError) and err.code < 500
                self._display.warning(
                    f"canopy lease: could not extend {lease['lease_id']} ({err}); "
                    + (
                        "another operator may be able to take the environment before this run ends"
                        if refused
                        else f"trying again in {EXTEND_EVERY // 60} minutes"
                    )
                )
                if refused:
                    # Canopy has already said the lease is not ours to give back.
                    self._lease = None
                    return

    def _release(self):
        self._stop.set()
        if self._keeper:
            # An extend already in flight would otherwise land after the release.
            self._keeper.join(TIMEOUT + 1)
        lease = self._lease
        if not lease:
            return
        self._lease = None
        os.environ.pop(LEASE_ENV, None)
        try:
            _post(lease["url"], "release_lease", {"lease_id": lease["lease_id"]})
        except (urllib.error.URLError, OSError, http.client.HTTPException) as err:
            self._display.warning(
                f"canopy lease: could not release {lease['lease_id']} ({err}); "
                "it holds the environment until it expires"
            )
