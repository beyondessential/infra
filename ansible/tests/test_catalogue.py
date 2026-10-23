"""The variable catalogue, ansible/variables.schema.json, against what the playbooks and specs say."""

import contextlib
import io
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from jsonschema.validators import Draft202012Validator

import catalogue

ANSIBLE = Path(__file__).resolve().parent.parent
SPECS = ANSIBLE.parent / "docs/spec/linux"

# The tables the catalogue must describe, by spec file and the heading above the table.
TABLES = {
    "ansible.md": "Inventory variables",
    "server.md": "Inventory variables",
    "runtime.md": "Inventory variables",
    "database.md": "Inventory variables",
    "tls.md": "Inventory variables",
    "msupply.md": "Enablement",
}


def tabled_variables(spec, heading):
    """The variable names in the first column of the tables under a heading."""
    section = re.search(rf"^## {heading}\n(.*?)(?=^## |\Z)", (SPECS / spec).read_text(), re.MULTILINE | re.DOTALL)
    names = []
    for row in section.group(1).splitlines():
        if row.startswith("|") and not row.startswith("|---") and not row.startswith("| variable"):
            names += re.findall(r"`([A-Za-z_][A-Za-z0-9_]*)`", row.split("|")[1])
    return names


class CatalogueTestCase(unittest.TestCase):
    def setUp(self):
        if shutil.which("ansible-playbook") is None:
            self.skipTest("ansible-playbook is not on PATH")
        self.scratch = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.scratch, ignore_errors=True)
        self.copy = self.scratch / "variables.schema.json"
        shutil.copy(catalogue.CATALOGUE, self.copy)

    @staticmethod
    def captured_stderr():
        return contextlib.redirect_stderr(io.StringIO())

    def edit(self, change):
        data = json.loads(self.copy.read_text())
        change(data)
        catalogue.write(self.copy, data)


class TheTags(CatalogueTestCase):
    def test_the_committed_tags_are_current(self):
        self.assertEqual(catalogue.main(["tags", "--check"]), 0)

    def test_a_stale_list_fails_the_check_and_names_the_playbook(self):
        self.edit(lambda data: data["x-canopy"]["playbooks"]["tamanu-upgrade.yml"]["tags"].remove("go"))
        with self.captured_stderr() as err:
            status = catalogue.main(["--file", str(self.copy), "tags", "--check"])
        self.assertEqual(status, 1)
        self.assertIn("tamanu-upgrade.yml", err.getvalue())
        self.assertIn("missing go", err.getvalue())
        self.assertNotIn("base-install.yml", err.getvalue())

    def test_a_tag_added_to_a_role_makes_the_check_fail(self):
        # a stale list is the same as a list that does not carry a new tag
        self.edit(lambda data: data["x-canopy"]["playbooks"]["tamanu-install.yml"]["tags"].remove("caddy"))
        with self.captured_stderr() as err:
            self.assertEqual(catalogue.main(["--file", str(self.copy), "tags", "--check"]), 1)
        self.assertIn("tamanu-install.yml", err.getvalue())

    def test_regenerating_writes_the_listing_and_nothing_else(self):
        original = self.copy.read_text()
        self.edit(lambda data: data["x-canopy"]["playbooks"]["tamanu-upgrade.yml"].update(tags=["stale"]))
        self.assertEqual(catalogue.main(["--file", str(self.copy), "tags"]), 0)
        self.assertEqual(self.copy.read_text(), original)

    def test_regenerating_a_current_file_changes_no_byte(self):
        before = self.copy.read_bytes()
        self.assertEqual(catalogue.main(["--file", str(self.copy), "tags"]), 0)
        self.assertEqual(self.copy.read_bytes(), before)

    def test_the_tags_are_sorted_without_always_and_never(self):
        for playbook, entry in json.loads(self.copy.read_text())["x-canopy"]["playbooks"].items():
            self.assertEqual(entry["tags"], sorted(entry["tags"]), playbook)
            self.assertFalse({"always", "never"} & set(entry["tags"]), playbook)

    def test_a_playbook_with_no_tags_but_always_has_an_empty_list(self):
        playbook = self.scratch / "plain.yml"
        playbook.write_text(
            "- hosts: localhost\n  tasks:\n    - ansible.builtin.debug: msg=x\n      tags: [always]\n"
            "    - ansible.builtin.debug: msg=y\n      tags: [never]\n"
        )
        self.assertEqual(catalogue.listed_tags(str(playbook)), [])


class TheDocument(CatalogueTestCase):
    def test_the_committed_file_is_a_valid_2020_12_schema(self):
        self.assertEqual(catalogue.main(["validate"]), 0)
        self.assertEqual(json.loads(self.copy.read_text())["$schema"], "https://json-schema.org/draft/2020-12/schema")

    def test_an_invalid_file_fails_the_check(self):
        self.edit(lambda data: data["properties"]["timezone"].update(type="stringy"))
        with self.captured_stderr() as err:
            self.assertEqual(catalogue.main(["--file", str(self.copy), "validate"]), 1)
        self.assertIn("not a valid JSON Schema 2020-12 document", err.getvalue())


class TheVariables(unittest.TestCase):
    def setUp(self):
        self.catalogue = json.loads(catalogue.CATALOGUE.read_text())
        self.properties = self.catalogue["properties"]

    def test_every_tabled_variable_has_an_entry(self):
        for spec, heading in TABLES.items():
            names = tabled_variables(spec, heading)
            self.assertTrue(names, f"{spec} has no variables under {heading}")
            for name in names:
                self.assertIn(name, self.properties, f"{name} of {spec}")

    def test_the_managed_flag_the_accepted_ansible_names_and_the_reserved_ones_have_entries(self):
        for name in (
            "managed_by_ansible",
            "ansible_host",
            "ansible_user",
            "ansible_port",
            "ansible_python_interpreter",
            "ansible_timeout",
        ):
            self.assertIn(name, self.properties)
            self.assertFalse(self.properties[name].get("x-canopy", {}).get("reserved"), name)
        for name in ("canopy_intent", "tamanu_clone"):
            self.assertTrue(self.properties[name]["x-canopy"]["reserved"], name)

    def test_the_facility_identifier_takes_a_string_or_a_non_empty_list(self):
        validator = Draft202012Validator(self.properties["tamanu_facility_id"])
        self.assertTrue(validator.is_valid("a"))
        self.assertTrue(validator.is_valid(["a", "b"]))
        self.assertFalse(validator.is_valid([]))
        self.assertFalse(validator.is_valid(3))
        self.assertFalse(validator.is_valid([3]))


if __name__ == "__main__":
    unittest.main()
