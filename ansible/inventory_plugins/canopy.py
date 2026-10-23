"""Inventory for one deployment, read from canopy."""

from __future__ import annotations

import atexit
import http.client
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from ansible import context
from ansible.module_utils.parsing.convert_bool import boolean
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
  - A run started from canopy's run dialog is handed the run lease in C(CANOPY_LEASE) instead. It then reads under
    that lease, takes the group, rank and intent from what canopy serves under it, and needs none of the options
    above. Without C(CANOPY_LEASE) the run takes a lease of its own.
  - A run over a handed lease sends canopy the playbook, the limit, the tags and the skipped tags it was started
    with, and C(CANOPY_INTENT) where that is set, as claims canopy checks against the lease before the run starts.
    Canopy refuses a run that differs, and the run stops with its reason.
  - A host is a machine. Each is grouped by the products running on it (C(tamanu), C(senaite), C(canopy)) and
    by the roles those play (C(central), C(facility), C(standalone)), so a box carrying two is in four groups.
    A machine with nothing on it is grouped by the type canopy serves as assigned to it, as an application of
    that type would be.
  - Each host is reached at its bound device's tailnet name, or at the recorded host of an application on it
    where no device is bound. An C(ansible_host) variable on the machine overrides both.
  - A host is named by the C(host_name) canopy serves for it, the name a run's limit is previewed against in
    canopy, so the two cannot disagree. The run stops where two machines carry the same name.
  - Reading the inventory holds canopy's run lease on the environment, which is served to one operator at a
    time, so two runs never act on one environment at once. The lease is given back when the play ends and
    extended while it is still going, both by the C(canopy_lease) callback, which the run refuses to start
    without; a run that dies leaves a lease that expires on its own. A lease handed to the run is kept and
    given back as one the run took.
  - Only machines whose own variables set C(managed_by_ansible) are served. Canopy holds every machine in an
    environment, including the ones this repo does not configure, so membership is opt-in rather than everything
    canopy knows. A value that machine only inherits from its environment or group does not count.
  - C(canopy_intent) carries the intent of the lease the inventory was read under, so a play can refuse to run
    under the wrong one.
  - C(tamanu_clone) is true for a deployment at canopy's C(clone) rank, whose restores come from another server's backups.
  - Of ansible's own variables canopy may set only C(ansible_host), C(ansible_user), C(ansible_port),
    C(ansible_python_interpreter) and C(ansible_timeout). The rest, and C(canopy_intent), are left out with a
    warning, since they decide how the controller connects and what it runs.
  - Reading an inventory needs canopy administrator access, since it carries the deployment's secret variables.
  - If canopy cannot be reached, or refuses the request, the run stops. Nothing is cached, so a run never acts
    on what canopy said earlier.
  - An C(upgrade) of a production deployment is refused unless the group has an open upgrade plan.
options:
  plugin:
    description: Marks this file as a canopy inventory source.
    required: true
    choices: [canopy]
  lease:
    description:
      - Identifier of a run lease already taken on the deployment, as canopy's run dialog hands it over.
      - When set, the group, rank and intent of the run are those of the lease, and O(group), O(group_id) and
        O(rank) are not read.
    type: str
    env:
      - name: CANOPY_LEASE
  group:
    description: Name of the canopy server group holding the deployment. Give this or O(group_id), unless O(lease) is set.
    type: str
    env:
      - name: CANOPY_GROUP
  group_id:
    description: Identifier of the canopy server group. Give this or O(group), unless O(lease) is set.
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
      - What the run is doing to the deployment, C(configure) where not given. Canopy refuses an C(upgrade) of a
        production deployment unless the group has an open upgrade plan.
      - Under a handed O(lease) it is the intent the run claims, which canopy refuses where the lease declares another.
    type: str
    choices: [configure, upgrade]
    env:
      - name: CANOPY_INTENT
  url:
    description: Base URL of canopy's operator interface. C(https), unless canopy is on this machine.
    type: str
    env:
      - name: CANOPY_URL
  timeout:
    description: Seconds to wait for canopy on each request.
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
# A host name is held to the same: it is a --limit operand, where `!`, `&`, `,`, `*` or
# whitespace would change which hosts a pattern selects.
VALID_ADDRESS = re.compile(r"^[A-Za-z0-9:][A-Za-z0-9.:_-]*$")

# Where the lease this run holds is handed to the callback that gives it back.
# Both plugins live in the one ansible process, so the environment is the whole
# channel. It is the plugin's own: CANOPY_LEASE is what a run is handed, and is
# never read back by the callback.
LEASE_ENV = "CANOPY_INVENTORY_LEASE"

