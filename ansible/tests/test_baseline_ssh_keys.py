"""What the baseline does to the authorized keys of the ubuntu user.

The removal task is run for real against a temporary file, so the pattern it
matches on is the one that is tested, with the user lookup and privilege
escalation left out because they need a real ubuntu user and root.
"""

import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

ANSIBLE = Path(__file__).resolve().parent.parent
TASKS = ANSIBLE / "roles/baseline/tasks/ssh-keys.yml"

EMERGENCY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOpCpG0MNsBX6nNbq4jMMJwbw5c4PbuH1xBfDeNq8d0u emergency@tamanu"
OTHER = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA someone@example"
OTHER_RSA = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC0000000000000000000 laptop"


def run_removal(content):
    task = next(t for t in yaml.safe_load(TASKS.read_text()) if "ansible.builtin.lineinfile" in t)
    lineinfile = dict(task["ansible.builtin.lineinfile"])
    with tempfile.TemporaryDirectory() as directory:
        keys = Path(directory) / "authorized_keys"
        if content is not None:
            keys.write_text(content)
        lineinfile["path"] = str(keys)
        playbook = [
            {
                "hosts": "localhost",
                "gather_facts": False,
                "tasks": [{"ansible.builtin.lineinfile": lineinfile}],
            }
        ]
        path = Path(directory) / "playbook.yml"
        path.write_text(yaml.safe_dump(playbook))
        result = subprocess.run(
            ["ansible-playbook", "-i", "localhost,", "-c", "local", str(path)],
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
        )
        if result.returncode != 0:
            raise AssertionError(result.stdout + result.stderr)
        return keys.read_text() if keys.exists() else None


class TheEmergencyKeyRemoval(unittest.TestCase):
    def test_removes_the_key_and_keeps_every_other_line(self):
        content = f"{OTHER}\n{EMERGENCY}\n{OTHER_RSA}\n"
        self.assertEqual(run_removal(content), f"{OTHER}\n{OTHER_RSA}\n")

    def test_removes_the_key_whatever_its_comment_or_options(self):
        content = f'{OTHER}\nno-pty {EMERGENCY.rsplit(" ", 1)[0]} renamed\n'
        self.assertEqual(run_removal(content), f"{OTHER}\n")

    def test_leaves_a_file_without_the_key_alone(self):
        content = f"{OTHER}\n{OTHER_RSA}\n"
        self.assertEqual(run_removal(content), content)

    def test_a_missing_file_is_not_an_error_and_stays_missing(self):
        self.assertIsNone(run_removal(None))


if __name__ == "__main__":
    unittest.main()
