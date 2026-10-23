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
    "lease": None,  # LEASE, set below
    "hosts": [
        {
            "id": "22222222-0000-4000-8000-000000000001",
            "name": "kamaka-prod-central",
            "host_name": "kamaka-prod-central",
            "address": "kamaka-prod-central",
            "assigned_type": None,
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
                "managed_by_ansible": True,
                "tls_dns_access_key": "vinegar",
            },
            "secret_vars": ["salt", "tls_dns_access_key"],
        },
        {
            "id": "22222222-0000-4000-8000-000000000002",
            "name": "kamaka-prod-facility",
            "host_name": "facility.kamaka.example",
            "address": "facility.kamaka.example",
            "assigned_type": None,
            "applications": [
                {
                    "id": "33333333-0000-4000-8000-000000000002",
                    "name": "kamaka-prod-facility",
                    "type": "tamanu-facility",
                }
            ],
            "vars": {"timezone": "Pacific/Auckland", "salt": "pepper", "managed_by_ansible": True},
            "own_vars": {"managed_by_ansible": True},
            "secret_vars": ["salt"],
        },
    ],
}

LEASE = {
    "id": "44444444-0000-4000-8000-000000000001",
    "server_group_id": INVENTORY["group_id"],
    "rank": "production",
    "intent": "configure",
    "playbook": None,
    "limit_pattern": None,
    "limited_to": None,
    "tags": [],
    "skip_tags": [],
    "assignments": [],
    "held_by": "alice@example.com",
    "expires_at": "2026-09-08T00:30:00Z",
}
INVENTORY["lease"] = LEASE


def served(**changes):
    """The inventory a stub serves, with top-level keys changed, as a copy."""
    return dict(json.loads(json.dumps(INVENTORY)), **changes)


def refusal(title):
    return json.dumps({"title": title})


def plain(value):
    """--list wraps a plugin's strings as untrusted-for-templating; the run
    itself sees the value inside."""
    if isinstance(value, dict) and "__ansible_unsafe" in value:
        return value["__ansible_unsafe"]
    return value


class StubCanopy:
    """A canopy that answers however the test needs it to.

    Reading an inventory is three calls, so an override names the one it
    applies to and the rest answer normally. `calls` is the sequence of paths,
    which is how a test says the lease was taken and given back; `requests`
    are the bodies of `take_lease` and `reads` those of `for_group`.

    `lease` is what canopy records of the lease a run holds. Left to answer a
    read itself, the stub holds the run against it as canopy does: a read
    naming another lease, intent, playbook, limit or tags is refused.
    """

    def __init__(
        self, status=200, body=None, content_type="application/json", location=None, on="for_group", lease=None
    ):
        self.status = status
        self.body = body
        self.content_type = content_type
        self.location = location
        self.on = on
        self.lease = lease or LEASE
        # Answers to other calls than `on`, by path, as (status, content type, body).
        self.also = {}
        self.requests = []
        self.reads = []
        self.calls = []
        self.paths = []

    def held_against(self, sent):
        """Why canopy would refuse this read, or None."""
        lease = self.lease
        if sent.get("lease_id") != lease["id"]:
            return "conflict: that run lease is not held by you"
        if "intent" in sent and sent["intent"] != lease["intent"]:
            return f"conflict: this run claims the intent {sent['intent']}, but the lease is for {lease['intent']}"
        if lease["playbook"] and "playbook" in sent and sent["playbook"] != lease["playbook"]:
            return f"conflict: this run is {sent['playbook']}, but the lease is for {lease['playbook']}"
        if "limit" in sent and (sent["limit"] or "") != (lease["limit_pattern"] or ""):
            return f"conflict: this run limits to {sent['limit']!r}, but the lease limits to {lease['limit_pattern']!r}"
        for key in ("tags", "skip_tags"):
            if key in sent and sorted(sent[key]) != sorted(lease[key]):
                return f"conflict: this run has {key} {sent[key]}, but the lease has {lease[key]}"
        return None

    def answer(self, path, sent):
        """The status, content type and body for one call."""
        if path in self.also:
            return self.also[path]
        if path == self.on and (self.status != 200 or self.body is not None):
            return self.status, self.content_type, ("" if self.body is None else self.body)
        if path == "for_group":
            why = self.held_against(sent)
            if why:
                return 409, "application/json", refusal(why)
            return 200, "application/json", json.dumps(dict(INVENTORY, lease=self.lease))
        default = {
            "take_lease": json.dumps(LEASE),
            "extend_lease": json.dumps(LEASE),
            "release_lease": "",
        }.get(path)
        if default is None:
            return 404, "application/json", refusal(f"no such path {path}")
        return 200, "application/json", default

    def __enter__(self):
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                prefix, path = self.path.rsplit("/", 1)
                length = int(self.headers.get("content-length", 0))
                sent = json.loads(self.rfile.read(length) or "{}")
                stub.calls.append(path)
                stub.paths.append(self.path)
                if prefix != "/api/ansible":
                    status, content_type, body = 404, "application/json", refusal(f"no such path {self.path}")
                else:
                    if path == "take_lease":
                        stub.requests.append(sent)
                    elif path == "for_group":
                        stub.reads.append(sent)
                    status, content_type, body = stub.answer(path, sent)
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