# The callback that extends the lease while the play runs and gives it back.
KEEPER = "canopy_lease"

LOOPBACK = ("localhost", "127.0.0.1", "::1")

# Enough of ansible's namespace to say where a machine is and who to be there, nothing that says what to run.
# spec: LNXANS#inventory
ALLOWED_ANSIBLE_VARS = frozenset(
    {"ansible_host", "ansible_user", "ansible_port", "ansible_python_interpreter", "ansible_timeout"}
)

# The plugin sets these at group scope, where a host-level tag would beat them.
RESERVED_VARS = frozenset({"canopy_intent", "tamanu_clone"})

INTENTS = ("configure", "upgrade")

MANAGED_VAR = "managed_by_ansible"


def canopy_may_set(key, where):
    if key in RESERVED_VARS or (key.startswith("ansible_") and key not in ALLOWED_ANSIBLE_VARS):
        display.warning(f"canopy inventory: {key} is not canopy's to set, so it is left out of {where}")
        return False
    return True


def is_managed(host):
    """Whether the machine sets the flag itself. The effective variables carry
    it from the environment and the group too, which would make every machine
    in an environment managed because one application was."""
    return boolean((host.get("own_vars") or {}).get(MANAGED_VAR), strict=False)


def ansible_groups(host):
    """The products a machine runs and the roles they play: a box carrying
    `tamanu-facility` is in `tamanu` and in `facility`, and one carrying a
    central beside it is in `central` too. A type naming no role is a
    standalone. A machine with nothing on it is grouped by the type assigned
    to it for the run, as an application of that type would be.

    Canopy mirrors this to preview a run's limit against the same groups.
    """
    applications = host.get("applications") or []
    types = [application["type"] for application in applications]
    if not types and host.get("assigned_type"):
        types = [host["assigned_type"]]
    names = []
    for type_ in types:
        product, _, role = type_.partition("-")
        names += [product, role or "standalone"]
    return list(dict.fromkeys(names))


def run_claims():
    """What this run was started with, as Canopy checks it against a lease.

    Only a playbook run claims anything: an inventory listing or an ad-hoc
    command has no playbook, tags or limit to compare, and refusing them
    against the lease would stop an operator looking at what a run would see.
    The values are Ansible's own parse of the command line, so
    `--tags a,b` and `--tags b --tags a` claim the same two tags, and the
    default tag selection `all` claims none.
    """
    cli = context.CLIARGS
    if "tags" not in cli:
        return {}
    playbooks = cli.get("args") or ()
    if len(playbooks) != 1:
        fatal(
            f"a run over a handed lease runs one playbook, since the lease records one; "
            f"this one was given {len(playbooks)}"
        )
    tags = sorted(set(cli["tags"]))
    return {
        "playbook": Path(playbooks[0]).name,
        "limit": cli.get("subset") or "",
        "tags": [] if tags == ["all"] else tags,
        "skip_tags": sorted(set(cli.get("skip_tags") or ())),
    }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # urllib turns a redirected POST into a bodiless GET, which canopy
        # answers with a 405 that reads as a refusal.
        fatal(f"{req.full_url} redirects to {newurl}; point CANOPY_URL at canopy itself")


def fatal(message):
    # Ansible downgrades an AnsibleError here to a warning over an empty inventory.
    raise SystemExit(f"canopy inventory: {message}")


