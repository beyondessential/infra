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
| control node | The machine that runs the playbooks ([Basic concepts](https://docs.ansible.com/ansible/latest/network/getting_started/basic_concepts.html)). |
| run lease | The permission, held by one operator at a time, to read the inventory of an environment ([Run leases](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/ansible/runs.md#run-leases)). |

## Inventory

The inventory of a deployment MUST be read from [Canopy](../overview.md#canopy), for one group and one rank, by an inventory source that reads under the run lease of the environment.
The content of an inventory, the run lease, and the administrator access that reading requires are defined by Canopy's [INV](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/ansible/overview.md#what-a-run-is-served).

A run MUST read the inventory under the run lease that the environment variable `CANOPY_LEASE` hands to it, and MUST take a run lease of its own where that variable is not set.
A run MUST NOT take a second run lease where it was handed one.

A run MUST hold the run lease for as long as the play runs, MUST extend it at intervals of 8 minutes, and MUST release it when the play ends.
A run MUST do so for a run lease that was handed to it as for one that it took.

An inventory source MUST include only the machines that carry the variable `managed_by_ansible`.

An inventory source MUST make a machine a member of the group named for each product that runs on it and for each role those products play, and MUST make a machine whose application type names no role a member of the group `standalone`.
An inventory source MUST group a machine that has no application and is served with an assigned application type as it groups a machine with an application of that type.

An inventory source MUST name each host by the host name that Canopy serves for the machine.
An inventory source MUST stop the run where two served machines carry the same host name.

The inventory of a deployment MUST contain its [central server](../overview.md#central-server) as a member of the group `central` and each of its [facility servers](../overview.md#facility-server) as a member of the group `facility`.

The address and the host name of a machine are defined by [INV](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/ansible/overview.md#reaching-a-machine).
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
| `public_hostname` | none | The primary hostname of the server. |
| `tamanu_facility_id` | none | The facility identifier of a facility server, or a list of the identifiers of the facilities that it serves. |
| `patient_portal_fqdn` | none | The patient portal hostname of a central server. |
| `tamanu_central_ip` | `false` | An address for the central hostname on a facility server. |

The variables that configure the host, the Tamanu services and their proxy, the database, the certificates and mSupply are given by [LNXSRV](server.md#inventory-variables), [LNXRUN](runtime.md#inventory-variables), [LNXDB](database.md#inventory-variables), [LNXTLS](tls.md#inventory-variables) and [LNXMSP](msupply.md#enablement).

A facility server MUST be configured with the list of its facility identifiers, which is a list of one where `tamanu_facility_id` is a single identifier.

A name that is a secret variable in Canopy MUST NOT also be a tag of a host.

A [central server](../overview.md#central-server) MUST have its patient portal enabled where the [instance tag](../overview.md#instance-tags) `PatientPortalFQDN` or the variable `patient_portal_fqdn` is set.
Where both are set, the instance tag MUST take precedence.

## Variable catalogue

The repository MUST publish a catalogue of the inventory variables at `ansible/variables.schema.json` on its main branch, readable without credentials.
Canopy reads the catalogue from that path, as [ANSVAR](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/private-server/ansible/variables.md#catalogue) defines.

The catalogue MUST be a valid JSON Schema document of draft 2020-12.

The catalogue MUST describe each variable of the tables headed Inventory variables in this spec, [LNXSRV](server.md#inventory-variables), [LNXRUN](runtime.md#inventory-variables), [LNXDB](database.md#inventory-variables) and [LNXTLS](tls.md#inventory-variables), and the variables of [LNXMSP](msupply.md#enablement).
The catalogue MUST also describe `managed_by_ansible`, each `ansible_*` variable that an inventory source accepts, and the reserved variables `canopy_intent` and `tamanu_clone`.

For each variable the catalogue MUST give its type, its default, its meaning, whether it is secret, the scopes it may be set at, the application types it configures, and whether it is reserved to the inventory source.

For each playbook that Canopy can start, the catalogue MUST give the intent it is run with, the application types it configures, and its tags.
The tags of a playbook in the catalogue MUST be the tags that Ansible lists for it, other than `always` and `never`.

The checks that the repository runs on a change MUST fail where the tags of a playbook in the catalogue differ from the tags that Ansible lists for it, and where the catalogue is not a valid document of the schema draft above.

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
| `base` | the arrangement of a host that is not the Tamanu application, including the bestool daemon |
| `app` | the applications that run on the server |
| `pre` | in an upgrade, the provisioning of the new version |
| `go` | in an upgrade, the stopping, migrating and starting of services |

A run that skips the tag `app` MUST still set up the [bestool daemon](../overview.md#bestool-daemon).

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

## Clone setup

Provisioning MUST set up the servers of a [clone deployment](../overview.md#clone-deployment) where the central server is in the same inventory and runs Tamanu 2.60.0 or later.

Where that does not hold, the servers of a clone deployment MUST be set up by hand and provisioning MUST warn that they are.

Provisioning MUST install a clone setup script at `/etc/bestool/clone-setup.sh` on each server that it sets up.

The clone setup script of a central server MUST run the database migrations of the installed Tamanu version, and then apply the sync accounts of its facility servers, and MUST report failure where any step fails.

The clone setup script of a facility server MUST configure synchronisation against the central server of the deployment with the sync account that the central server holds for that facility server.

A clone setup script MUST pass a password to its command in the environment, and MUST NOT put it in a process argument.

Provisioning MUST give each facility server that it sets up a synchronisation account on the central server.

The password of a sync account MUST be 32 random bytes in hexadecimal, generated on the central server, and MUST NOT be derived from the inventory or written on the control node.

The password MUST be generated once, and replaced only where its stored copy is deleted.

The central server MUST keep each password where only the database user can read it, and the facility server MUST keep its own where only its administrator can read it.

The sync account of a facility MUST be named from the inventory host name in lower case, with every character outside `a-z`, `0-9` and `-` replaced by `-`.

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

A playbook SHOULD make no change to a server in [check mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html).

## Provisioning handoff

A playbook takes a server as [provisioning](aws.md#provisioning) leaves it, with its Tailscale membership, its volumes and its [instance tags](../overview.md#instance-tags).

A playbook MUST NOT create or change the cloud resources that provisioning manages.
