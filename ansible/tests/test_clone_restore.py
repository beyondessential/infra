"""What a clone's restore runs, and the SQL it runs, rendered and executed for real.

The SQL cases need a throwaway Postgres cluster. They skip where no initdb is
found, except in CI, where a skip would pass a suite that checked nothing.
"""

import glob
import json
import os
import re
import shlex
import shutil
import subprocess
import tempfile
import tomllib
import unittest
from pathlib import Path

import yaml

ANSIBLE = Path(__file__).resolve().parent.parent
BACKUP_DEF = ANSIBLE / "roles/postgres/templates/tamanu-postgres.toml.j2"
FORGET_SQL = ANSIBLE / "roles/postgres/files/forget-server-identity.sql"
ACCOUNT_SQL = ANSIBLE / "roles/tamanu-single-install/templates/clone-sync-account.sql.j2"
INSTALL_CONFIG_TASKS = ANSIBLE / "roles/tamanu-single-install/tasks/config.yml"
FACILITY_CONFIG = ANSIBLE / "roles/tamanu-single-install/templates/facility.json5.j2"
FACILITY_SETUP = ANSIBLE / "roles/tamanu-single-install/templates/clone-setup-facility.sh.j2"
COMMON_DEFAULTS = ANSIBLE / "roles/tamanu-single-common/defaults/main.yml"

ENCRYPTED = "S1:aXYtYnl0ZXM=:Y2lwaGVydGV4dA=="
PASSWORD = "ab" * 32


def run_playbook(directory, playbook, inventory="localhost,", extra_vars=None):
    path = Path(directory) / "playbook.yml"
    path.write_text(yaml.safe_dump(playbook))
    command = ["ansible-playbook", "-i", inventory, "-c", "local", str(path)]
    if extra_vars is not None:
        vars_file = Path(directory) / "vars.json"
        vars_file.write_text(json.dumps(extra_vars))
        command += ["-e", f"@{vars_file}"]
    result = subprocess.run(command, capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)


def render(template, gather_facts=False, **variables):
    with tempfile.TemporaryDirectory() as directory:
        dest = Path(directory) / "rendered"
        task = {"ansible.builtin.template": {"src": str(template), "dest": str(dest)}}
        playbook = [{"hosts": "localhost", "gather_facts": gather_facts, "tasks": [task]}]
        run_playbook(directory, playbook, extra_vars=variables)
        return dest.read_text()


def facility_ids(**variables):
    """What the role derives from tamanu_facility_id, evaluated as it defines it."""
    expression = yaml.safe_load(COMMON_DEFAULTS.read_text())["tamanu_facility_ids"]
    with tempfile.TemporaryDirectory() as directory:
        dest = Path(directory) / "result"
        # to_json is applied inside the braces, so the expression is wrapped
        content = "{{ (" + expression.strip("{} ") + ") | to_json }}"
        task = {"ansible.builtin.copy": {"content": content, "dest": str(dest)}}
        run_playbook(directory, [{"hosts": "localhost", "gather_facts": False, "tasks": [task]}], extra_vars=variables)
        return json.loads(dest.read_text())


class TheBackupDefinition(unittest.TestCase):
    def test_a_server_that_is_not_a_clone_keeps_the_plain_definition(self):
        self.assertEqual(
            render(BACKUP_DEF, tamanu_clone=False),
            'type = "tamanu-postgres"\n\n[postgresql]\ncluster = "main"\n',
        )

    def test_a_clone_stops_tamanu_then_forgets_rotates_starts_and_sets_up(self):
        definition = tomllib.loads(render(BACKUP_DEF, tamanu_clone=True))
        self.assertEqual([hook["command"] for hook in definition["pre_restore"]], [["/usr/bin/bestool", "tamanu", "stop"]])
        post = [" ".join(hook["command"]) for hook in definition["post_restore"]]
        self.assertEqual(len(post), 4)
        self.assertIn("/etc/bestool/forget-server-identity.sql", post[0])
        self.assertIn("podman secret create tamanu-config-key", post[1])
        self.assertEqual(post[2], "/usr/bin/bestool tamanu start")
        self.assertIn("/etc/bestool/clone-setup.sh", post[3])