class Unreachable(Exception):
    """Canopy did not answer, which stops the run as a refusal does."""


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

    # spec: LNXANS#inventory
    def _populate(self, inventory):
        handed = self.get_option("lease")
        args = None if handed else self._environment_args()

        url = self.get_option("url")
        if not url:
            fatal("set CANOPY_URL, or url in the source file")
        base = url.rstrip("/")
        parsed = urllib.parse.urlsplit(base)
        if parsed.scheme != "https" and parsed.hostname not in LOOPBACK:
            fatal(f"{base} is not https, and canopy's answer carries the deployment's secret variables")

        self._require_keeper()

        if handed:
            # Claims are worked out before anything is sent, so a command that
            # cannot be claimed leaves the lease as it was handed over.
            lease_id, request = handed, self._claims(handed)
        else:
            lease_id = self._ask(f"{base}/api/ansible/take_lease", args)["id"]
            request = {"lease_id": lease_id}

        try:
            data = self._ask(f"{base}/api/ansible/for_group", request)
        except BaseException:
            # Holding an environment we could not read shuts it for nobody.
            self._give_back(base, lease_id)
            raise

        # The play holds the environment until it ends, which the callback is
        # what notices; the exit hook covers a run that never plays one.
        os.environ[LEASE_ENV] = json.dumps({"url": base, "lease_id": lease_id})
        atexit.register(self._give_back_at_exit, os.getpid())

        try:
            self._build(inventory, data)
        except BaseException:
            self._give_back_held()
            raise

    def _environment_args(self):
        """The take_lease request for a run that was not handed a lease."""
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
        return args

    def _claims(self, lease_id):
        """The read of a handed lease: what the run was started with, for
        Canopy to hold against what the lease records."""
        request = {"lease_id": lease_id}
        intent = self.get_option("intent")
        if intent:
            request["intent"] = intent
        return request | run_claims()

    def _build(self, inventory, data):
        intent = data["lease"]["intent"]
        if intent not in INTENTS:
            fatal(f"canopy serves the lease the intent {intent!r}, which is not one of {', '.join(INTENTS)}")

        for key, value in data["vars"].items():
            if VALID_VAR_NAME.match(key) and canopy_may_set(key, "the environment"):
                inventory.set_variable("all", key, value)
        inventory.set_variable("all", "canopy_intent", intent)
        inventory.set_variable("all", "tamanu_clone", data.get("rank") == "clone")

        # Canopy holds every application in the environment, this repo
        # configures a subset, and a play that reached the rest would act on
        # machines nothing here has ever touched.
        managed = [host for host in data["hosts"] if is_managed(host)]
        if not managed:
            fatal(
                f"none of canopy's {len(data['hosts'])} members carry {MANAGED_VAR}; "
                f"set it on the applications this repo configures"
            )
        withheld = [host["name"] for host in data["hosts"] if not is_managed(host)]
        if withheld:
            display.warning(
                f"canopy inventory: {len(withheld)} of canopy's members carry no {MANAGED_VAR} "
                f"and are left out: {', '.join(sorted(withheld))}"
            )

        seen = set()
        for host in managed:
            name = host["host_name"]
            if not VALID_ADDRESS.match(str(name)):
                fatal(f"canopy serves the host name {name!r}, which is not a name or an IP")
            if name in seen:
                fatal(f"canopy serves two servers named {name!r}; one would stand in for both")
            seen.add(name)
            inventory.add_host(name)
            for group_name in ansible_groups(host):
                inventory.add_group(group_name)
                inventory.add_child(group_name, name)
            address = host.get("address")
            for candidate in (address, host["vars"].get("ansible_host")):
                if candidate and not VALID_ADDRESS.match(str(candidate)):
                    fatal(f"canopy gives {name} the address {candidate!r}, which is not a name or an IP")
            if address:
                inventory.set_variable(name, "ansible_host", address)
            elif "ansible_host" not in host["vars"]:
                display.warning(
                    f"canopy inventory: canopy holds no address for {name}, and it sets no "
                    "ansible_host, so the play will try to resolve that name"
                )
            for key, value in host["vars"].items():
                # Canopy tags include dotted keys such as billing.product, which
                # are not addressable as Ansible variables.
                if VALID_VAR_NAME.match(key) and canopy_may_set(key, name):
                    inventory.set_variable(name, key, value)

    def _ask(self, url, payload):
        """Ask canopy, and stop the run on anything but an answer."""
        try:
            return self._post(url, payload)
        except Unreachable as why:
            fatal(f"canopy could not be reached ({why}), and nothing is read without its answer")

    def _post(self, url, payload):
        """Ask canopy, and tell a refusal from a silence: both stop a run, but
        a give-back tolerates the silence."""
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
        """The lease is given back by the callback, so a run that cannot load
        it holds the environment until the lease expires."""
        if callback_loader.find_plugin(KEEPER) is None:
            fatal(
                f"the {KEEPER} callback is not loaded, so nothing would give the run lease back: "
                "set `callback_plugins = ./callback_plugins` in the ansible.cfg the run picks up"
            )

    def _give_back_at_exit(self, owner_pid):
        """Give the lease back where no play ever ran, so reading an inventory
        does not hold the environment until the lease expires. Ansible's task
        workers are forks that inherit this handler, so only the process that
        read the inventory may give it back."""
        if os.getpid() == owner_pid:
            self._give_back_held()

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
            self._post(f"{base}/api/ansible/release_lease", {"lease_id": lease_id})
        except (Unreachable, SystemExit, ValueError, urllib.error.URLError, OSError):
            display.warning(
                f"canopy inventory: could not release the run lease {lease_id}; "
                "it holds the environment until it expires"
            )

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
