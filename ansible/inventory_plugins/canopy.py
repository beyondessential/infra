"""Inventory for one deployment, read from canopy."""

from __future__ import annotations

import hashlib
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
  - The run names the deployment through C(CANOPY_GROUP) or C(CANOPY_GROUP_ID) and C(CANOPY_RANK), so one
    committed source file serves every deployment and the repo lists none of them.
  - Hosts are grouped by kind (C(central), C(facility), C(standalone)) and by product (C(tamanu), C(senaite), C(canopy)).
  - Each host is reached at its bound device's tailnet name, or at its recorded host where no device is bound.
  - Reading an inventory needs canopy administrator access, since it carries the deployment's secret variables.
  - A successful fetch is cached, minus every secret value. A run falling back to that cache warns which variables
    are unset, so a play needing one fails on it rather than acting on a stale value.
  - If canopy cannot be reached the cache is used and a warning is printed; if canopy refuses the request the run
    stops, since a refusal is an answer and the cache would talk over it.
  - An C(upgrade) of a production deployment is refused unless the group has an open upgrade plan, and
    never runs from the cache, since that plan is what canopy is being asked.
options:
  plugin:
    description: Marks this file as a canopy inventory source.
    required: true
    choices: [canopy]
  group:
    description: Name of the canopy server group holding the deployment. Give this or O(group_id).
    type: str
    env:
      - name: CANOPY_GROUP
  group_id:
    description: Identifier of the canopy server group. Give this or O(group).
    type: str
    env:
      - name: CANOPY_GROUP_ID
  rank:
    description: Rank of the deployment within the group, such as C(production) or C(demo).
    type: str
    env:
      - name: CANOPY_RANK
  intent:
    description:
      - What the run is doing to the deployment. Canopy refuses an C(upgrade) of a
        production deployment unless the group has an open upgrade plan, and an
        upgrade never runs from the cache, since that plan is what canopy is being asked.
    type: str
    choices: [configure, upgrade]
    default: configure
    env:
      - name: CANOPY_INTENT
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
# inventory/canopy.yml, with `inventory_plugins = ./inventory_plugins` in the
# ansible.cfg the run picks up, and ansible run from the ansible/ directory:
#   CANOPY_GROUP=kamaka CANOPY_RANK=production ansible-playbook -i inventory/canopy.yml tamanu-upgrade.yml
plugin: canopy

