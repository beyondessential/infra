# Reference: Linux inventory

The Ansible inventory of a Linux deployment is served by Canopy, not by files in the repository.
The spec is [LNXANS](../spec/linux/ansible.md#inventory); this page is how to read it and what it contains.
The plugin is `ansible/inventory_plugins/canopy.py`, the lease keeper is `ansible/callback_plugins/canopy_lease.py`, and the one source file is `ansible/inventory/canopy.yml`, which names no deployment.

## Selecting a deployment

| variable | meaning |
|---|---|
| `CANOPY_URL` | Base URL of Canopy's operator interface. Must be `https`, or a loopback address. |
| `CANOPY_LEASE` | A run lease already taken, which Canopy's run dialog hands over in the command it shows ([handed lease](#a-handed-lease)). With it, the three below are not needed. |
| `CANOPY_GROUP` or `CANOPY_GROUP_ID` | The Canopy group (name or id). Give exactly one. |
| `CANOPY_RANK` | The rank within the group, such as `production`, `demo` or `clone`. Needed where a group holds more than one rank. |
| `CANOPY_INTENT` | `configure` (the default) or `upgrade`. Under a handed lease it is the intent the run claims. |

The run needs `callback_plugins = ./callback_plugins` and `inventory_plugins = ./inventory_plugins` in the `ansible.cfg` it picks up; `ansible/setup.sh` writes `~/.ansible.cfg` from `example.ansible.cfg` with both.
The plugin stops if the callback is not loaded, because nothing would give the lease back.

```sh
cd ansible
CANOPY_URL=<canopy url> CANOPY_GROUP=<group> CANOPY_RANK=<rank> uv run ansible-playbook -i inventory/canopy.yml <playbook>
```

Reading the inventory needs Canopy administrator access, because the answer carries the deployment's secret variables.

## The run lease

Reading holds Canopy's run lease on the environment, served to one operator at a time.
The callback extends it every 8 minutes while the play runs and releases it when the play ends.
A run that dies leaves a lease that expires on its own, 30 minutes after the last extension, per the callback comment.
A second operator reading the same environment is refused until then ([playbook refused](../runbooks/linux-playbook-refused.md)).

### A handed lease

Canopy's run dialog takes the lease in the browser and shows the command to run, with the lease in `CANOPY_LEASE`:

```sh
CANOPY_URL=<canopy url> CANOPY_LEASE=<id> uv run ansible-playbook -i inventory/canopy.yml <playbook> --limit '<pattern>' --tags <tags>
```

The run takes no lease of its own, and takes the group, rank and intent from the lease: `CANOPY_GROUP`, `CANOPY_GROUP_ID` and `CANOPY_RANK` are not read.
It sends Canopy the playbook, limit, tags, skipped tags and, where `CANOPY_INTENT` is set, the intent that it was started with.
Canopy refuses the read where any of them differs from what the lease records, and the run stops with Canopy's reason before it is recorded as started.
Paste the command exactly as the dialog shows it.
The callback extends and releases a handed lease as it does one the run took.

Running a playbook without `CANOPY_LEASE` takes a lease as before, and claims nothing.
An inventory listing (`ansible-inventory`) over a handed lease claims no playbook, limit or tags, and releases the lease when it exits.

## What the inventory contains

| item | rule |
|---|---|
| Hosts | Only machines whose own variables set `managed_by_ansible`. A value a machine only inherits from its environment or group does not count. Others are left out with a warning that lists them, and none managed is an error. |
| Host name | The `host_name` Canopy serves for the machine, the name its limit preview uses. The plugin derives none; two machines with the same host name stop the run. |
| `ansible_host` | The device's tailnet name, else the application's recorded host, unless the machine sets `ansible_host`. |
| Groups | One per product on the machine (`tamanu`, `senaite`, `canopy`) and one per role (`central`, `facility`, `standalone`). A machine carrying `tamanu-facility` is in `tamanu` and `facility`. A machine with nothing on it is grouped by the type Canopy serves as assigned to it (in the run dialog), as an application of that type would be. |
| Variables | The group's variables at `all` level, each machine's tags at host level. Names that are not valid Ansible variable names (such as dotted billing tags) are skipped. |
| Reserved | `canopy_intent` and `tamanu_clone` are set by the plugin: `canopy_intent` is the intent of the lease, and `tamanu_clone` is true at rank `clone`. Any `ansible_*` variable other than `ansible_host`, `ansible_user`, `ansible_port`, `ansible_python_interpreter` and `ansible_timeout` is dropped with a warning. |
| Secret variables | `salt` and `elastic_agent_enrollment_token` are served by Canopy as secrets. A name is a secret or a tag, never both. |

[Variables](linux-variables.md) lists what the plays read.

## When Canopy cannot be reached

Nothing is cached and there is no offline mode.
Where Canopy cannot be reached (refused connection, timeout, a 5xx answer), the run stops and the message names Canopy; a refusal stops it with Canopy's reason.
A lease taken before the failure is released on a best-effort basis, and otherwise expires on its own.

## The variable catalogue

`ansible/variables.schema.json` is the catalogue Canopy reads from this repository's main branch, hourly and without credentials, to offer the variables and playbooks of a run.
It is written by hand, except each playbook's `x-canopy.playbooks[*].tags`, which `ansible/catalogue.py` keeps equal to what `ansible-playbook --list-tags` lists, other than `always` and `never`.

```sh
cd ansible
uv run python catalogue.py tags          # rewrite the tags
uv run python catalogue.py tags --check  # CI: fail where they are stale
uv run python catalogue.py validate      # CI: the file is a JSON Schema 2020-12 document
```

When a playbook or role gains or loses a tag, or a spec's Inventory variables table gains or loses a variable, update the catalogue in the same change: run `tags`, and add the variable's entry (type, default, meaning, and its `x-canopy` secret, scope, applications and reserved) beside its neighbours.
The tests in `ansible/tests/test_catalogue.py` fail where a tabled variable has no entry.

## Upgrade intent

`CANOPY_INTENT=upgrade` makes Canopy check for an open upgrade plan, and refuses an upgrade of a production deployment that has none.
Both upgrade playbooks assert `canopy_intent == 'upgrade'` before anything runs ([upgrade Tamanu](../sops/linux-upgrade-tamanu.md)).
