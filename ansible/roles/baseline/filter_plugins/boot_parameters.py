"""Merge kernel command-line parameters into an existing command line."""

from __future__ import annotations


def _key(token: str) -> str:
    return token.split("=", 1)[0]


def merge_cmdline(current: str, wanted: list[str], remove: list[str] | None = None) -> str:
    """Return `current` with every `wanted` parameter present and every `remove` token gone.

    Parameters in `current` that are neither wanted nor removed are kept in
    their order. A wanted parameter replaces any existing parameter with the
    same name, so a changed value is updated instead of duplicated, and one that
    is already present is left where it is. A `remove` entry matches a whole
    token, so `lockdown=integrity` leaves any other `lockdown=` value alone.
    """
    removed = set(remove or [])
    wanted_by_key = {_key(token): token for token in wanted}
    seen: set[str] = set()
    merged: list[str] = []
    for token in current.split():
        if token in removed:
            continue
        key = _key(token)
        if key in wanted_by_key:
            if key in seen:
                continue
            seen.add(key)
            merged.append(wanted_by_key[key])
        else:
            merged.append(token)
    merged.extend(token for key, token in wanted_by_key.items() if key not in seen)
    return " ".join(merged)


class FilterModule:
    def filters(self):
        return {"merge_cmdline": merge_cmdline}
