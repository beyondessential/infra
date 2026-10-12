#!/usr/bin/env python3
"""Compares rendered manifests with the inputs recorded in a Pulumi state export.

Usage: parity.py STATE.json RENDER.json [NAME-PREFIX...]

Pulumi's autonamed suffixes are mapped back to logical names, and Pulumi-only
annotations are ignored. Prints one block per resource that differs, and
exits non-zero if any do. Resources present on only one side are reported.
"""
import json
import re
import sys


def strip(obj):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k == "annotations" and isinstance(v, dict):
                v = {a: b for a, b in v.items() if not a.startswith("pulumi.com/")}
                if not v:
                    continue
            out[k] = strip(v)
        return out
    if isinstance(obj, list):
        return [strip(v) for v in obj]
    return obj


def diff(a, b, path=""):
    if type(a) != type(b):
        yield f"{path}: state={a!r} render={b!r}"
    elif isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                yield f"{path}/{k}: only in render: {b[k]!r}"
            elif k not in b:
                yield f"{path}/{k}: only in state: {a[k]!r}"
            else:
                yield from diff(a[k], b[k], f"{path}/{k}")
    elif isinstance(a, list):
        if len(a) != len(b):
            yield f"{path}: state has {len(a)} items, render has {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            yield from diff(x, y, f"{path}[{i}]")
    elif a != b:
        yield f"{path}: state={a!r} render={b!r}"


def main():
    state_path, render_path, *prefixes = sys.argv[1:]
    state = json.load(open(state_path))["deployment"]["resources"]
    render = json.load(open(render_path))

    names = {}
    by_key = {}
    for r in state:
        inp = r.get("inputs") or {}
        if "kind" not in inp:
            continue
        logical = r["urn"].split("::")[-1]
        actual = inp.get("metadata", {}).get("name")
        if actual and re.fullmatch(re.escape(logical) + r"-[0-9a-f]{8}", actual):
            names[actual] = logical
        by_key[(inp["kind"], logical)] = inp

    def rename(o):
        s = json.dumps(o)
        for actual, logical in names.items():
            s = s.replace(f'"{actual}"', f'"{logical}"')
        return json.loads(s)

    bad = 0
    seen = set()
    for r in render:
        key = (r["kind"], r["metadata"]["name"])
        if prefixes and not any(key[1].startswith(p) for p in prefixes):
            continue
        seen.add(key)
        if key not in by_key:
            print(f"{key}: not in state")
            bad += 1
            continue
        want = strip(rename(by_key[key]))
        want.get("metadata", {}).pop("name", None)
        got = strip(r)
        got.get("metadata", {}).pop("name", None)
        found = list(diff(want, got))
        if found:
            bad += 1
            print(f"{key}")
            for line in found:
                print(f"  {line}")
    for key in sorted(by_key):
        if prefixes and not any(key[1].startswith(p) for p in prefixes):
            continue
        if key not in seen:
            print(f"{key}: in state, not rendered")
            bad += 1
    print(f"{bad} differing")
    sys.exit(1 if bad else 0)


main()