class TheFacilityIdentifiers(unittest.TestCase):
    """tamanu_facility_id is one identifier or a list, and always reaches a server as a list."""

    CENTRAL = "https://central.example"

    def served_ids(self, **variables):
        """serverFacilityIds as the facility config renders it."""
        config = render(
            FACILITY_CONFIG,
            gather_facts=True,
            timezone="Pacific/Auckland",
            public_hostname="facility.example",
            tamanu_central_canonical_url=self.CENTRAL,
            salt="pepper",
            tamanu_default_department="GenericClinic",
            tamanu_default_location="GenericClinic",
            tamanu_facility_ids=facility_ids(**variables),
        )
        (line,) = re.findall(r"^\s*serverFacilityIds: (.*),$", config, re.MULTILINE)
        return json.loads(line)

    def setup_env(self, **variables):
        script = render(
            FACILITY_SETUP,
            tamanu_central_canonical_url=self.CENTRAL,
            tamanu_clone_sync_email="clone.kamaka@sync.tamanu",
            tamanu_facility_ids=facility_ids(**variables),
        )
        # the script's comments hold an apostrophe, so only the line that passes the variable is parsed
        (line,) = [line for line in script.splitlines() if "TAMANU_FACILITY_IDS" in line]
        return [word for word in shlex.split(line.rstrip().removesuffix("\\")) if word.startswith("TAMANU_FACILITY_IDS=")]

    def test_a_single_identifier_is_a_list_of_one(self):
        self.assertEqual(facility_ids(tamanu_facility_id="a"), ["a"])
        self.assertEqual(self.served_ids(tamanu_facility_id="a"), ["a"])

    def test_a_list_of_two_renders_both_and_the_config_parses(self):
        self.assertEqual(self.served_ids(tamanu_facility_id=["a", "b"]), ["a", "b"])

    def test_the_setup_script_passes_a_single_identifier_unchanged(self):
        self.assertEqual(self.setup_env(tamanu_facility_id="a"), ["TAMANU_FACILITY_IDS=a"])

    def test_the_setup_script_comma_joins_a_list(self):
        self.assertEqual(self.setup_env(tamanu_facility_id=["a", "b"]), ["TAMANU_FACILITY_IDS=a,b"])

    def test_an_identifier_with_a_quote_or_backslash_does_not_break_the_script_or_config(self):
        ids = ["o'a", "b\\c", 'd"e']
        self.assertEqual(self.served_ids(tamanu_facility_id=ids), ids)
        self.assertEqual(self.setup_env(tamanu_facility_id=ids), ["TAMANU_FACILITY_IDS=" + ",".join(ids)])

    def test_an_unset_identifier_fails_naming_the_variable(self):
        with self.assertRaises(AssertionError) as raised:
            facility_ids()
        self.assertIn("tamanu_facility_id", str(raised.exception))

    def require(self, server_type, **variables):
        """The role's check that a facility server has an identifier, run alone."""
        expression = yaml.safe_load(COMMON_DEFAULTS.read_text())["tamanu_facility_ids"]
        (check,) = yaml.safe_load(INSTALL_CONFIG_TASKS.read_text())[:1]
        play = {
            "hosts": "localhost",
            "gather_facts": False,
            "vars": {"tamanu_server_type": server_type, "tamanu_facility_ids": expression},
            "tasks": [check],
        }
        with tempfile.TemporaryDirectory() as directory:
            run_playbook(directory, [play], extra_vars=variables)

    def test_a_facility_server_without_an_identifier_is_refused_with_a_message_that_says_what_to_set(self):
        with self.assertRaises(AssertionError) as raised:
            self.require("facility")
        self.assertIn("needs tamanu_facility_id", str(raised.exception))

    def test_a_facility_server_with_an_empty_list_is_refused(self):
        with self.assertRaises(AssertionError) as raised:
            self.require("facility", tamanu_facility_id=[])
        self.assertIn("needs tamanu_facility_id", str(raised.exception))

    def test_a_facility_server_with_an_identifier_is_accepted_and_a_central_needs_none(self):
        self.require("facility", tamanu_facility_id="a")
        self.require("facility", tamanu_facility_id=["a", "b"])
        self.require("central")