# A source file may name the deployment itself, kept outside the repo.
plugin: canopy
group: kamaka
rank: production
"""

display = Display()

VALID_VAR_NAME = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def without_secret_values(data):
    """The payload with every secret value dropped and the names left in place.

    Canopy serves a secret value to the run that asked for it; the cache is a
    plaintext file that outlives the run.
    """

    def plain(vars_, names):
        return {key: value for key, value in vars_.items() if key not in names}

    hosts = []
    for host in data["hosts"]:
        names = set(host.get("secret_vars") or [])
        hosts.append(
            dict(
                host,
                vars=plain(host["vars"], names),
                own_vars=plain(host.get("own_vars", {}), names),
            )
        )
    return dict(
        data,
        vars=plain(data["vars"], set(data.get("secret_vars") or [])),
        hosts=hosts,
    )


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # urllib turns a redirected POST into a bodiless GET, which canopy
        # answers with a 405 that reads as a refusal.
        fatal(f"{req.full_url} redirects to {newurl}; point CANOPY_URL at canopy itself")


def fatal(message):
    # Ansible downgrades an AnsibleError here to a warning over an empty inventory.
    raise SystemExit(f"canopy inventory: {message}")


class InventoryModule(BaseInventoryPlugin):
    NAME = "canopy"

    def verify_file(self, path):
        return super().verify_file(path) and path.endswith((".yml", ".yaml"))

    def parse(self, inventory, loader, path, cache=True):
        super().parse(inventory, loader, path, cache)
        self._read_config_data(path)
        try:
            self._populate(inventory)
        except Exception as err:
            fatal(f"{path}: {type(err).__name__}: {err}")

    def _populate(self, inventory):
        group = self.get_option("group")
        group_id = self.get_option("group_id")
        if bool(group) == bool(group_id):
            fatal("give exactly one of group or group_id, in the source file or as CANOPY_GROUP or CANOPY_GROUP_ID")

        args = {"group": group} if group else {"server_group_id": group_id}
        rank = self.get_option("rank")
        if rank:
            args["rank"] = rank
        if self.get_option("intent") == "upgrade":
            args["intent"] = "upgrade"

        # The readable half of the name can collide (a group named kamaka at
        # rank production, against a group named kamaka-production), so the
        # digest of the request is what actually distinguishes the file.
        label = re.sub(r"[^a-zA-Z0-9_.-]", "_", str(group or group_id))
        digest = hashlib.sha256(json.dumps(args, sort_keys=True).encode()).hexdigest()[:12]
        cache_file = Path(
            os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache",
            "canopy-inventory",
            f"{label}-{digest}.json",
        )
        data, fresh = self._fetch(args, cache_file)
        if not fresh:
            self._warn_withheld(data)

        for key, value in data["vars"].items():
            if VALID_VAR_NAME.match(key):
                inventory.set_variable("all", key, value)

        seen = set()
        for host in data["hosts"]:
            name = host["name"]
            if name in seen:
                fatal(f"canopy serves two servers named {name!r}; one would stand in for both")
            seen.add(name)
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

        # Only a payload ansible has made an inventory out of is worth keeping
        # for the offline path, and only the half of it that may be written down.
        if fresh:
            self._store(cache_file, without_secret_values(data))

    def _fetch(self, args, cache_file):
        if os.environ.get("CANOPY_INVENTORY_OFFLINE"):
            return self._fallback(args, cache_file, "offline"), False

        url = self.get_option("url")
        if not url:
            fatal("set CANOPY_URL, or url in the source file")

        request = urllib.request.Request(
            f"{url.rstrip('/')}/api/inventory/for_group",
            data=json.dumps(args).encode(),
            headers={"content-type": "application/json"},
        )
        opener = urllib.request.build_opener(NoRedirect)
        try:
            with opener.open(request, timeout=self.get_option("timeout")) as response:
                return json.load(response), True
        except urllib.error.HTTPError as err:
            if 400 <= err.code < 500:
                fatal(f"canopy refused this inventory: {self._refusal(err)}")
            return self._fallback(args, cache_file, f"canopy answered {err.code} {err.reason}"), False
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            return self._fallback(args, cache_file, str(err)), False

    def _fallback(self, args, cache_file, why):
        # The cache cannot carry canopy's say-so on an upgrade of production.
        if args.get("intent") == "upgrade":
            fatal(f"{why}; an upgrade needs canopy's answer and never runs from the cache")
        return self._cached(cache_file, why)

    @staticmethod
    def _warn_withheld(data):
        withheld = set(data.get("secret_vars") or [])
        for host in data["hosts"]:
            withheld.update(host.get("secret_vars") or [])
        if withheld:
            display.warning(
                "canopy inventory: the cache holds no secret value, so "
                f"{', '.join(sorted(withheld))} are unset; a play needing one fails on it"
            )

    def _cached(self, cache_file, why):
        if not cache_file.exists():
            fatal(f"{why}, and nothing cached at {cache_file}")
        display.warning(f"canopy inventory: {why}, using {cache_file}, which may be out of date")
        return json.loads(cache_file.read_text())

    @staticmethod
    def _store(cache_file, data):
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.parent.chmod(0o700)
        staged = cache_file.with_suffix(".staged")
        staged.write_text(json.dumps(data))
        staged.chmod(0o600)
        staged.replace(cache_file)

    @staticmethod
    def _refusal(err):
        try:
            problem = json.load(err)
        except (json.JSONDecodeError, UnicodeDecodeError):
            problem = None
        if isinstance(problem, dict):
            # title is canopy's sentence; detail is its error type's debug form.
            return problem.get("title") or problem.get("detail") or err.reason
        return f"{err.code} {err.reason}"
