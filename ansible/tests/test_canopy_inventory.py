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

INVENTORY = {
    "group_id": "11111111-0000-4000-8000-000000000001",
    "group": "kamaka",
    "rank": "production",
    "vars": {"timezone": "Pacific/Auckland", "billing.deployment": "kamaka", "salt": "pepper"},
    "secret_vars": ["salt"],
    "hosts": [
        {
            "id": "33333333-0000-4000-8000-000000000001",
            "name": "kamaka-prod-central",
            "product": "tamanu",
            "kind": "central",
            "address": "kamaka-prod-central",
            "vars": {
                "timezone": "Pacific/Auckland",
                "ansible_user": "ubuntu",
                "elastic_agent_enabled": True,
                "billing.deployment": "kamaka",
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
            "id": "33333333-0000-4000-8000-000000000002",
            "name": "kamaka-prod-facility",
            "product": "tamanu",
            "kind": "facility",
            "address": "facility.kamaka.example",
            "vars": {"timezone": "Pacific/Auckland", "salt": "pepper"},
            "own_vars": {},
            "secret_vars": ["salt"],
        },
    ],
}


def plain(value):
    """--list wraps a plugin's strings as untrusted-for-templating; the run
    itself sees the value inside."""
    if isinstance(value, dict) and "__ansible_unsafe" in value:
        return value["__ansible_unsafe"]
    return value


class StubCanopy:
    """A canopy that answers however the test needs it to."""

    def __init__(self, status=200, body=None, content_type="application/json", location=None):
        self.status = status
        self.body = json.dumps(INVENTORY) if body is None else body
        self.content_type = content_type
        self.location = location
        self.requests = []

    def __enter__(self):
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("content-length", 0))
                stub.requests.append(json.loads(self.rfile.read(length) or "{}"))
                payload = stub.body.encode()
                self.send_response(stub.status)
                if stub.location:
                    self.send_header("location", stub.location)
                self.send_header("content-type", stub.content_type)
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
            XDG_CACHE_HOME=str(self.cache),
            CANOPY_URL=url,
        )
        for name in ("CANOPY_INVENTORY_OFFLINE", "CANOPY_GROUP", "CANOPY_GROUP_ID", "CANOPY_RANK"):
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


class ServingAnInventory(PluginTestCase):
    def test_hosts_are_grouped_and_addressed(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka", rank="production"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(canopy.requests, [{"group": "kamaka", "rank": "production"}])
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])
        self.assertEqual(data["facility"]["hosts"], ["kamaka-prod-facility"])
        self.assertEqual(
            sorted(data["tamanu"]["hosts"]),
            ["kamaka-prod-central", "kamaka-prod-facility"],
        )

        central = data["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["ansible_host"]), "kamaka-prod-central")
        self.assertEqual(plain(central["ansible_user"]), "ubuntu")
        self.assertIs(central["elastic_agent_enabled"], True)
        # Ansible cannot address a dotted name as a variable, so it is left out
        # rather than served as something unusable.
        self.assertNotIn("billing.deployment", central)

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
        self.assertEqual(plain(hostvars["kamaka-prod-facility"]["salt"]), "pepper")

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


if __name__ == "__main__":
    unittest.main()
