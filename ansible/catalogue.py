"""Keep the variable catalogue, variables.schema.json, in step with what the playbooks do.

Canopy reads the catalogue from this repository's main branch. Two things in it
are checked by machine rather than by whoever edits a playbook:

  tags       each playbook's x-canopy.playbooks[*].tags is what
             `ansible-playbook --list-tags` lists for it, other than `always`
             and `never`.
  validate   the file is a valid JSON Schema 2020-12 document, since Canopy
             keeps only a copy that reads as a catalogue.

    uv run python catalogue.py tags             # rewrite the tags
    uv run python catalogue.py tags --check     # fail, naming each stale playbook
    uv run python catalogue.py validate

Everything else in the file is written by hand, and a rewrite leaves it as it was.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from jsonschema.exceptions import SchemaError
from jsonschema.validators import Draft202012Validator

ANSIBLE = Path(__file__).resolve().parent
CATALOGUE = ANSIBLE / "variables.schema.json"

# Not tags a run chooses: `always` runs regardless and `never` runs only when asked for by name.
UNLISTED = {"always", "never"}

TASK_TAGS = re.compile(r"^\s*TASK TAGS: \[(.*)\]\s*$")


def listed_tags(playbook: str) -> list[str]:
    """The tags Ansible lists for a playbook, sorted, without `always` and `never`."""
    with tempfile.TemporaryDirectory() as scratch:
        # An empty config keeps the caller's own ansible.cfg out of the listing.
        config = Path(scratch, "empty.cfg")
        config.write_text("[defaults]\n")
        env = dict(os.environ, ANSIBLE_CONFIG=str(config), ANSIBLE_NOCOLOR="1")
        result = subprocess.run(
            ["ansible-playbook", "--list-tags", playbook],
            cwd=ANSIBLE,
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
            env=env,
        )
    if result.returncode != 0:
        sys.exit(f"ansible-playbook --list-tags {playbook} failed:\n{result.stdout}{result.stderr}")
    tags: set[str] = set()
    for line in result.stdout.splitlines():
        if match := TASK_TAGS.match(line):
            tags.update(tag.strip() for tag in match.group(1).split(",") if tag.strip())
    return sorted(tags - UNLISTED)


def read(path: Path) -> dict:
    return json.loads(path.read_text())


def write(path: Path, catalogue: dict) -> None:
    # The format the file is kept in: tabs, and non-ASCII left as written.
    path.write_text(json.dumps(catalogue, indent="\t", ensure_ascii=False) + "\n")


def stale_playbooks(catalogue: dict) -> dict[str, list[str]]:
    """Each playbook whose tags differ from what Ansible lists, with the tags it lists."""
    stale = {}
    for playbook, entry in catalogue["x-canopy"]["playbooks"].items():
        listed = listed_tags(playbook)
        if entry.get("tags") != listed:
            stale[playbook] = listed
    return stale


def tags(path: Path, check: bool) -> int:
    catalogue = read(path)
    stale = stale_playbooks(catalogue)
    if not stale:
        return 0
    if check:
        for playbook, listed in stale.items():
            had = set(catalogue["x-canopy"]["playbooks"][playbook].get("tags") or [])
            added, removed = sorted(set(listed) - had), sorted(had - set(listed))
            print(
                f"{playbook}: the catalogue's tags are stale"
                + (f"; missing {', '.join(added)}" if added else "")
                + (f"; no longer listed {', '.join(removed)}" if removed else ""),
                file=sys.stderr,
            )
        print(f"run `uv run python catalogue.py tags` in ansible/ and commit {path.name}", file=sys.stderr)
        return 1
    for playbook, listed in stale.items():
        catalogue["x-canopy"]["playbooks"][playbook]["tags"] = listed
        print(f"{playbook}: tags rewritten")
    write(path, catalogue)
    return 0


def validate(path: Path) -> int:
    try:
        Draft202012Validator.check_schema(read(path))
    except SchemaError as err:
        where = "/".join(str(part) for part in err.absolute_path) or "(root)"
        print(f"{path.name} is not a valid JSON Schema 2020-12 document, at {where}: {err.message}", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--file", type=Path, default=CATALOGUE, help="the catalogue to act on")
    commands = parser.add_subparsers(dest="command", required=True)
    tags_parser = commands.add_parser("tags", help="rewrite each playbook's tags from Ansible's listing")
    tags_parser.add_argument("--check", action="store_true", help="change nothing, and fail where a list is stale")
    commands.add_parser("validate", help="check the file against the 2020-12 metaschema")
    args = parser.parse_args(argv)
    if args.command == "tags":
        return tags(args.file, args.check)
    return validate(args.file)


if __name__ == "__main__":
    sys.exit(main())
