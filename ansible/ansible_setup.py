#!/usr/bin/env python3
"""Helper script to set up Ansible configuration with pipelining."""

import sys
from pathlib import Path


def check_mitogen_config(config_path):
    """Check if the config file has mitogen enabled."""
    if not config_path.exists():
        return False

    with open(config_path, "r") as f:
        content = f.read()

    return "strategy_plugins" in content or "strategy = mitogen_linear" in content


def remove_mitogen_config(config_lines):
    """Remove mitogen configuration from config lines."""
    cleaned_lines = []
    skip_next = False

    for i, line in enumerate(config_lines):
        if skip_next:
            skip_next = False
            continue

        stripped = line.strip()

        # Skip mitogen strategy lines
        if stripped.startswith("strategy_plugins ="):
            continue
        if stripped.startswith("strategy = mitogen_linear"):
            continue

        # Re-enable pipelining if it was disabled for mitogen
        if stripped.startswith(";; Disabled when mitogen"):
            skip_next = True
            continue
        if stripped.startswith("; pipelining = True"):
            cleaned_lines.append("pipelining = True\n")
            continue

        cleaned_lines.append(line)

    return cleaned_lines


def create_ansible_cfg(ansible_dir):
    """Create or update ansible.cfg file."""
    home = Path.home()
    target_cfg = home / ".ansible.cfg"
    example_cfg = ansible_dir / "example.ansible.cfg"

    if not example_cfg.exists():
        print(f"Error: {example_cfg} not found")
        return False

    # Check if target already exists and has mitogen config
    has_mitogen = False
    if target_cfg.exists():
        has_mitogen = check_mitogen_config(target_cfg)
        if has_mitogen:
            print(f"\nDetected mitogen configuration in {target_cfg}")
            print("Removing mitogen and enabling pipelining instead...")

            with open(target_cfg, "r") as f:
                config_lines = f.readlines()

            config_lines = remove_mitogen_config(config_lines)

            with open(target_cfg, "w") as f:
                f.writelines(config_lines)

            print(f"Updated {target_cfg}")
            print("Mitogen configuration removed, pipelining enabled")
            return True
        else:
            print(f"\n{target_cfg} already exists.")
            response = input("Overwrite? [y/N]: ").strip().lower()
            if response != "y":
                print("Skipping ansible.cfg creation.")
                return True

    # Read the example config (already has pipelining enabled)
    with open(example_cfg, "r") as f:
        config_lines = f.readlines()

    # Write the config
    with open(target_cfg, "w") as f:
        f.writelines(config_lines)

    print(f"Created {target_cfg}")
    print("Pipelining enabled for faster execution")

    return True


def setup():
    """Main setup function."""
    print("Setting up Ansible configuration...\n")

    ansible_dir = Path(__file__).parent

    if not create_ansible_cfg(ansible_dir):
        sys.exit(1)

    print("\nSetup complete!")


if __name__ == "__main__":
    setup()
