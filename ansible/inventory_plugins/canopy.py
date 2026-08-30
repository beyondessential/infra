"""Inventory for one deployment, read from canopy."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

from ansible.plugins.inventory import BaseInventoryPlugin
from ansible.utils.display import Display

DOCUMENTATION = r"""
name: canopy
short_description: Deployment inventory from canopy
description:
  - Reads one deployment's hosts and the variables that configure them from canopy.
  - A deployment is a canopy group at one rank, so a group holding more than one rank needs O(rank) as well.
  - Hosts are grouped by kind (C(central), C(facility), C(standalone)) and by product (C(tamanu), C(senaite), C(canopy)).
  - Each host is reached at its bound device's tailnet name, or at its recorded host where no device is bound.
  - A successful fetch is cached. If canopy cannot be reached the cache is used and a warning is printed; if canopy
    refuses the request the run stops, since a refusal is an answer and the cache would talk over it.
options:
  plugin:
    description: Marks this file as a canopy inventory source.
    required: true
    choices: [canopy]
  group:
    description: Name of the canopy server group holding the deployment. Give this or O(group_id).
    type: str
  group_id:
    description: Identifier of the canopy server group. Give this or O(group).
    type: str
  rank:
    description: Rank of the deployment within the group, such as C(production) or C(demo).
    type: str
  url:
    description: Base URL of canopy's operator interface.
    type: str
    env:
      - name: CANOPY_URL
  timeout:
    description: Seconds to wait for canopy before falling back to the cache.
    type: int
    default: 15
"""

EXAMPLES = r"""
# inventory/canopy/kamaka-prod.yml
plugin: canopy
group: kamaka
rank: production
"""

display = Display()

VALID_VAR_NAME = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def fatal(message):
    # An AnsibleError raised from an inventory plugin is downgraded to a warning
    # and leaves the run with an empty inventory, which reads as a play that
    # matched no hosts rather than as canopy declining to serve one.
    raise SystemExit(f"canopy inventory: {message}")


class InventoryModule(BaseInventoryPlugin):
    NAME = "canopy"

    def verify_file(self, path):
        return super().verify_file(path) and path.endswith((".yml", ".yaml"))

    def parse(self, inventory, loader, path, cache=True):
        super().parse(inventory, loader, path, cache)
        self._read_config_data(path)

        group = self.get_option("group")
        group_id = self.get_option("group_id")
        if bool(group) == bool(group_id):
            fatal(f"{path}: give exactly one of group or group_id")

        args = {"group": group} if group else {"server_group_id": group_id}
        rank = self.get_option("rank")
        if rank:
            args["rank"] = rank
        data = self._fetch(args, f"{group or group_id}-{rank}" if rank else group or group_id)

        for key, value in data["vars"].items():
            if VALID_VAR_NAME.match(key):
                inventory.set_variable("all", key, value)

        for host in data["hosts"]:
            name = host["name"]
            inventory.add_host(name)
            for group_name in (host["kind"], host["product"]):
                inventory.add_group(group_name)
                inventory.add_child(group_name, name)
            if host["address"]:
                inventory.set_variable(name, "ansible_host", host["address"])
            for key, value in host["vars"].items():
                # Canopy tags include dotted keys such as billing.product, which
                # are not addressable as Ansible variables.
                if VALID_VAR_NAME.match(key):
                    inventory.set_variable(name, key, value)

    def _fetch(self, args, key):
        cache_file = Path(
            os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"),
            "canopy-inventory",
            f"{re.sub(r'[^a-zA-Z0-9_.-]', '_', str(key))}.json",
        )

        if os.environ.get("CANOPY_INVENTORY_OFFLINE"):
            return self._cached(cache_file, "offline")

        url = self.get_option("url")
        if not url:
            fatal("set CANOPY_URL, or url in the source file")

        request = urllib.request.Request(
            f"{url.rstrip('/')}/api/inventory/for_group",
            data=json.dumps(args).encode(),
            headers={"content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.get_option("timeout")) as response:
                data = json.load(response)
        except urllib.error.HTTPError as err:
            fatal(f"canopy refused this inventory: {self._refusal(err)}")
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            return self._cached(cache_file, str(err))

        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(json.dumps(data))
        return data

    def _cached(self, cache_file, why):
        if not cache_file.exists():
            fatal(f"{why}, and nothing cached at {cache_file}")
        display.warning(f"canopy inventory: {why}, using {cache_file}, which may be out of date")
        return json.loads(cache_file.read_text())

    @staticmethod
    def _refusal(err):
        try:
            problem = json.load(err)
            return problem.get("detail") or problem.get("title") or err.reason
        except (json.JSONDecodeError, UnicodeDecodeError):
            return f"{err.code} {err.reason}"
