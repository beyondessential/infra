"""How the baseline merges boot parameters into a kernel command line."""

import importlib.util
import unittest
from pathlib import Path

ANSIBLE = Path(__file__).resolve().parent.parent
FILTER = ANSIBLE / "roles/baseline/filter_plugins/boot_parameters.py"

spec = importlib.util.spec_from_file_location("boot_parameters", FILTER)
boot_parameters = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot_parameters)
merge_cmdline = boot_parameters.merge_cmdline

WANTED = ["slab_nomerge", "page_alloc.shuffle=1", "lockdown=integrity"]


class TheBootParameterMerge(unittest.TestCase):
    def test_appends_the_parameters_to_an_existing_line(self):
        merged = merge_cmdline("console=serial0,115200 root=LABEL=writable rootwait", WANTED)
        self.assertEqual(
            merged,
            "console=serial0,115200 root=LABEL=writable rootwait slab_nomerge page_alloc.shuffle=1 lockdown=integrity",
        )

    def test_keeps_every_other_parameter_in_order(self):
        merged = merge_cmdline("quiet splash console=tty1 root=/dev/sda1 ro", WANTED)
        self.assertTrue(merged.startswith("quiet splash console=tty1 root=/dev/sda1 ro "))

    def test_leaves_a_parameter_that_is_already_present_where_it_is(self):
        merged = merge_cmdline("slab_nomerge console=tty1", WANTED)
        self.assertEqual(merged, "slab_nomerge console=tty1 page_alloc.shuffle=1 lockdown=integrity")

    def test_updates_a_parameter_whose_value_differs_without_duplicating_it(self):
        merged = merge_cmdline("console=tty1 lockdown=confidentiality", WANTED)
        self.assertEqual(merged, "console=tty1 lockdown=integrity slab_nomerge page_alloc.shuffle=1")

    def test_removes_the_lockdown_parameter_when_it_is_unwanted(self):
        merged = merge_cmdline(
            "console=tty1 lockdown=integrity slab_nomerge",
            ["slab_nomerge"],
            ["lockdown=integrity"],
        )
        self.assertEqual(merged, "console=tty1 slab_nomerge")

    def test_removal_leaves_a_different_lockdown_value_alone(self):
        merged = merge_cmdline("lockdown=confidentiality", [], ["lockdown=integrity"])
        self.assertEqual(merged, "lockdown=confidentiality")

    def test_is_idempotent(self):
        once = merge_cmdline("console=tty1 root=LABEL=writable", WANTED)
        self.assertEqual(merge_cmdline(once, WANTED), once)

    def test_is_idempotent_when_removing(self):
        once = merge_cmdline("console=tty1 lockdown=integrity", ["slab_nomerge"], ["lockdown=integrity"])
        self.assertEqual(merge_cmdline(once, ["slab_nomerge"], ["lockdown=integrity"]), once)

    def test_collapses_the_line_to_single_spaces_and_drops_the_newline(self):
        self.assertEqual(merge_cmdline("console=tty1  ro\n", ["slab_nomerge"]), "console=tty1 ro slab_nomerge")

    def test_an_empty_line_gets_just_the_parameters(self):
        self.assertEqual(merge_cmdline("", ["slab_nomerge"]), "slab_nomerge")


if __name__ == "__main__":
    unittest.main()
