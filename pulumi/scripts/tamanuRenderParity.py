#!/usr/bin/env python3
"""Compares what infra-argo-tamanu-renderer renders for a stack with what is live.

For each stack it renders the stack's last-applied config and asks the API server
for a server-side dry-run diff of the database objects (CNPG Clusters, barman
ObjectStores and ScheduledBackups by default). Differences are what Argo CD would
change when it takes the deployment over. The sync wave annotation is ignored.

A difference is not necessarily a renderer bug: a stack not updated since the old
program changed shows what an update with that program would change too.

Usage:
  tamanuRenderParity.py --renderer PATH --k8s-core NAME --context CTX STACK...
  tamanuRenderParity.py --renderer PATH --k8s-core shared-demos-demo --context demo --all

Needs pulumi and kubectl access, and a built renderer. Stack config is taken from
the backend, with the secrets left out. Nothing is written to the cluster or state.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.realpath(__file__))
PULUMI = os.path.join(HERE, "..")
PROJECT = "tamanu-on-k8s"
ORG = "bes"

# Keys the stub acts on itself, which are not the renderer's business.
STUB_ONLY = {
    "imageTag", "appVersion", "deployment", "k8s-core", "externalNamespace",
    "deployer", "argoNamespace", "argoProject", "argoWaitMinutes",
    "rendererRepo", "rendererPath",
}


def run(*args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


def pulumi_json(directory, *args):
    out = run("pulumi", "-C", os.path.join(PULUMI, directory), *args, "--json")
    return json.loads(out.stdout) if out.returncode == 0 else {}


def cluster_facts(k8s_core):
    core = pulumi_json("k8s-core", "stack", "output", "-s", f"{ORG}/k8s-core/{k8s_core}")
    network = pulumi_json("core", "stack", "output", "-s", core["coreStackName"]).get("network", {})
    return {
        "fullName": k8s_core,
        "dnsZoneDomains": core.get("externalDnsZoneDomains", []),
        "tailscaleProxyDefaultTags": core.get("tailscaleProxyDefaultTags", []),
        "networkV4Cidr": network.get("v4Cidr"),
        "networkV6Cidr": network.get("v6Cidr"),
        "backupsBucket": core.get("backupsBucket"),
        "backupsServiceAccountArn": core.get("backupsServiceAccountArn"),
    }


def stack_params(stack, facts):
    directory = os.path.join(PULUMI, "tamanu", "on-k8s")
    full = f"{ORG}/{PROJECT}/{stack}"
    run("pulumi", "-C", directory, "config", "refresh", "-s", full)
    config = json.loads(run("pulumi", "-C", directory, "config", "-s", full, "--json").stdout)
    own = {k.split(":", 1)[1]: v for k, v in config.items() if k.startswith(f"{PROJECT}:")}
    secrets = [k for k, v in own.items() if v.get("secret")]
    if secrets:
        raise SystemExit(f"{stack}: secret config keys cannot be rendered: {secrets}")
    values = {k: v["value"] for k, v in own.items()}
    params = {
        "stack": stack,
        "imageTag": values["imageTag"],
        "config": {k: v for k, v in values.items() if k not in STUB_ONLY},
        "cluster": facts,
        "billing": {
            "stage": config.get("billing:stage", {}).get("value", "test"),
            "deployment": values.get("deployment", "engineering"),
        },
    }
    if values.get("appVersion") not in (None, "null"):
        params["appVersion"] = values["appVersion"]
    return params, values.get("namespace", f"tamanu-{stack}")


def check(stack, args, facts, kinds):
    params, namespace = stack_params(stack, facts)
    live = run("kubectl", "--context", args.context, "-n", namespace,
               "get", "cluster.postgresql.cnpg.io", "central-db", "-o", "json")
    if live.returncode == 0 and "recovery" in json.loads(live.stdout)["spec"].get("bootstrap", {}):
        # A seeded database; the stub names the snapshot it cloned.
        params["seed"] = {"snapshot": "seed-snapshot"}

    with tempfile.TemporaryDirectory() as tmp:
        params_file = os.path.join(tmp, "params.json")
        with open(params_file, "w") as f:
            json.dump(params, f)
        rendered = run(args.renderer, "--params", params_file, "--format", "json")
        if rendered.returncode != 0:
            print(f"{stack}: render failed: {rendered.stderr.strip()[:300]}")
            return
        items = [d for d in json.loads(rendered.stdout) if d["kind"] in kinds]
        manifest = os.path.join(tmp, "manifest.json")
        with open(manifest, "w") as f:
            json.dump({"apiVersion": "v1", "kind": "List", "items": items}, f)
        diff = run("kubectl", "--context", args.context, "diff", "--server-side",
                   "--force-conflicts", "-f", manifest,
                   env={**os.environ, "KUBECTL_EXTERNAL_DIFF": "diff -u"})

    # Exit code 1 means a difference; more than that is an error.
    if diff.returncode > 1:
        print(f"{stack}: kubectl diff failed: {diff.stderr.strip()[:300]}")
        return
    changes = [
        line for line in diff.stdout.splitlines()
        if re.match(r"^[+-][^+-]", line)
        and "sync-wave" not in line
        and line.strip() not in ("+  annotations:", "+    annotations:")
        and "generation:" not in line
    ]
    print(f"{stack}: {len(items)} objects, {len(changes)} changed lines")
    for line in changes[: args.limit]:
        print("   ", line[:160])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("stacks", nargs="*")
    parser.add_argument("--all", action="store_true", help="every stack whose k8s-core is --k8s-core")
    parser.add_argument("--renderer", required=True, help="path to the built infra-argo-tamanu-renderer")
    parser.add_argument("--k8s-core", required=True, help="the cluster's k8s-core stack, e.g. tamanu-internal-main")
    parser.add_argument("--context", required=True, help="kubectl context of that cluster")
    parser.add_argument("--kinds", default="Cluster,ObjectStore,ScheduledBackup")
    parser.add_argument("--limit", type=int, default=40, help="changed lines to show per stack")
    args = parser.parse_args()

    kinds = set(args.kinds.split(","))
    stacks = args.stacks
    if args.all:
        listing = pulumi_json("tamanu/on-k8s", "stack", "ls")
        stacks = [s["name"] for s in listing]
    if not stacks:
        parser.error("name stacks, or pass --all")

    facts = cluster_facts(args.k8s_core)
    for stack in stacks:
        full = f"{ORG}/{PROJECT}/{stack}"
        if args.all:
            directory = os.path.join(PULUMI, "tamanu", "on-k8s")
            run("pulumi", "-C", directory, "config", "refresh", "-s", full)
            cfg = run("pulumi", "-C", directory, "config", "get", "k8s-core", "-s", full)
            if not cfg.stdout.strip().endswith(f"/{args.k8s_core}"):
                continue
        check(stack, args, facts, kinds)


if __name__ == "__main__":
    sys.exit(main())
