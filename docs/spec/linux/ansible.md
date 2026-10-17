---
id: LNXANS
---

# Ansible setup of Linux servers

The requirements in this spec apply to the Ansible playbooks that install a [Linux server](../overview.md#linux-server) and keep it current, to the inventory that the playbooks read, and to the variables that configure them.
The arrangement that the playbooks produce is specified by [LNXRUN](runtime.md), [LNXSRV](server.md), [LNXDB](database.md), [LNXBAK](backups.md) and [LNXTLS](tls.md).

## Borrowed terms

| term | meaning |
|---|---|
| playbook, play | A playbook is a file of plays, and a play applies an ordered list of roles to a group of hosts ([Playbooks](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html)). |
| inventory source | A plugin or file that supplies the hosts, groups and variables of an inventory ([Inventory plugins](https://docs.ansible.com/ansible/latest/plugins/inventory.html)). |
| tag | A label on a play or role by which a run selects or skips it ([Tags](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_tags.html)). |
| check mode | A run that reports the changes it would make without making them ([Check mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html)). |
| control node | The machine that runs the playbooks ([Basic concepts](https://docs.ansible.com/ansible/latest/network/getting_started/basic_concepts.html)). |
| run lease | The permission, held by one operator at a time, to read the inventory of an environment ([Run leases](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/inventory.md#run-leases)). |

## Inventory

The inventory of a deployment MUST be read from [Canopy](../overview.md#canopy), for one group and one rank, by an inventory source that takes the run lease of the environment.
The content of an inventory, the run lease, and the administrator access that reading requires are defined by Canopy's [INV](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/inventory.md#what-an-inventory-contains).

A run MUST hold the run lease for as long as the play runs, MUST extend it at intervals of 8 minutes, and MUST release it when the play ends.

An inventory source MUST include only the machines that carry the variable `managed_by_ansible`.

An inventory source MUST make a machine a member of the group named for each product that runs on it and for each role those products play, and MUST make a machine whose application type names no role a member of the group `standalone`.

The address of a machine is defined by [INV](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/inventory.md#reaching-a-machine).
An address MUST be a host name or an IP address that does not begin with a hyphen.

An inventory source MUST accept only the Ansible variables `ansible_host`, `ansible_user`, `ansible_port`, `ansible_python_interpreter` and `ansible_timeout` from Canopy.

An inventory source MUST set the variable `canopy_intent` to the intent of the run, `configure` or `upgrade`, and the variable `tamanu_clone` to true where the deployment has the rank `clone`.

An inventory source MUST send its requests over HTTPS, except to a loopback address.

An inventory source MUST NOT follow a redirect.

Where Canopy cannot be reached, an inventory source SHOULD fall back to its cache of the last successful read and warn that secret variables are unset.

Where Canopy refuses a request, an inventory source MUST stop the run.

An inventory source MUST NOT write a secret variable to its cache.

Where the intent is `upgrade`, an inventory source MUST NOT use the cache.

## Inventory variables

The variables in the following table configure a Tamanu server.

| variable | default | meaning |
|---|---|---|
| `timezone` | none | The time zone of the host and of Tamanu. |
| `salt` | none | The [credential seed](../overview.md#credential-seed). |
| `tamanu_central_canonical_url` | none | The URL that facility servers synchronise against. |
| `tamanu_version` | none | The image tag of the backend and patient portal. |
| `tamanu_frontend_version` | `tamanu_version` | The image tag of the frontend. |
| `tamanu_allow_downgrade` | `false` | Permits a version lower than the deployed version. |
| `caddy_version` | selected by the playbooks | The package version of the proxy. |
| `public_hostname` | none | The primary hostname of the server. |
| `tamanu_facility_id` | none | The facility identifier of a facility server. |
| `patient_portal_fqdn` | none | The patient portal hostname of a central server. |
| `tamanu_central_ip` | `false` | An address for the central hostname on a facility server. |
| `tamanu_caddy_tls` | `true` | Whether the proxy serves HTTPS on the public hostname. |
| `tamanu_caddy_extra_hostnames` | none | Additional hostnames that the proxy serves. |
| `tamanu_caddy_extra_hostnames_redirect` | `true` | Whether additional hostnames redirect to the public hostname. |
| `tamanu_tailscale_tls` | `true` | Whether the proxy serves HTTPS on the Tailscale hostname. |
| `tailnet` | `tail53aef` | The tailnet name used to form Tailscale hostnames. |
| `tamanu_ipv6` | `true` | Whether Tamanu containers have IPv6. |
| `tamanu_extra_certs` | `false` | Whether Tamanu containers trust the host certificate store. |
| `podman_network_subnets_v4`, `podman_network_subnets_v6` | the subnets of [LNXRUN](runtime.md#container-runtime) | The subnets of the default Podman network. |
| `elastic_agent_enabled`, `elastic_agent_enrollment_token`, `elastic_agent_fleet_url` | `false`, none, the production Fleet | The endpoint security agent of [LNXSRV](server.md#endpoint-security-agent). |
| `ufw_managed`, `dangerously_leave_ufw_alone` | `false`, `false` | The host firewall of [LNXSRV](server.md#host-firewall). |
| `munin_enabled` | `true` | Whether the Munin node runs, as [LNXSRV](server.md#metrics) gives it. |

A name that is a secret variable in Canopy MUST NOT also be a tag of a host.

A [central server](../overview.md#central-server) MUST have its patient portal enabled where the [instance tag](../overview.md#instance-tags) `PatientPortalFQDN` or the variable `patient_portal_fqdn` is set.
Where both are set, the instance tag MUST take precedence.

## Playbooks

Each playbook in the following table MUST achieve the result that the table gives for it.

| playbook | hosts | result |
|---|---|---|
| `base-install.yml` | every host | The host arrangement of [LNXSRV](server.md), and the container runtime of [LNXRUN](runtime.md#container-runtime). |
| `tamanu-install.yml` | every host, then `central`, then `facility` | Every arrangement that the Linux server specs require of a host of its type, including its database, its Tamanu services and its proxy. |
| `tamanu-upgrade.yml` | every host, then `central`, then `facility` | The [upgrade](#upgrades) of the Tamanu version. |
| `tamanu-frontend-upgrade.yml` | `central`, `facility` | The [frontend upgrade](#frontend-upgrades). |
| `postgres-upgrade-check.yml` | every host | For each host, the value that [LNXDB](database.md#major-version-upgrades) names for the read-only check, and no change to the host. |
| `check-linux-lpe-2026.yml` | every host | For each host, whether each kernel module of [LNXSRV](server.md#kernel-hardening) is loaded, loadable or blocked, and no change to the host. |
| `convert-three-disk-to-btrfs.yml` | every host | A host whose root, `/var/log` and PostgreSQL data are on separate partitions converted to the single layout of [LNXSRV](server.md#storage-layout). |

A run selects parts of a playbook with the tags in the following table.

| tag | selects |
|---|---|
| `base` | the arrangement of a host that is not the Tamanu application, including the alert daemon |
| `app` | the applications that run on the server |
| `pre` | in an upgrade, the provisioning of the new version |
| `go` | in an upgrade, the stopping, migrating and starting of services |

A run that skips the tag `app` MUST still set up the [alert daemon](../overview.md#alert-daemon).

A run limited by tags MUST still apply the reloads and restarts that its changes call for.

## Installation

An installation run MUST NOT restart a Tamanu service, other than by the rolling restart that [LNXRUN](runtime.md#boot-and-restart) requires after a PostgreSQL restart.

The playbooks MUST write the files in the following table as the table gives.

| path | written |
|---|---|
| `/etc/tamanu/env` | on every run |
| `/etc/tamanu/<version>/production.json5` | once per version, then preserved |
| `/etc/tamanu/<version>/local.json5` | on every run |
| `/etc/tamanu/<version>/default.json5` | once per version, from the image |
| `/etc/tamanu/current` | on every run, naming the version of the run |

The file `production.json5` of a new version MUST be a copy of the `production.json5` of the version that `/etc/tamanu/current` names where one exists, and otherwise MUST be created from the seed that the playbooks hold for the server type.

A run MUST NOT change an existing `production.json5`.

## Server key

Provisioning MUST create the [server key](../overview.md#server-key) of a server where none exists.

An existing server key MUST NOT be replaced by provisioning.

The server key MUST be 32 bytes read from the kernel random source, and MUST NOT pass through the control node or an inventory variable.

## Central server address

A facility server SHOULD resolve the hostname of its central server to the address in the inventory variable `tamanu_central_ip` where that is set, by an entry in `/etc/hosts`.

A facility server MUST NOT have an `/etc/hosts` entry for the hostname of its central server that was not written for `tamanu_central_ip`.

## Versions

The backend version of a server MUST be the value of `tamanu_version`, and the frontend version MUST be the value of `tamanu_frontend_version`.

The installed [bestool](../overview.md#bestool) MUST be at least version 1.21.0 before Tamanu is installed or upgraded.

The images of a version MUST be pulled before the environment file names the version.

Provisioning MUST refuse to set a backend version, or a frontend version, that is lower than the deployed version, where both are `v`-prefixed versions, unless `tamanu_allow_downgrade` is true.

A frontend version that is not a `v`-prefixed version MUST NOT be compared.

## Upgrades

An upgrade, including a frontend upgrade, MUST be run only against an inventory that was read with the intent `upgrade`.

An upgrade MUST NOT run where `tamanu_version` is not set in the inventory.

An upgrade MUST perform the steps in the following table, in order.

| step | action |
|---|---|
| 1 | Provision the server at the new version, as an installation does. |
| 2 | Stop the API, tasks, sync and FHIR services of the server type, leaving the frontend serving. |
| 3 | Restart the frontend instances, and the patient portal instances on a central server, one at a time, keeping at least one instance of each in service and reloading the proxy between instances. Stop any instance other than `a` and `b`. |
| 4 | Drop the schema `reporting` with its contents, run the database migrations of the new version, and create the schema `reporting`, owned by `tamanu`. |
| 5 | Start every service that should be running, and reload the proxy. |
| 6 | Remove every Tamanu image whose tag is neither the new nor the previous backend version and neither the new nor the previous frontend version. |

An upgrade that stopped part way MUST be safe to run again, and step 5 MUST start every service that should be running, including those that the earlier run left stopped.

An upgrade MUST leave the images alone where the run did not read the previous versions.

An upgrade MUST leave the configuration directory of each earlier version in place.

> [!NOTE]
> The previous images and configuration directories let a downgrade, which `tamanu_allow_downgrade` permits, start without reaching the registry.

### Frontend upgrades

A frontend upgrade MUST leave the backend version at the deployed value, and MUST perform steps 3 and 6 of the table above for the frontend alone, after pulling the frontend image and writing the environment file.

A frontend upgrade MUST refuse to run where `/etc/tamanu/env` has no `TAMANU_VERSION`.

## Rerunning and check mode

An installation playbook SHOULD make no change to a server that already matches the inventory.

A playbook SHOULD make no change to a server in check mode.

## Provisioning handoff

A playbook takes a server as [provisioning](server.md#provisioning) leaves it, with its Tailscale membership, its volumes and its [instance tags](../overview.md#instance-tags).

A playbook MUST NOT create or change the cloud resources that provisioning manages.
