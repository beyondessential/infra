"""Behaviour of the canopy inventory plugin, driven through ansible-inventory.

Each case runs the real command against a stub canopy, because what is under
test is mostly how the plugin behaves at ansible's boundary: an error that
escapes it becomes a warning over an empty inventory, which reads as a play
that matched no hosts.
"""

import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ANSIBLE = Path(__file__).resolve().parent.parent
PLUGINS = ANSIBLE / "inventory_plugins"
CALLBACKS = ANSIBLE / "callback_plugins"

INVENTORY = {
    "group_id": "11111111-0000-4000-8000-000000000001",
    "group": "kamaka",
    "rank": "production",
    "vars": {"timezone": "Pacific/Auckland", "billing.product": "tamanu", "salt": "pepper"},
    "secret_vars": ["salt"],
    "hosts": [
        {
            "id": "22222222-0000-4000-8000-000000000001",
            "name": "kamaka-prod-central",
            "address": "kamaka-prod-central",
            "applications": [
                {
                    "id": "33333333-0000-4000-8000-000000000001",
                    "name": "kamaka-prod-central",
                    "type": "tamanu-central",
                }
            ],
            "vars": {
                "timezone": "Pacific/Auckland",
                "ansible_user": "ubuntu",
                "elastic_agent_enabled": True,
                "managed_by_ansible": True,
                "billing.product": "tamanu",
                "salt": "pepper",
                "tls_dns_access_key": "vinegar",
            },
            "own_vars": {
                "ansible_user": "ubuntu",
                "elastic_agent_enabled": True,
                "tls_dns_access_key": "vinegar",
            },
            "secret_vars": ["salt", "tls_dns_access_key"],
        },
        {
            "id": "22222222-0000-4000-8000-000000000002",
            "name": "kamaka-prod-facility",
            "address": "facility.kamaka.example",
            "applications": [
                {
                    "id": "33333333-0000-4000-8000-000000000002",
                    "name": "kamaka-prod-facility",
                    "type": "tamanu-facility",
                }
            ],
            "vars": {"timezone": "Pacific/Auckland", "salt": "pepper", "managed_by_ansible": True},
            "own_vars": {},
            "secret_vars": ["salt"],
        },
    ],
}

LEASE = {
    "id": "44444444-0000-4000-8000-000000000001",
    "server_group_id": INVENTORY["group_id"],
    "rank": "production",
    "intent": "configure",
    "held_by": "alice@example.com",
    "expires_at": "2026-09-08T00:30:00Z",
}


def plain(value):
    """--list wraps a plugin's strings as untrusted-for-templating; the run
    itself sees the value inside."""
    if isinstance(value, dict) and "__ansible_unsafe" in value:
        return value["__ansible_unsafe"]
    return value


class StubCanopy:
    """A canopy that answers however the test needs it to.

    Reading an inventory is three calls now, so an override names the one it
    applies to and the rest answer normally. `calls` is the sequence of paths,
    which is how a test says the lease was taken and given back.
    """

    def __init__(self, status=200, body=None, content_type="application/json", location=None, on="for_group"):
        self.status = status
        self.body = body
        self.content_type = content_type
        self.location = location
        self.on = on
        self.requests = []
        self.calls = []

    def answer(self, path):
        """The status, content type and body for one call."""
        if path == self.on and (self.status != 200 or self.body is not None):
            return self.status, self.content_type, ("" if self.body is None else self.body)
        default = {
            "take_lease": json.dumps(LEASE),
            "for_group": json.dumps(INVENTORY),
            "extend_lease": json.dumps(LEASE),
            "release_lease": "",
        }.get(path)
        if default is None:
            return 404, "application/json", json.dumps({"title": f"no such path {path}"})
        return 200, "application/json", default

    def __enter__(self):
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                path = self.path.rsplit("/", 1)[-1]
                length = int(self.headers.get("content-length", 0))
                sent = json.loads(self.rfile.read(length) or "{}")
                stub.calls.append(path)
                if path == "take_lease":
                    stub.requests.append(sent)
                status, content_type, body = stub.answer(path)
                payload = body.encode()
                self.send_response(status)
                if stub.location:
                    self.send_header("location", stub.location)
                self.send_header("content-type", content_type)
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()


