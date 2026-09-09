"""Inventory for one deployment, read from canopy."""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

from ansible.plugins.inventory import BaseInventoryPlugin
from ansible.plugins.loader import callback_loader
from ansible.utils.display import Display

DOCUMENTATION = r"""
name: canopy
short_description: Deployment inventory from canopy
description:
  - Reads one deployment's hosts and the variables that configure them from canopy.
  - A deployment is a canopy group at one rank, so a group holding more than one rank needs O(rank) as well.
  - The run names the deployment through C(CANOPY_GROUP) or C(CANOPY_GROUP_ID) and C(CANOPY_RANK), so one
    committed source file serves every deployment and the repo lists none of them.
  - A host is a machine. Each is grouped by the products running on it (C(tamanu), C(senaite), C(canopy)) and
    by the roles those play (C(central), C(facility), C(standalone)), so a box carrying two is in four groups.
  - Each host is reached at its bound device's tailnet name, or at the recorded host of an application on it
    where no device is bound. An C(ansible_host) variable on the machine overrides both.
  - A host is named for that address, since canopy's own name for a machine is a label an operator wrote
    and carries spaces.
  - Reading the inventory takes canopy's run lease on the environment, which is served to one operator at a
    time, so two runs never act on one environment at once. The lease is given back when the play ends and
    extended while it is still going, both by the C(canopy_lease) callback, which the run refuses to start
    without; a run that dies leaves a lease that expires on its own.
  - Only machines carrying C(managed_by_ansible) are served. Canopy holds every machine in an environment,
    including the ones this repo does not configure, so membership is opt-in rather than everything canopy knows.
  - C(canopy_intent) carries the intent the inventory was read with, so a play can refuse to run under the wrong one.
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

# ssh reads a leading dash as an option, so an address is a name or an IP and nothing else.
VALID_ADDRESS = re.compile(r"^[A-Za-z0-9:][A-Za-z0-9.:_-]*$")

# Where the lease this run holds is handed to the callback that gives it back.
# Both plugins live in the one ansible process, so the environment is the whole
# channel.
LEASE_ENV = "CANOPY_INVENTORY_LEASE"

# The callback that extends the lease while the play runs and gives it back.
KEEPER = "canopy_lease"


def without_secret_values(data):
    """The payload with every secret value dropped and the names left in place.

    Canopy serves a secret value to the run that asked for it; the cache is a
    plaintext file that outlives the run.
    """

    def plain(vars_, names):
        return {key: value for key, value in vars_.items() if key not in names}

    wide = set(data.get("secret_vars") or [])
    hosts = []
    for host in data["hosts"]:
        names = wide | set(host.get("secret_vars") or [])
        hosts.append(
            dict(
                host,
                vars=plain(host["vars"], names),
                own_vars=plain(host.get("own_vars", {}), names),
            )
        )
    return dict(
        data,
        vars=plain(data["vars"], wide),
        hosts=hosts,
    )


TAILNET_SUFFIX = ".ts.net"
MANAGED_VAR = "managed_by_ansible"


def slug(text):
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", text).strip("-")


def host_names(hosts):
    """What each member is addressed as in the inventory.

    The address is what a play connects to and, in its tailnet form, the name
    the deployment already goes by. Canopy's name is a label for an operator
    to read, so it is the fallback rather than the first choice.

    Canopy refuses an environment whose machines share an address, so the
    collision below is a belt-and-braces against one reaching us anyway.
    """
    addressed = [
        (host["address"].split(".")[0] if host["address"].endswith(TAILNET_SUFFIX) else host["address"])
        if host["address"]
        else ""
        for host in hosts
    ]
    shared = {name for name in addressed if addressed.count(name) > 1}
    return [
        name if name and name not in shared else (slug(host["name"]) or host["id"])
        for host, name in zip(hosts, addressed)
    ]


def ansible_groups(host):
    """The products a machine runs and the roles they play: a box carrying
    `tamanu-facility` is in `tamanu` and in `facility`, and one carrying a
    central beside it is in `central` too. A type naming no role is a
    standalone."""
    names = []
    for application in host.get("applications") or []:
        product, _, role = application["type"].partition("-")
        names += [product, role or "standalone"]
    return list(dict.fromkeys(names))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # urllib turns a redirected POST into a bodiless GET, which canopy
        # answers with a 405 that reads as a refusal.
        fatal(f"{req.full_url} redirects to {newurl}; point CANOPY_URL at canopy itself")


def fatal(message):
    # Ansible downgrades an AnsibleError here to a warning over an empty inventory.
    raise SystemExit(f"canopy inventory: {message}")


class Unreachable(Exception):
    """Canopy did not answer, which is not an answer, so the cache stands in."""


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
        keyed = dict(args, url=(self.get_option("url") or "").rstrip("/"))
        digest = hashlib.sha256(json.dumps(keyed, sort_keys=True).encode()).hexdigest()[:12]
        cache_file = Path(
            os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache",
            "canopy-inventory",
            f"{label}-{digest}.json",
        )
        data, fresh = self._fetch(args, cache_file)
        if not fresh:
            self._warn_withheld(data)

        try:
            self._build(inventory, data)
            # Only a payload ansible has made an inventory out of is worth
            # keeping for the offline path, and only the half of it that may be
            # written down.
            if fresh:
                self._store(cache_file, without_secret_values(data))
        except BaseException:
            self._give_back_held()
            raise

    def _build(self, inventory, data):
        for key, value in data["vars"].items():
            if VALID_VAR_NAME.match(key):
                inventory.set_variable("all", key, value)
        inventory.set_variable("all", "canopy_intent", self.get_option("intent"))

        # Canopy holds every application in the environment, this repo
        # configures a subset, and a play that reached the rest would act on
        # machines nothing here has ever touched.
        managed = [host for host in data["hosts"] if host["vars"].get(MANAGED_VAR)]
        if not managed:
            fatal(
                f"none of canopy's {len(data['hosts'])} members carry {MANAGED_VAR}; "
                f"set it on the applications this repo configures"
            )
        withheld = [host["name"] for host in data["hosts"] if not host["vars"].get(MANAGED_VAR)]
        if withheld:
            display.warning(
                f"canopy inventory: {len(withheld)} of canopy's members carry no {MANAGED_VAR} "
                f"and are left out: {', '.join(sorted(withheld))}"
            )

        seen = set()
        for host, name in zip(managed, host_names(managed)):
            if name in seen:
                fatal(f"canopy serves two servers named {name!r}; one would stand in for both")
            seen.add(name)
            inventory.add_host(name)
            for group_name in ansible_groups(host):
                inventory.add_group(group_name)
                inventory.add_child(group_name, name)
            for address in (host["address"], host["vars"].get("ansible_host")):
                if address and not VALID_ADDRESS.match(str(address)):
                    fatal(f"canopy gives {name} the address {address!r}, which is not a name or an IP")
            if host["address"]:
                inventory.set_variable(name, "ansible_host", host["address"])
            elif "ansible_host" not in host["vars"]:
                display.warning(
                    f"canopy inventory: canopy holds no address for {name}, and it sets no "
                    "ansible_host, so the play will try to resolve that name"
                )
            for key, value in host["vars"].items():
                # Canopy tags include dotted keys such as billing.product, which
                # are not addressable as Ansible variables.
                if VALID_VAR_NAME.match(key):
                    inventory.set_variable(name, key, value)

    def _fetch(self, args, cache_file):
        # The cache is keyed to the canopy that filled it, so an offline run
        # still has to say which one it is reading.
        url = self.get_option("url")
        if not url:
            fatal("set CANOPY_URL, or url in the source file")
        base = url.rstrip("/")

        if os.environ.get("CANOPY_INVENTORY_OFFLINE"):
            return self._fallback(args, cache_file, "offline"), False

        self._require_keeper()

        try:
            lease = self._post(f"{base}/api/inventory/take_lease", args)
        except Unreachable as why:
            return self._fallback(args, cache_file, str(why)), False

        try:
            data = self._post(f"{base}/api/inventory/for_group", {"lease_id": lease["id"]})
        except Unreachable as why:
            # Holding an environment we could not read shuts it for nobody.
            self._give_back(base, lease["id"])
            return self._fallback(args, cache_file, str(why)), False
        except BaseException:
            self._give_back(base, lease["id"])
            raise

        # The play holds the environment until it ends, which the callback is
        # what notices. Nothing reads this back where no callback is loaded, so
        # an `ansible-inventory` run leaves a lease to expire on its own.
        os.environ[LEASE_ENV] = json.dumps({"url": base, "lease_id": lease["id"]})
        return data, True

    def _post(self, url, payload):
        """Ask canopy, and tell a refusal from a silence: a refusal is an
        answer to respect, a silence is what the cache is for."""
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode(),
            headers={"content-type": "application/json"},
        )
        opener = urllib.request.build_opener(NoRedirect)
        try:
            with opener.open(request, timeout=self.get_option("timeout")) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as err:
            if 400 <= err.code < 500:
                fatal(f"canopy refused this inventory: {self._refusal(err)}")
            raise Unreachable(f"canopy answered {err.code} {err.reason}") from None
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as err:
            raise Unreachable(str(err)) from None

    @staticmethod
    def _require_keeper():
        """The lease is taken here and given back by the callback, so a run
        that cannot load it holds the environment until the lease expires."""
        if callback_loader.find_plugin(KEEPER) is None:
            fatal(
                f"the {KEEPER} callback is not loaded, so nothing would give the run lease back: "
                "set `callback_plugins = ./callback_plugins` in the ansible.cfg the run picks up"
            )

    def _give_back_held(self):
        """Give back the lease of a run that never starts: the callback only
        sees a play that did."""
        held = os.environ.pop(LEASE_ENV, None)
        if held:
            lease = json.loads(held)
            self._give_back(lease["url"], lease["lease_id"])

    def _give_back(self, base, lease_id):
        """Best effort: a lease we cannot release expires on its own, and
        failing the run over it would replace one problem with a worse one."""
        try:
            self._post(f"{base}/api/inventory/release_lease", {"lease_id": lease_id})
        except (Unreachable, SystemExit, ValueError, urllib.error.URLError, OSError):
            display.warning(
                f"canopy inventory: could not release the run lease {lease_id}; "
                "it holds the environment until it expires"
            )

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
        cache_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        cache_file.parent.chmod(0o700)
        staged = cache_file.with_suffix(".staged")
        staged.unlink(missing_ok=True)
        fd = os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as out:
            json.dump(data, out)
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