class WhichClonesAreSetUpAutomatically(unittest.TestCase):
    """The rule in tamanu_clone_auto_setup, evaluated against invented inventories."""

    def auto_setup(self, inventory):
        expression = yaml.safe_load(COMMON_DEFAULTS.read_text())["tamanu_clone_auto_setup"]
        with tempfile.TemporaryDirectory() as directory:
            inventory_path = Path(directory) / "inventory.yml"
            inventory_path.write_text(yaml.safe_dump(inventory))
            result = Path(directory) / "result"
            task = {"ansible.builtin.copy": {"content": expression, "dest": str(result)}}
            playbook = [{"hosts": "facility", "gather_facts": False, "tasks": [task]}]
            run_playbook(directory, playbook, inventory=str(inventory_path))
            return result.read_text().strip()

    def inventory(self, central=True, **variables):
        children = {"facility": {"hosts": {"kamaka-facility": None}}}
        if central:
            children["central"] = {"hosts": {"kamaka-central": None}}
        return {"all": {"vars": {"tamanu_clone": True, "tamanu_version": "v2.60.0", **variables}, "children": children}}

    def test_a_clone_on_2_60_with_its_central_is_set_up(self):
        self.assertEqual(self.auto_setup(self.inventory()), "True")

    def test_a_version_without_the_v_prefix_is_read_the_same(self):
        self.assertEqual(self.auto_setup(self.inventory(tamanu_version="2.65.1")), "True")

    def test_a_clone_below_2_60_is_not(self):
        self.assertEqual(self.auto_setup(self.inventory(tamanu_version="v2.59.9")), "False")

    def test_a_clone_without_its_central_in_the_inventory_is_not(self):
        self.assertEqual(self.auto_setup(self.inventory(central=False)), "False")

    def test_a_server_that_is_not_a_clone_is_not(self):
        self.assertEqual(self.auto_setup(self.inventory(tamanu_clone=False)), "False")


def find_postgres_bin():
    for candidate in [shutil.which("initdb"), *sorted(glob.glob("/usr/lib/postgresql/*/bin/initdb"), reverse=True)]:
        if candidate:
            return Path(candidate).parent
    if os.environ.get("CI"):
        raise RuntimeError("no initdb found, and CI must run the SQL cases")
    return None


class PostgresTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bin = find_postgres_bin()
        if cls.bin is None:
            raise unittest.SkipTest("no initdb found")
        cls.dir = Path(tempfile.mkdtemp())
        data = cls.dir / "data"
        subprocess.run([cls.bin / "initdb", "-D", data, "-U", "postgres", "--auth=trust"], check=True, capture_output=True)
        options = f"-k {cls.dir} -c listen_addresses=''"
        start = [cls.bin / "pg_ctl", "-D", data, "-o", options, "-l", cls.dir / "log", "-w", "start"]
        subprocess.run(start, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.databases = 0

    @classmethod
    def tearDownClass(cls):
        subprocess.run([cls.bin / "pg_ctl", "-D", cls.dir / "data", "-m", "immediate", "stop"], capture_output=True)
        shutil.rmtree(cls.dir, ignore_errors=True)

    def setUp(self):
        type(self).databases += 1
        self.database = f"case{self.databases}"
        self.psql(f"CREATE DATABASE {self.database}", database="postgres")

    def psql(self, sql=None, file=None, database=None):
        command = [self.bin / "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", self.dir, "-U", "postgres"]
        command += ["-d", database or self.database]
        command += ["-f", file] if file else ["-c", sql]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode != 0:
            raise AssertionError(result.stderr)
        return result.stdout.strip()


TAMANU_TABLES = """
CREATE TABLE local_system_facts (key text PRIMARY KEY, value text);
CREATE TABLE local_system_secrets (key text PRIMARY KEY, value text);
CREATE TABLE settings (key text PRIMARY KEY, value jsonb, deleted_at timestamptz);
"""


class TheIdentityScrub(PostgresTestCase):
    def seed(self):
        self.psql(
            "INSERT INTO local_system_facts VALUES"
            " ('syncHost', 'https://central.example'), ('syncEmail', 'sync@example'), ('facilityIds', '[\"f\"]'),"
            f" ('deviceId', 'd'), ('metaServerId', 'm'), ('legacySecret', '{ENCRYPTED}'), ('currentSyncTick', '42');"
            f"INSERT INTO settings VALUES ('integrations.dhis2.password', to_jsonb('{ENCRYPTED}'::text), NULL),"
            " ('mail.from', to_jsonb('tamanu@example'::text), NULL);"
        )

    def assert_forgotten(self):
        self.assertEqual(self.psql("SELECT string_agg(key, ',' ORDER BY key) FROM local_system_facts"), "currentSyncTick")
        self.assertEqual(self.psql("SELECT string_agg(key, ',' ORDER BY key) FROM settings WHERE deleted_at IS NULL"), "mail.from")

    def test_a_database_with_the_function_is_handed_to_it_as_a_copy(self):
        self.psql(
            TAMANU_TABLES + "CREATE TABLE calls (copy text);"
            "CREATE FUNCTION public.forget_server_identity() RETURNS void LANGUAGE sql"
            " AS $$INSERT INTO calls VALUES (current_setting('tamanu.this_is_a_copy', true))$$;"
        )
        self.seed()
        self.psql(file=FORGET_SQL)
        self.assertEqual(self.psql("SELECT string_agg(copy, ',') FROM calls"), "true")
        self.assertEqual(self.psql("SELECT count(*) FROM local_system_facts"), "7")

    def test_a_database_without_the_function_gets_the_same_removal(self):
        self.psql(TAMANU_TABLES + "INSERT INTO local_system_secrets VALUES ('syncPassword', 'x'), ('deviceKey', 'y');")
        self.seed()
        self.psql(file=FORGET_SQL)
        self.assert_forgotten()
        self.assertEqual(self.psql("SELECT count(*) FROM local_system_secrets"), "0")

    def test_a_database_from_before_the_secrets_table(self):
        self.psql(TAMANU_TABLES + "DROP TABLE local_system_secrets;")
        self.seed()
        self.psql(file=FORGET_SQL)
        self.assert_forgotten()


class TheCloneSyncAccount(PostgresTestCase):
    EMAIL = "clone.kamaka-facility@sync.tamanu"
    FACILITIES = ["facility-o'kamaka\\1"]

    def setUp(self):
        super().setUp()
        # users_email_key is deferrable from Tamanu v2.65, which ON CONFLICT cannot use.
        self.psql(
            "CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL,"
            " display_name text NOT NULL, role text NOT NULL, kind text NOT NULL DEFAULT 'user', password text,"
            " visibility_status text NOT NULL DEFAULT 'current', deleted_at timestamptz,"
            " CONSTRAINT users_email_key UNIQUE (email) DEFERRABLE)"
        )
        self.sync_file = self.dir / f"{self.database}-account"
        self.sql = self.dir / f"{self.database}.sql"
        self.sql.write_text(
            render(
                ACCOUNT_SQL,
                tamanu_clone_sync_file=str(self.sync_file),
                tamanu_clone_sync_email=self.EMAIL,
                tamanu_facility_ids=self.FACILITIES,
            )
        )

    @property
    def NAME(self):
        return ", ".join(self.FACILITIES)

    def run_account_sql(self, password=PASSWORD):
        password_file = Path(f"{self.sync_file}.password")
        if password is None:
            password_file.unlink(missing_ok=True)
        else:
            password_file.write_text(password)
        self.psql(file=self.sql)

    def account(self):
        return self.psql(
            "SELECT display_name, role, kind, visibility_status, deleted_at IS NULL,"
            f" password = crypt('{PASSWORD}', password) FROM users WHERE email = '{self.EMAIL}'"
        )

    def test_it_creates_an_admin_sync_account_with_the_password(self):
        self.run_account_sql()
        self.assertEqual(self.account(), f"System: {self.NAME} sync (clone)|admin|sync|current|t|t")

    def test_running_it_again_changes_nothing(self):
        self.run_account_sql()
        first = self.psql(f"SELECT id FROM users WHERE email = '{self.EMAIL}'")
        self.run_account_sql()
        self.assertEqual(self.psql("SELECT id FROM users"), first)
        self.assertTrue(self.account().endswith("|t|t"))

    def test_it_restores_an_account_the_source_deleted_or_demoted(self):
        self.run_account_sql()
        self.psql(
            "UPDATE users SET role = 'practitioner', kind = 'user', visibility_status = 'historical',"
            " deleted_at = now(), password = 'other'"
        )
        self.run_account_sql()
        self.assertEqual(self.account(), f"System: {self.NAME} sync (clone)|admin|sync|current|t|t")

    def test_a_missing_password_file_creates_nothing(self):
        self.run_account_sql(password=None)
        self.assertEqual(self.psql("SELECT count(*) FROM users"), "0")

    def test_a_short_password_creates_nothing(self):
        self.run_account_sql(password="ab" * 31)
        self.assertEqual(self.psql("SELECT count(*) FROM users"), "0")

    def test_a_short_password_does_not_replace_an_existing_one(self):
        self.run_account_sql()
        self.run_account_sql(password="")
        self.assertTrue(self.account().endswith("|t|t"))


class TheCloneSyncAccountOfTwoFacilities(TheCloneSyncAccount):
    """A server serving two facilities still gets one account, named for both."""

    FACILITIES = ["facility-o'a", "facility\\b"]

    def test_there_is_one_account(self):
        self.run_account_sql()
        self.assertEqual(self.psql("SELECT count(*) FROM users"), "1")


if __name__ == "__main__":
    unittest.main()