RUN_ENV = (
    "CANOPY_GROUP",
    "CANOPY_GROUP_ID",
    "CANOPY_RANK",
    "CANOPY_INTENT",
    "CANOPY_LEASE",
    "CANOPY_INVENTORY_LEASE",
)


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

    def environment(self, url, **run_env):
        env = dict(
            os.environ,
            ANSIBLE_CONFIG=str(self.config),
            ANSIBLE_INVENTORY_PLUGINS=str(PLUGINS),
            ANSIBLE_CALLBACK_PLUGINS=str(CALLBACKS),
            XDG_CACHE_HOME=str(self.cache),
            CANOPY_URL=url,
        )
        for name in RUN_ENV:
            env.pop(name, None)
        env.update(run_env)
        return env

    def run_inventory(self, source, url, args=("--list",), **run_env):
        return subprocess.run(
            ["ansible-inventory", "-i", str(source), *args],
            capture_output=True,
            text=True,
            env=self.environment(url, **run_env),
            cwd=self.workdir.name,
        )

    def run_playbook(self, source, url, flags=(), **run_env):
        """A play, so the callback that gives the lease back actually fires.

        The hosts are reached over the local connection: what is under test is
        the lease around a play, not whether ansible can ssh anywhere.
        `flags` follow the playbook on the command line.
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
        return subprocess.run(
            ["ansible-playbook", "-i", str(source), str(play), *flags],
            capture_output=True,
            text=True,
            env=self.environment(url, **run_env),
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
    def test_a_host_is_named_as_canopy_serves_it(self):
        body = served()
        body["hosts"][0]["name"] = "Prod Central (Kamaka)"
        body["hosts"][0]["host_name"] = "central-as-served"
        body["hosts"][0]["address"] = "kamaka-prod-central.tailnet.ts.net"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["central"]["hosts"], ["central-as-served"])
        central = data["_meta"]["hostvars"]["central-as-served"]
        self.assertEqual(plain(central["ansible_host"]), "kamaka-prod-central.tailnet.ts.net")

    def test_a_name_the_old_rules_would_change_comes_through_as_served(self):
        body = served()
        body["hosts"][0]["host_name"] = "Prod Central (Kamaka)"
        body["hosts"][0]["address"] = "kamaka-prod-central.tailnet.ts.net"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["central"]["hosts"], ["Prod Central (Kamaka)"])

    def test_a_host_with_no_host_name_stops_the_run(self):
        body = served()
        del body["hosts"][0]["host_name"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("host_name", result.stderr)

    def test_a_host_with_no_address_says_so(self):
        body = served()
        body["hosts"][1]["address"] = None
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["facility"]["hosts"], ["facility.kamaka.example"])
        self.assertIn("holds no address for facility.kamaka.example", result.stderr)

    def test_a_host_with_no_address_key_says_so(self):
        body = served()
        del body["hosts"][1]["address"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("holds no address for facility.kamaka.example", result.stderr)

    def test_a_host_with_no_address_but_an_ansible_host_is_left_alone(self):
        body = served()
        body["hosts"][1]["address"] = None
        body["hosts"][1]["vars"]["ansible_host"] = "10.0.0.9"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("holds no address", result.stderr)

    def test_limit_selects_a_host_by_the_name_served(self):
        with StubCanopy() as canopy:
            only = self.run_inventory(
                self.source(group="kamaka"), canopy.url, args=("--list", "--limit", "facility.kamaka.example")
            )
            others = self.run_inventory(
                self.source(group="kamaka"), canopy.url, args=("--list", "--limit", "tamanu:!facility.kamaka.example")
            )
        self.assertEqual(only.returncode, 0, only.stderr)
        self.assertEqual(json.loads(only.stdout)["facility"]["hosts"], ["facility.kamaka.example"])
        self.assertEqual(others.returncode, 0, others.stderr)
        self.assertNotIn("facility", json.loads(others.stdout))


class ChoosingWhatToConfigure(PluginTestCase):
    def test_a_member_canopy_holds_but_ansible_does_not_manage_is_left_out(self):
        body = served()
        del body["hosts"][1]["own_vars"]["managed_by_ansible"]
        del body["hosts"][1]["vars"]["managed_by_ansible"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])
        self.assertNotIn("facility", data)
        self.assertIn("kamaka-prod-facility", result.stderr)

    def test_a_flag_a_member_only_inherits_does_not_make_it_managed(self):
        body = served()
        del body["hosts"][1]["own_vars"]["managed_by_ansible"]
        # still in the effective variables, as from the environment or the group
        self.assertTrue(body["hosts"][1]["vars"]["managed_by_ansible"])
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertNotIn("facility", data)
        self.assertIn("kamaka-prod-facility", result.stderr)

    def test_a_member_with_no_own_vars_at_all_is_left_out(self):
        body = served()
        body["hosts"][1]["own_vars"] = None
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("facility", json.loads(result.stdout))

    def test_a_member_whose_flag_reads_false_is_left_out(self):
        body = served()
        body["hosts"][1]["own_vars"]["managed_by_ansible"] = "false"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])
        self.assertNotIn("facility", data)

    def test_a_member_whose_flag_reads_as_yes_is_managed(self):
        body = served()
        body["hosts"][1]["own_vars"]["managed_by_ansible"] = "yes"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["facility"]["hosts"], ["facility.kamaka.example"])

    def test_an_environment_managing_nothing_stops_the_run(self):
        body = served()
        for host in body["hosts"]:
            del host["own_vars"]["managed_by_ansible"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("managed_by_ansible", result.stderr)

    def test_the_intent_reaches_the_play(self):
        lease = dict(LEASE, intent="upgrade")
        with StubCanopy(lease=lease) as canopy:
            result = self.run_inventory(
                self.source(group="kamaka"), canopy.url, CANOPY_INTENT="upgrade", CANOPY_LEASE=lease["id"]
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        hostvars = json.loads(result.stdout)["_meta"]["hostvars"]
        self.assertEqual(plain(hostvars["kamaka-prod-central"]["canopy_intent"]), "upgrade")


class WhatCanopyMaySet(PluginTestCase):
    def test_a_connection_variable_is_left_out_of_a_host(self):
        body = served()
        body["hosts"][0]["vars"]["ansible_ssh_common_args"] = "-o ProxyCommand=echo"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        hostvars = json.loads(result.stdout)["_meta"]["hostvars"]
        self.assertNotIn("ansible_ssh_common_args", hostvars["kamaka-prod-central"])
        self.assertIn("ansible_ssh_common_args is not canopy's to set", result.stderr)

    def test_a_connection_variable_is_left_out_of_the_environment(self):
        body = served()
        body["vars"]["ansible_ssh_executable"] = "/tmp/ssh"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        hostvars = json.loads(result.stdout)["_meta"]["hostvars"]
        self.assertNotIn("ansible_ssh_executable", hostvars["kamaka-prod-central"])

    def test_the_variables_a_machine_is_reached_at_still_get_through(self):
        body = served()
        body["hosts"][0]["vars"]["ansible_port"] = 2222
        body["hosts"][0]["vars"]["ansible_python_interpreter"] = "/usr/bin/python3"
        body["hosts"][0]["vars"]["ansible_timeout"] = 120
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["ansible_port"]), 2222)
        self.assertEqual(plain(central["ansible_user"]), "ubuntu")
        self.assertEqual(plain(central["ansible_python_interpreter"]), "/usr/bin/python3")
        self.assertEqual(plain(central["ansible_timeout"]), 120)

    def test_a_tag_cannot_answer_the_intent_gate(self):
        body = served()
        body["hosts"][0]["vars"]["canopy_intent"] = "upgrade"
        body["vars"]["canopy_intent"] = "upgrade"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["canopy_intent"]), "configure")

    def test_the_clone_rank_marks_a_clone(self):
        body = served(rank="clone")
        body["vars"]["tamanu_clone"] = False
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka", rank="clone"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertIs(plain(central["tamanu_clone"]), True)

    def test_other_ranks_are_not_clones(self):
        body = served()
        body["vars"]["tamanu_clone"] = True
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka", rank="production"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertIs(plain(central["tamanu_clone"]), False)


class Refusing(PluginTestCase):
    def test_a_refusal_stops_the_run(self):
        problem = refusal('not found: no server group named "nope"')
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
        body = served()
        body["hosts"][1]["host_name"] = body["hosts"][0]["host_name"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("two servers named 'kamaka-prod-central'", result.stderr)

    def test_an_address_ssh_would_read_as_an_option_stops_the_run(self):
        body = served()
        body["hosts"][0]["address"] = "-oProxyCommand=echo"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("is not a name or an IP", result.stderr)

    def test_an_ansible_host_ssh_would_read_as_an_option_stops_the_run(self):
        body = served()
        body["hosts"][0]["vars"]["ansible_host"] = "-oProxyCommand=echo"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("is not a name or an IP", result.stderr)

    def test_reading_canopy_in_the_clear_stops_the_run(self):
        result = self.run_inventory(self.source(group="kamaka"), "http://canopy.example")
        self.assertEqual(result.returncode, 1)
        self.assertIn("is not https", result.stderr)

    def test_no_canopy_address_stops_the_run(self):
        result = self.run_inventory(self.source(group="kamaka"), "")
        self.assertEqual(result.returncode, 1)
        self.assertIn("set CANOPY_URL", result.stderr)

    def test_a_redirect_names_the_url_rather_than_canopy(self):
        with StubCanopy(status=302, location="/api/ansible/for_group/") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("redirects to", result.stderr)
        self.assertIn("CANOPY_URL", result.stderr)


class WhenCanopyCannotBeReached(PluginTestCase):
    """Canopy not answering stops the run, as a refusal does: nothing is
    cached, so a run never acts on what canopy said earlier."""

    def test_a_server_error_stops_the_run(self):
        with StubCanopy(status=502, body="<html>bad gateway</html>", content_type="text/html") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("canopy could not be reached", result.stderr)
        self.assertIn("502", result.stderr)

    def test_a_server_error_from_the_lease_stops_the_run(self):
        with StubCanopy(status=503, body="down", content_type="text/plain", on="take_lease") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("canopy could not be reached", result.stderr)
        self.assertEqual(canopy.calls, ["take_lease"])

    def test_a_canopy_that_is_not_there_stops_the_run(self):
        with StubCanopy() as canopy:
            url = canopy.url
        result = self.run_inventory(self.source(group="kamaka"), url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("canopy could not be reached", result.stderr)

    def test_a_cache_left_by_an_earlier_version_is_not_read(self):
        left = self.cache / "canopy-inventory" / "kamaka-000000000000.json"
        left.parent.mkdir(parents=True)
        left.write_text(json.dumps(INVENTORY))
        with StubCanopy(status=502, body="nope", content_type="text/plain") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("kamaka-prod-central", result.stdout)

    def test_a_good_read_writes_nothing_to_the_cache_directory(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.cache.exists())

    def test_the_offline_variable_does_nothing(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url, CANOPY_INVENTORY_OFFLINE="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])

    def test_the_lease_is_given_back_when_the_read_is_not_answered(self):
        with StubCanopy(status=502, body="nope", content_type="text/plain") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])


class SecretVariables(PluginTestCase):
    def test_a_secret_value_reaches_the_run(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        hostvars = json.loads(result.stdout)["_meta"]["hostvars"]
        self.assertEqual(plain(hostvars["kamaka-prod-central"]["salt"]), "pepper")
        self.assertEqual(plain(hostvars["kamaka-prod-central"]["tls_dns_access_key"]), "vinegar")
        self.assertEqual(plain(hostvars["facility.kamaka.example"]["salt"]), "pepper")


class ConfiguringTheSource(PluginTestCase):
    def test_naming_neither_a_group_nor_an_identifier_stops_the_run(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one of group or group_id", result.stderr)
        self.assertEqual(canopy.calls, [])

    def test_naming_both_stops_the_run(self):
        source = self.source(group="kamaka", group_id="11111111-0000-4000-8000-000000000001")
        with StubCanopy() as canopy:
            result = self.run_inventory(source, canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one of group or group_id", result.stderr)


class DeclaringIntent(PluginTestCase):
    def test_the_run_declares_its_intent(self):
        with StubCanopy(lease=dict(LEASE, intent="upgrade")) as canopy:
            result = self.run_inventory(
                self.source(), canopy.url, CANOPY_GROUP="kamaka", CANOPY_INTENT="upgrade"
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.requests, [{"group": "kamaka", "intent": "upgrade"}])

    def test_an_upgrade_declares_its_intent(self):
        with StubCanopy(lease=dict(LEASE, intent="upgrade")) as canopy:
            result = self.run_inventory(self.source(group="kamaka", intent="upgrade"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.requests, [{"group": "kamaka", "intent": "upgrade"}])

    def test_configuring_declares_nothing(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka", intent="configure"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.requests, [{"group": "kamaka"}])

    def test_an_unplanned_upgrade_is_refused(self):
        problem = refusal(
            'conflict: server group "kamaka" has no upgrade plan; record one before upgrading production'
        )
        with StubCanopy(status=409, body=problem, on="take_lease") as canopy:
            result = self.run_inventory(self.source(group="kamaka", intent="upgrade"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("no upgrade plan", result.stderr)

    def test_the_intent_of_the_play_is_the_one_the_lease_declares(self):
        with StubCanopy(lease=dict(LEASE, intent="upgrade")) as canopy:
            result = self.run_inventory(self.source(group="kamaka", intent="upgrade"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["canopy_intent"]), "upgrade")


class HoldingTheEnvironment(PluginTestCase):
    """Canopy serves the inventory to the holder of the environment's run
    lease, so reading one is a take, a read, and a give back."""

    def test_the_read_is_taken_under_a_lease(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka", rank="production"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])
        self.assertEqual(canopy.requests, [{"group": "kamaka", "rank": "production"}])
        self.assertEqual(canopy.reads, [{"lease_id": LEASE["id"]}])

    def test_the_paths_are_the_ansible_ones(self):
        with StubCanopy() as canopy:
            self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(
            canopy.paths,
            [f"/api/ansible/{call}" for call in ("take_lease", "for_group", "release_lease")],
        )

    def test_a_give_back_after_a_failed_read_uses_the_ansible_path(self):
        with StubCanopy(status=409, body=refusal("conflict: no"), on="for_group") as canopy:
            self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(canopy.paths[-1], "/api/ansible/release_lease")

    def test_a_refused_lease_stops_the_run_without_reading(self):
        problem = refusal("conflict: that environment's run lease is held by bob@example.com until 00:30 UTC")
        with StubCanopy(status=409, body=problem, on="take_lease") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("held by bob@example.com", result.stderr)
        self.assertEqual(canopy.calls, ["take_lease"])

    def test_a_refusal_from_the_read_gives_the_lease_back(self):
        problem = refusal('conflict: machines "a" and "b" are both reached at "x"')
        with StubCanopy(status=409, body=problem, on="for_group") as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertIn("both reached at", result.stderr)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])

    def test_a_play_holds_the_lease_and_gives_it_back_at_the_end(self):
        with StubCanopy() as canopy:
            result = self.run_playbook(self.source(group="kamaka", rank="production"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])

    def test_a_run_that_takes_its_own_lease_claims_nothing(self):
        with StubCanopy() as canopy:
            result = self.run_playbook(
                self.source(group="kamaka"), canopy.url, flags=("--limit", "central", "--tags", "app")
            )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(canopy.reads, [{"lease_id": LEASE["id"]}])

    def test_a_payload_that_makes_no_inventory_gives_the_lease_back(self):
        body = served()
        for host in body["hosts"]:
            del host["own_vars"]["managed_by_ansible"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])

    def test_an_odd_answer_to_the_release_leaves_the_real_error_standing(self):
        body = served()
        for host in body["hosts"]:
            del host["own_vars"]["managed_by_ansible"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            canopy.also["release_lease"] = (200, "text/html", "<html>done</html>")
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])
        self.assertIn("managed_by_ansible", result.stderr)
        self.assertIn("could not release the run lease", result.stderr)

    def test_a_run_that_cannot_give_the_lease_back_takes_none(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(
                self.source(group="kamaka"), canopy.url, ANSIBLE_CALLBACK_PLUGINS=""
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("canopy_lease", result.stderr)
        self.assertEqual(canopy.calls, [])

    def test_a_listing_gives_the_lease_back(self):
        # No play runs, so no callback ends one; the plugin gives it back as
        # the process exits rather than holding the environment until expiry.
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("release_lease", canopy.calls)


class GroupingAMachine(PluginTestCase):
    def test_a_machine_is_grouped_by_the_applications_on_it(self):
        body = served()
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

    def empty_facility(self, **changes):
        body = served()
        body["hosts"][1]["applications"] = []
        body["hosts"][1].update(changes)
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_a_machine_carrying_nothing_is_in_no_product_group(self):
        data = self.empty_facility()
        self.assertNotIn("facility", data)
        # It is still a host a play acts on, carrying its variables.
        self.assertIn("facility.kamaka.example", data["_meta"]["hostvars"])
        self.assertIn("facility.kamaka.example", data["all"]["children"] + data.get("ungrouped", {}).get("hosts", []))

    def test_a_machine_carrying_nothing_is_grouped_by_its_assigned_facility_type(self):
        data = self.empty_facility(assigned_type="tamanu-facility")
        self.assertEqual(data["facility"]["hosts"], ["facility.kamaka.example"])
        self.assertIn("facility.kamaka.example", data["tamanu"]["hosts"])

    def test_a_machine_carrying_nothing_is_grouped_by_its_assigned_central_type(self):
        data = self.empty_facility(assigned_type="tamanu-central")
        self.assertIn("facility.kamaka.example", data["central"]["hosts"])
        self.assertIn("facility.kamaka.example", data["tamanu"]["hosts"])
        self.assertNotIn("facility", data)

    def test_an_assigned_type_naming_no_role_is_a_standalone(self):
        data = self.empty_facility(assigned_type="senaite")
        self.assertIn("facility.kamaka.example", data["senaite"]["hosts"])
        self.assertIn("facility.kamaka.example", data["standalone"]["hosts"])

    def test_an_assigned_type_does_not_add_to_the_applications_on_a_machine(self):
        body = served()
        body["hosts"][1]["assigned_type"] = "tamanu-central"
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["central"]["hosts"], ["kamaka-prod-central"])
        self.assertEqual(data["facility"]["hosts"], ["facility.kamaka.example"])

    def test_a_machine_carrying_nothing_that_is_not_managed_is_left_out(self):
        body = served()
        body["hosts"][1]["applications"] = []
        body["hosts"][1]["assigned_type"] = "tamanu-facility"
        del body["hosts"][1]["own_vars"]["managed_by_ansible"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("facility", json.loads(result.stdout))
        self.assertIn("kamaka-prod-facility", result.stderr)


class BeingHandedALease(PluginTestCase):
    """Canopy's run dialog takes the lease in the browser and hands it over in
    the command, so the run reads under it rather than taking one."""

    def run_handed(self, canopy, lease=None, **run_env):
        return self.run_inventory(
            self.source(), canopy.url, CANOPY_LEASE=(lease or LEASE)["id"], **run_env
        )

    def test_it_reads_under_the_lease_it_was_handed_and_takes_none(self):
        with StubCanopy() as canopy:
            result = self.run_handed(canopy)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("take_lease", canopy.calls)
        self.assertEqual(canopy.reads, [{"lease_id": LEASE["id"]}])

    def test_the_run_needs_no_group_rank_or_intent(self):
        with StubCanopy() as canopy:
            result = self.run_handed(canopy)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.requests, [])
        self.assertEqual(json.loads(result.stdout)["central"]["hosts"], ["kamaka-prod-central"])

    def test_a_source_file_naming_nothing_is_not_an_error(self):
        with StubCanopy() as canopy:
            result = self.run_handed(canopy)
        self.assertNotIn("exactly one of group or group_id", result.stderr)

    def test_the_group_and_rank_canopy_serves_are_the_ones_used(self):
        body = served(rank="clone")
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_handed(canopy, CANOPY_GROUP="other", CANOPY_RANK="demo")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.requests, [])
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertIs(plain(central["tamanu_clone"]), True)

    def test_without_a_handed_lease_the_run_takes_its_own(self):
        with StubCanopy() as canopy:
            result = self.run_inventory(self.source(group="kamaka"), canopy.url)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.calls[:2], ["take_lease", "for_group"])

    def test_the_intent_canopy_serves_is_the_intent_of_the_run(self):
        lease = dict(LEASE, intent="upgrade")
        with StubCanopy(lease=lease) as canopy:
            result = self.run_handed(canopy, lease)
        self.assertEqual(result.returncode, 0, result.stderr)
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["canopy_intent"]), "upgrade")
        self.assertNotIn("intent", canopy.reads[0])

    def test_a_named_intent_is_sent_as_the_one_claimed(self):
        lease = dict(LEASE, intent="upgrade")
        with StubCanopy(lease=lease) as canopy:
            result = self.run_handed(canopy, lease, CANOPY_INTENT="upgrade")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.reads, [{"lease_id": lease["id"], "intent": "upgrade"}])
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["canopy_intent"]), "upgrade")

    def test_an_intent_the_lease_does_not_declare_stops_the_run(self):
        with StubCanopy() as canopy:
            result = self.run_handed(canopy, CANOPY_INTENT="upgrade")
        self.assertEqual(result.returncode, 1)
        self.assertIn("claims the intent upgrade, but the lease is for configure", result.stderr)

    def test_a_named_intent_does_not_become_the_intent_of_the_run(self):
        # canopy would refuse this, so what the stub serves is what the run uses
        body = served()
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_handed(canopy, CANOPY_INTENT="upgrade")
        self.assertEqual(result.returncode, 0, result.stderr)
        central = json.loads(result.stdout)["_meta"]["hostvars"]["kamaka-prod-central"]
        self.assertEqual(plain(central["canopy_intent"]), "configure")

    def test_a_handed_lease_that_is_not_held_stops_the_run_and_takes_none(self):
        problem = refusal("conflict: that run lease is held by bob@example.com")
        with StubCanopy(status=409, body=problem) as canopy:
            result = self.run_handed(canopy)
        self.assertEqual(result.returncode, 1)
        self.assertIn("held by bob@example.com", result.stderr)
        self.assertNotIn("take_lease", canopy.calls)

    def test_a_listing_releases_the_lease_on_exit(self):
        with StubCanopy() as canopy:
            result = self.run_handed(canopy)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.calls, ["for_group", "release_lease"])

    def test_a_play_is_released_at_the_end(self):
        with StubCanopy() as canopy:
            result = self.run_playbook(self.source(), canopy.url, CANOPY_LEASE=LEASE["id"])
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(canopy.calls, ["for_group", "release_lease"])

    def test_an_inventory_that_builds_nothing_releases_the_lease_before_stopping(self):
        body = served()
        for host in body["hosts"]:
            del host["own_vars"]["managed_by_ansible"]
        with StubCanopy(body=json.dumps(body)) as canopy:
            result = self.run_handed(canopy)
        self.assertEqual(result.returncode, 1)
        self.assertIn("managed_by_ansible", result.stderr)
        self.assertEqual(canopy.calls, ["for_group", "release_lease"])

    def test_an_unreachable_read_releases_the_lease_and_stops_the_run(self):
        with StubCanopy(status=502, body="nope", content_type="text/plain") as canopy:
            result = self.run_handed(canopy)
        self.assertEqual(result.returncode, 1)
        self.assertIn("canopy could not be reached", result.stderr)
        self.assertEqual(canopy.calls, ["for_group", "release_lease"])

    def test_a_run_whose_keeper_is_not_loaded_stops_before_reading(self):
        with StubCanopy() as canopy:
            result = self.run_handed(canopy, ANSIBLE_CALLBACK_PLUGINS="")
        self.assertEqual(result.returncode, 1)
        self.assertIn("canopy_lease", result.stderr)
        self.assertEqual(canopy.calls, [])

    def test_the_variable_the_callback_reads_is_not_the_one_it_was_handed_in(self):
        # CANOPY_INVENTORY_LEASE alone, set by hand, starts nothing: only the
        # plugin sets it, after a read.
        with StubCanopy() as canopy:
            result = self.run_playbook(
                self.source(group="kamaka"),
                canopy.url,
                CANOPY_INVENTORY_LEASE=json.dumps({"url": canopy.url, "lease_id": "someone-elses"}),
            )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(canopy.calls, ["take_lease", "for_group", "release_lease"])


class ClaimingTheRun(PluginTestCase):
    """A run over a handed lease says what it was started with, and canopy
    holds it against what the lease records."""

    PLAYBOOK = "play.yml"

    def lease(self, **changes):
        return dict(LEASE, playbook=self.PLAYBOOK, **changes)

    def run_claimed(self, canopy, flags=(), lease=None, **run_env):
        return self.run_playbook(
            self.source(), canopy.url, flags=flags, CANOPY_LEASE=(lease or canopy.lease)["id"], **run_env
        )

    def test_it_sends_what_the_run_was_started_with(self):
        lease = self.lease(limit_pattern="central", tags=["app", "base"], skip_tags=["pre"])
        with StubCanopy(lease=lease) as canopy:
            result = self.run_claimed(
                canopy, ("--limit", "central", "--tags", "base,app", "--skip-tags", "pre")
            )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(
            canopy.reads,
            [
                {
                    "lease_id": lease["id"],
                    "playbook": "play.yml",
                    "limit": "central",
                    "tags": ["app", "base"],
                    "skip_tags": ["pre"],
                }
            ],
        )

    def test_no_limit_or_tags_claim_none(self):
        with StubCanopy(lease=self.lease()) as canopy:
            result = self.run_claimed(canopy)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(
            canopy.reads,
            [{"lease_id": LEASE["id"], "playbook": "play.yml", "limit": "", "tags": [], "skip_tags": []}],
        )

    def test_tags_given_in_either_form_claim_the_same_tags(self):
        sent = []
        for flags in (("--tags", "a,b"), ("--tags", "b", "--tags", "a")):
            with StubCanopy(lease=self.lease(tags=["a", "b"])) as canopy:
                result = self.run_claimed(canopy, flags)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            sent.append(canopy.reads[0]["tags"])
        self.assertEqual(sent, [["a", "b"], ["a", "b"]])

    def test_a_path_to_the_playbook_claims_its_file_name(self):
        with StubCanopy(lease=self.lease()) as canopy:
            result = self.run_claimed(canopy)
        # run_playbook passes an absolute path
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(canopy.reads[0]["playbook"], "play.yml")

    def test_more_than_one_playbook_stops_the_run_before_any_read(self):
        Path(self.workdir.name, "other.yml").write_text("[]\n")
        with StubCanopy(lease=self.lease()) as canopy:
            result = self.run_claimed(canopy, ("other.yml",))
        self.assertEqual(result.returncode, 1)
        self.assertIn("runs one playbook", result.stderr)
        self.assertEqual(canopy.calls, [])

    def test_a_different_limit_is_refused_and_adds_no_host(self):
        with StubCanopy(lease=self.lease(limit_pattern="central")) as canopy:
            result = self.run_claimed(canopy, ("--limit", "facility"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("limits to 'facility', but the lease limits to 'central'", result.stderr)
        self.assertNotIn("kamaka-prod-central", result.stdout)

    def test_a_missing_limit_is_refused_where_the_lease_has_one(self):
        with StubCanopy(lease=self.lease(limit_pattern="central")) as canopy:
            result = self.run_claimed(canopy)
        self.assertEqual(result.returncode, 1)
        self.assertIn("limits to ''", result.stderr)

    def test_different_tags_are_refused(self):
        with StubCanopy(lease=self.lease(tags=["app"])) as canopy:
            result = self.run_claimed(canopy, ("--tags", "base"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("has tags ['base'], but the lease has ['app']", result.stderr)

    def test_different_skipped_tags_are_refused(self):
        with StubCanopy(lease=self.lease(skip_tags=["pre"])) as canopy:
            result = self.run_claimed(canopy, ("--skip-tags", "go"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("has skip_tags ['go'], but the lease has ['pre']", result.stderr)

    def test_a_different_playbook_is_refused(self):
        with StubCanopy(lease=dict(LEASE, playbook="tamanu-install.yml")) as canopy:
            result = self.run_claimed(canopy)
        self.assertEqual(result.returncode, 1)
        self.assertIn("this run is play.yml, but the lease is for tamanu-install.yml", result.stderr)

    def test_a_lease_that_records_no_playbook_still_accepts_the_run_and_claims_the_rest(self):
        with StubCanopy(lease=dict(LEASE, limit_pattern="central")) as canopy:
            result = self.run_claimed(canopy, ("--limit", "central"))
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(canopy.reads[0]["limit"], "central")

    def test_a_refused_claim_gives_the_lease_back(self):
        with StubCanopy(lease=self.lease(limit_pattern="central")) as canopy:
            self.run_claimed(canopy, ("--limit", "facility"))
        self.assertEqual(canopy.calls, ["for_group", "release_lease"])

    def test_a_listing_claims_no_playbook_limit_or_tags(self):
        lease = self.lease(limit_pattern="central", tags=["app"])
        with StubCanopy(lease=lease) as canopy:
            result = self.run_inventory(self.source(), canopy.url, CANOPY_LEASE=lease["id"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(canopy.reads, [{"lease_id": lease["id"]}])


if __name__ == "__main__":
    unittest.main()