class PluginTestCase(unittest.TestCase):
    def setUp(self):
        if shutil.which("ansible-inventory") is None:
            self.skipTest("ansible-inventory is not on PATH")
        self.workdir = tempfile.TemporaryDirectory()
        self.cache = Path(self.workdir.name, "cache")
        # An empty config keeps the developer's own ansible.cfg out of the run.
        self.config = Path(self.workdir.name, "empty.cfg")
        self.config.write_text("[defaults]\n")
        self.addCleanup(self.workdir.cleanup)

    def source(self, **keys):
        path = Path(self.workdir.name, "source.yml")
        path.write_text("plugin: canopy\n" + "".join(f"{k}: {v}\n" for k, v in keys.items()))
        return path

    def run_inventory(self, source, url, offline=False, args=("--list",), **run_env):
        env = dict(
            os.environ,
            ANSIBLE_CONFIG=str(self.config),
            ANSIBLE_INVENTORY_PLUGINS=str(PLUGINS),
            ANSIBLE_CALLBACK_PLUGINS=str(CALLBACKS),
            XDG_CACHE_HOME=str(self.cache),
            CANOPY_URL=url,
        )
        for name in (
            "CANOPY_INVENTORY_OFFLINE",
            "CANOPY_GROUP",
            "CANOPY_GROUP_ID",
            "CANOPY_RANK",
            "CANOPY_INTENT",
            "CANOPY_INVENTORY_LEASE",
        ):
            env.pop(name, None)
        env.update(run_env)
        if offline:
            env["CANOPY_INVENTORY_OFFLINE"] = "1"
        return subprocess.run(
            ["ansible-inventory", "-i", str(source), *args],
            capture_output=True,
            text=True,
            env=env,
            cwd=self.workdir.name,
        )

    def run_playbook(self, source, url, **run_env):
        """A play, so the callback that gives the lease back actually fires.

        The hosts are reached over the local connection: what is under test is
        the lease around a play, not whether ansible can ssh anywhere.
        """
        if shutil.which("ansible-playbook") is None:
            self.skipTest("ansible-playbook is not on PATH")
        play = Path(self.workdir.name, "play.yml")
        play.write_text(
            "- hosts: all\n"
            "  gather_facts: false\n"
            "  connection: local\n"
            "  tasks:\n"
            "    - debug: msg=held\n"
        )
        env = dict(
            os.environ,
            ANSIBLE_CONFIG=str(self.config),
            ANSIBLE_INVENTORY_PLUGINS=str(PLUGINS),
            ANSIBLE_CALLBACK_PLUGINS=str(CALLBACKS),
            XDG_CACHE_HOME=str(self.cache),
            CANOPY_URL=url,
        )
        for name in ("CANOPY_GROUP", "CANOPY_GROUP_ID", "CANOPY_RANK", "CANOPY_INVENTORY_LEASE"):
            env.pop(name, None)
        env.update(run_env)
        return subprocess.run(
            ["ansible-playbook", "-i", str(source), str(play)],
            capture_output=True,
            text=True,
            env=env,
            cwd=self.workdir.name,
        )


