# Reference: Linux inventory

The Ansible inventory of a Linux deployment is served by Canopy, not by files in the repository.
The spec is [LNXANS](../spec/linux/ansible.md#inventory); this page is how to read it and what it contains.
The plugin is `ansible/inventory_plugins/canopy.py`, the lease keeper is `ansible/callback_plugins/canopy_lease.py`, and the one source file is `ansible/inventory/canopy.yml`, which names no deployment.

## Selecting a deployment

| variable | meaning |
|---|---|
| `CANOPY_URL` | Base URL of Canopy's operator interface. Must be `https`, or a loopback address. |
| `CANOPY_GROUP` or `CANOPY_GROUP_ID` | The Canopy group (name or id). Give exactly one. |
| `CANOPY_RANK` | The rank within the group, such as `production`, `demo` or `clone`. Needed where a group holds more than one rank. |
| `CANOPY_INTENT` | `configure` (the default) or `upgrade`. |
| `CANOPY_INVENTORY_OFFLINE` | Set to read the cache without contacting Canopy. |

The run needs `callback_plugins = ./callback_plugins` and `inventory_plugins = ./inventory_plugins` in the `ansible.cfg` it picks up; `ansible/setup.sh` writes `~/.ansible.cfg` from `example.ansible.cfg` with both.
The plugin stops if the callback is not loaded, because nothing would give the lease back.

```sh
cd ansible
CANOPY_URL=<canopy url> CANOPY_GROUP=<group> CANOPY_RANK=<rank> ansible-playbook -i inventory/canopy.yml <playbook>
```

Reading the inventory needs Canopy administrator access, because the answer carries the deployment's secret variables.

## The run lease

Reading takes Canopy's run lease on the environment, served to one operator at a time.
The callback extends it every 8 minutes while the play runs and releases it when the play ends.
A run that dies leaves a lease that expires on its own, 30 minutes after the last extension, per the callback comment.
A second operator reading the same environment is refused until then ([playbook refused](../runbooks/linux-playbook-refused.md)).

## What the inventory contains

| item | rule |
|---|---|
| Hosts | Only machines with `managed_by_ansible` set. Others are left out with a warning that lists them, and none managed is an error. |
| Host name | The address, cut to its first label where it ends in `.ts.net`. Where there is no address, or two machines share one, Canopy's own name with unsafe characters replaced by `-`. |
| `ansible_host` | The device's tailnet name, else the application's recorded host, unless the machine sets `ansible_host`. |
| Groups | One per product on the machine (`tamanu`, `senaite`, `canopy`) and one per role (`central`, `facility`, `standalone`). A machine carrying `tamanu-facility` is in `tamanu` and `facility`. |
| Variables | The group's variables at `all` level, each machine's tags at host level. Names that are not valid Ansible variable names (such as dotted billing tags) are skipped. |
| Reserved | `canopy_intent` and `tamanu_clone` are set by the plugin: `tamanu_clone` is true at rank `clone`. Any `ansible_*` variable other than `ansible_host`, `ansible_user`, `ansible_port`, `ansible_python_interpreter` and `ansible_timeout` is dropped with a warning. |
| Secret variables | `salt` and `elastic_agent_enrollment_token` are served by Canopy as secrets. A name is a secret or a tag, never both. The cache never holds their values. |

[Variables](linux-variables.md) lists what the plays read.

## The cache

| item | detail |
|---|---|
| Path | `$XDG_CACHE_HOME/canopy-inventory/<group>-<digest>.json`, or under `~/.cache`, mode 0600 in a 0700 directory. The digest covers the group, rank, intent and URL. |
| Used when | Canopy is unreachable. A warning says so, and lists the secret variables that are unset. |
| Never used when | Canopy refuses the request (the run stops), or the intent is `upgrade`. |

Variable names in a play that need a secret fail when read from the cache.

## Upgrade intent

`CANOPY_INTENT=upgrade` makes Canopy check for an open upgrade plan, and refuses an upgrade of a production deployment that has none.
Both upgrade playbooks assert `canopy_intent == 'upgrade'` before anything runs ([upgrade Tamanu](../sops/linux-upgrade-tamanu.md)).
