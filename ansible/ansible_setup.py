#!/usr/bin/env python3
"""Helper script to set up Ansible configuration with mitogen."""

import os
import site
import sys
from pathlib import Path
from shutil import copy2


def get_mitogen_path():
    """Find the mitogen installation path."""
    for path in site.getsitepackages():
        mitogen_path = Path(path) / "ansible_mitogen" / "plugins" / "strategy"
        if mitogen_path.exists():
            return str(mitogen_path)

    # Fallback: check in the current environment
    try:
        import mitogen

        mitogen_dir = Path(mitogen.__file__).parent.parent
        strategy_path = mitogen_dir / "ansible_mitogen" / "plugins" / "strategy"
        if strategy_path.exists():
            return str(strategy_path)
    except ImportError:
        pass

    return None


def create_ansible_cfg(ansible_dir, mitogen_path=None):
    """Create or update ansible.cfg file."""
    home = Path.home()
    target_cfg = home / ".ansible.cfg"
    example_cfg = ansible_dir / "example.ansible.cfg"

    if not example_cfg.exists():
        print(f"Error: {example_cfg} not found")
        return False

    # Read the example config
    with open(example_cfg, "r") as f:
        config_lines = f.readlines()

    # If mitogen path is provided, enable it in the config
    if mitogen_path:
        updated_lines = []
        in_defaults = False
        mitogen_section_found = False

        for line in config_lines:
            # Uncomment mitogen lines
            if line.strip().startswith("; strategy_plugins = "):
                updated_lines.append(f"strategy_plugins = {mitogen_path}\n")
                mitogen_section_found = True
            elif line.strip().startswith("; strategy = mitogen_linear"):
                updated_lines.append("strategy = mitogen_linear\n")
            # Comment out pipelining when mitogen is enabled
            elif line.strip() == "pipelining = True":
                updated_lines.append(";; Disabled when mitogen is enabled\n")
                updated_lines.append("; pipelining = True\n")
            else:
                updated_lines.append(line)

        config_lines = updated_lines

    # Check if target already exists
    if target_cfg.exists():
        print(f"\n{target_cfg} already exists.")
        response = input("Overwrite? [y/N]: ").strip().lower()
        if response != "y":
            print("Skipping ansible.cfg creation.")
            return True

    # Write the config
    with open(target_cfg, "w") as f:
        f.writelines(config_lines)

    print(f"Created {target_cfg}")
    if mitogen_path:
        print(f"Mitogen enabled with path: {mitogen_path}")

    return True


def setup():
    """Main setup function."""
    print("Setting up Ansible configuration...\n")

    # Find ansible directory
    ansible_dir = Path(__file__).parent

    # Get mitogen path
    print("Looking for mitogen installation...")
    mitogen_path = get_mitogen_path()

    if mitogen_path:
        print(f"Found mitogen at: {mitogen_path}")
        enable_mitogen = (
            input("\nEnable mitogen for faster execution? [Y/n]: ").strip().lower()
        )
        if enable_mitogen in ("", "y", "yes"):
            use_mitogen = True
        else:
            use_mitogen = False
            mitogen_path = None
    else:
        print("Warning: mitogen not found in Python environment")
        use_mitogen = False
        mitogen_path = None

    # Create ansible.cfg
    if not create_ansible_cfg(ansible_dir, mitogen_path if use_mitogen else None):
        sys.exit(1)

    print("\nSetup complete!")


if __name__ == "__main__":
    setup()