class ServingAnInventory(PluginTestCase):
    def test_hosts_are_grouped_and_addressed(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka", rank="production"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(canopy.requests, [{"group": "kamaka", "rank": "production"}])
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])
        self.assertEqual(data["facility"]["hosts"], ["facility.kamaka.example"])
        self.assertEqual(
            sorted(data["tamanu"]["hosts"]),
            ["facility.kamaka.example", "kamaka-prod-central"],
        )

        central = data["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["ansible_host"]), "kamaka-prod-central")
        self.assertEqual(plain(central["ansible_user"]), "ubuntu")
        self.assertIs(central["elastic_agent_enabled"], True)
        # Ansible cannot address a dotted name as a variable, so it is left out
        # rather than served as something unusable.
        self.assertNotIn("billing.product", central)

    def test_the_run_names_the_deployment(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(
                self.source(), canopy.url, CANOPY_GROUP="kamaka", CANOPY_RANK="production"
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(canopy.requests, [{"group": "kamaka", "rank": "production"}])
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])

    def test_a_source_naming_no_deployment_stops_the_run(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("give exactly one of group or group_id", result.stderr)
        self.assertEqual(canopy.requests, [])

    def test_a_servers_own_ansible_host_wins_over_the_address(self):
        body = json.loads(json.dumps(INVENTORY))
        body["hosts"][0]["vars"]["ansible_host"] = "10.0.0.9"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        hostvars = json.loads(result.stdout)["_meta"]["hostvars"]
        self.assertEqual(plain(hostvars["kamaka-prod-central"]["ansible_host"]), "10.0.0.9")


class NamingAHost(PluginTestCase):
    def test_a_host_is_named_for_its_tailnet_address(self):
        body = json.loads(json.dumps(INVENTORY))
        body["hosts"][0]["name"] = "Prod Central (Kamaka)"
        body["hosts"][0]["address"] = "kamaka-prod-central.tailnet.ts.net"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])
        central = data["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["ansible_host"]), "kamaka-prod-central.tailnet.ts.net")

    def test_two_applications_on_one_machine_fall_back_to_their_labels(self):
        body = json.loads(json.dumps(INVENTORY))
        body["hosts"][1]["address"] = body["hosts"][0]["address"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])
        self.assertEqual(data["facility"]["hosts"], ["kamaka-prod-facility"])

    def test_a_host_with_no_address_says_so(self):
        body = json.loads(json.dumps(INVENTORY))
        body["hosts"][1]["address"] = None
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["facility"]["hosts"], ["kamaka-prod-facility"])
        self.assertIn("holds no address for kamaka-prod-facility", result.stderr)

    def test_a_host_with_no_address_but_an_ansible_host_is_left_alone(self):
        body = json.loads(json.dumps(INVENTORY))
        body["hosts"][1]["address"] = None
        body["hosts"][1]["vars"]["ansible_host"] = "10.0.0.9"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("holds no address", result.stderr)


class ChoosingWhatToConfigure(PluginTestCase):
    def test_a_member_canopy_holds_but_ansible_does_not_manage_is_left_out(self):
        body = json.loads(json.dumps(INVENTORY))
        del body["hosts"][1]["vars"]["managed_by_ansible"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])
        self.assertNotIn("facility", data)
        self.assertIn("kamaka-prod-facility", result.stderr)

    def test_an_environment_managing_nothing_stops_the_run(self):
        body = json.loads(json.dumps(INVENTORY))
        for host in body["hosts"]:
            del host["vars"]["managed_by_ansible"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("managed_by_ansible", result.stderr)

    def test_the_intent_reaches_the_play(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url, CANOPY_INTENT="upgrade")
        self.assertEqual(result.returncode, 0, result.stderr)
        hostvars = json.loads(result.stdout)["_meta"]["hostvars"]
        self.assertEqual(plain(hostvars["kamaka-prod-central"]["canopy_intent"]), "upgrade")
        self.assertEqual(canopy.requests[0]["intent"], "upgrade")


class Refusing(PluginTestCase):
    def test_a_refusal_stops_the_run(self):
        problem = json.dumps({"title": 'not found: no server group named "nope"'})
        with StubCanopy(status=404, body=problem) as canopy:
            result = self.run_inventory(self.source(group="nope"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn('no server group named "nope"', result.stderr)

    def test_a_payload_ansible_cannot_use_stops_the_run(self):
        body = json.dumps({"group": "kamaka", "hosts": []})  # no vars key
        with StubCanopy(body=body) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("KeyError", result.stderr)

    def test_two_servers_of_one_name_stop_the_run(self):
        body = json.loads(json.dumps(INVENTORY))
        body["hosts"][1]["name"] = body["hosts"][0]["name"]
        body["hosts"][1]["address"] = body["hosts"][0]["address"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("two servers named", result.stderr)

    def test_a_redirect_names_the_url_rather_than_canopy(self):
        with StubCanopy(status=302, location="/api/inventory/for_group/") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("redirects to", result.stderr)
        self.assertIn("CANOPY_URL", result.stderr)


class WhenCanopyCannotBeReached(PluginTestCase):
    def prime_cache(self, source):
        with StubCanopy() as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        cached = list(self.cache.glob("canopy-inventory/*.json"))
        self.assertEqual(len(cached), 1)
        return cached[0]

    def test_a_server_error_falls_back_to_the_cache(self):
        source = self.source(group="kamaka")
        self.prime_cache(source)
        with StubCanopy(status=502, body="<html>bad gateway</html>", content_type="text/html") as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("may be out of date", result.stderr)
        self.assertIn("kamaka-prod-central", json.loads(result.stdout)["_meta"]["hostvars"])

    def test_a_bad_payload_does_not_overwrite_a_good_cache(self):
        source = self.source(group="kamaka")
        cached = self.prime_cache(source)
        good = cached.read_bytes()
        with StubCanopy(body=json.dumps({"group": "kamaka", "hosts": []})) as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(cached.read_bytes(), good)

    def test_the_cache_is_private_to_its_owner(self):
        cached = self.prime_cache(self.source(group="kamaka"))
        self.assertEqual(cached.stat().st_mode & 0o777, 0o600)

    def test_offline_with_nothing_cached_stops_the_run(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url, offline=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("nothing cached", result.stderr)
        self.assertEqual(canopy.requests, [], "offline must not reach canopy")


class SecretVariables(PluginTestCase):
    def prime_cache(self, source):
        with StubCanopy() as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        cached = list(self.cache.glob("canopy-inventory/*.json"))
        self.assertEqual(len(cached), 1)
        return cached[0]

    def test_a_secret_value_reaches_the_run(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        hostvars = json.loads(result.stdout)["_meta"]["hostvars"]
        self.assertEqual(plain(hostvars["kamaka-prod-central"]["salt"]), "pepper")
        self.assertEqual(plain(hostvars["kamaka-prod-central"]["tls_dns_access_key"]), "vinegar")
        self.assertEqual(plain(hostvars["facility.kamaka.example"]["salt"]), "pepper")

    def test_the_cache_holds_no_secret_value(self):
        cached = self.prime_cache(self.source(group="kamaka")).read_text()
        self.assertNotIn("pepper", cached)
        self.assertNotIn("vinegar", cached)
        # The names stay, so a run off the cache can say what is missing.
        self.assertIn("salt", json.loads(cached)["secret_vars"])
        self.assertIn("Pacific/Auckland", cached)

    def test_a_cached_run_leaves_a_secret_unset_and_says_so(self):
        source = self.source(group="kamaka")
        self.prime_cache(source)
        with StubCanopy(status=502, body="nope", content_type="text/plain") as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("salt", result.stderr)
        self.assertIn("tls_dns_access_key", result.stderr)
        hostvars = json.loads(result.stdout)["_meta"]["hostvars"]
        self.assertNotIn("salt", hostvars["kamaka-prod-central"])
        self.assertEqual(plain(hostvars["kamaka-prod-central"]["ansible_user"]), "ubuntu")


class ConfiguringTheSource(PluginTestCase):
    def test_naming_neither_a_group_nor_an_identifier_stops_the_run(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one of group or group_id", result.stderr)

    def test_naming_both_stops_the_run(self):
        source = self.source(group="kamaka", group_id="11111111-0000-4000-8000-000000000001")
        with StubCanopy() as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one of group or group_id", result.stderr)


class DeclaringIntent(PluginTestCase):
    def test_the_run_declares_its_intent(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(
                self.source(), canopy.url, CANOPY_GROUP="kamaka", CANOPY_INTENT="upgrade"
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.requests, [{"group": "kamaka", "intent": "upgrade"}])

    def test_an_upgrade_declares_its_intent(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka", intent="upgrade"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.requests, [{"group": "kamaka", "intent": "upgrade"}])

    def test_configuring_declares_nothing(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka", intent="configure"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.requests, [{"group": "kamaka"}])

    def test_an_unplanned_upgrade_is_refused(self):
        problem = json.dumps(
            {"title": 'conflict: server group "kamaka" has no upgrade plan; record one before upgrading production'}
        )
        with StubCanopy(status=409, body=problem) as canopy:
            result = self.run_inventory(self.source(group="kamaka", intent="upgrade"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("no upgrade plan", result.stderr)

    def test_an_upgrade_never_runs_from_the_cache(self):
        source = self.source(group="kamaka", intent="upgrade")
        with StubCanopy() as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(list(self.cache.glob("canopy-inventory/*.json"))), 1)
        with StubCanopy(status=502, body="<html>bad gateway</html>", content_type="text/html") as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("never runs from the cache", result.stderr)


class HoldingTheEnvironment(PluginTestCase):
    """Canopy serves the inventory to the holder of the environment's run
    lease, so reading one is a take, a read, and a give back."""

    def test_the_read_is_taken_under_a_lease(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka", rank="production"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.calls, ["take_lease", "for_group"])
        self.assertEqual(canopy.requests, [{"group": "kamaka", "rank": "production"}])

    def test_the_lease_carries_the_intent(self):
        with StubCanopy() as canopy:
            self.run_inventory(self.source(group="kamaka", intent="upgrade"), canopy.url)
        self.assertEqual(canopy.requests, [{"group": "kamaka", "intent": "upgrade"}])

    def test_a_refused_lease_stops_the_run_without_reading(self):
        refusal = {"title": 'conflict: that environment\'s run lease is held by bob@example.com until 00:30 UTC'}
        with StubCanopy(status=409, body=json.dumps(refusal), on="take_lease") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("held by bob@example.com", result.stderr)
        self.assertEqual(canopy.calls, ["take_lease"])

    def test_a_refused_read_gives_the_lease_back_before_stopping(self):
        refusal = {"title": 'upstream: secret variable "salt" has no value in the secret store'}
        with StubCanopy(status=502, body=json.dumps(refusal), on="for_group") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        # 502 is canopy failing to answer rather than declining, so it falls
        # back; either way the environment is not left held.
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])

    def test_a_refusal_from_the_read_gives_the_lease_back(self):
        refusal = {"title": "conflict: machines \"a\" and \"b\" are both reached at \"x\""}
        with StubCanopy(status=409, body=json.dumps(refusal), on="for_group") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("both reached at", result.stderr)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])

    def test_an_offline_run_takes_no_lease(self):
        with StubCanopy() as canopy:
            self.run_inventory(self.source(group="kamaka"), canopy.url)
            before = list(canopy.calls)
            self.run_inventory(self.source(group="kamaka"), canopy.url, offline=True)
            self.assertEqual(canopy.calls, before)

    def test_a_play_holds_the_lease_and_gives_it_back_at_the_end(self):
        with StubCanopy() as canopy:
            result = self.run_playbook(self.source(group="kamaka", rank="production"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])

    def test_a_listing_leaves_a_lease_to_expire(self):
        # Nothing sees an `ansible-inventory` run end, so the lease is not given
        # back and canopy's expiry is what clears it.
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("release_lease", canopy.calls)


class GroupingAMachine(PluginTestCase):
    def test_a_machine_is_grouped_by_the_applications_on_it(self):
        body = json.loads(json.dumps(INVENTORY))
        body["hosts"][0]["applications"].append(
            {
                "id": "33333333-0000-4000-8000-000000000003",
                "name": "kamaka-prod-lims",
                "type": "senaite",
            }
        )
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        # A box carrying a tamanu central and a senaite is in all four.
        for name in ("tamanu", "central", "senaite", "standalone"):
            self.assertIn("kamaka-prod-central", data[name]["hosts"], name)

    def test_a_machine_carrying_nothing_is_in_no_product_group(self):
        body = json.loads(json.dumps(INVENTORY))
        body["hosts"][1]["applications"] = []
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertNotIn("facility", data)
        # It is still a host a play acts on, carrying its variables.
        self.assertIn("facility.kamaka.example", data["_meta"]["hostvars"])
        self.assertIn("facility.kamaka.example", data["all"]["children"] + data.get("ungrouped", {}).get("hosts", []))


if __name__ == "__main__":
    unittest.main()
