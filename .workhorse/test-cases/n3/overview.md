# N3 test cases: follow Canopy's Ansible rework

Scenarios for the inventory plugin, the lease callback, the facility template and the variable catalogue.
The plugin and callback scenarios run against the fake Canopy in `ansible/tests/test_canopy_inventory.py`; the last section needs a real Canopy carrying PR 666.

## API paths

- [x] Reading an inventory posts to `/api/ansible/take_lease` and `/api/ansible/for_group`, and to no `/api/inventory/` path. verifies spec: LNXANS#inventory
- [x] The callback posts `/api/ansible/extend_lease` while the play runs and `/api/ansible/release_lease` when it ends. verifies spec: LNXANS#inventory
- [x] A give-back after a failed read posts to `/api/ansible/release_lease`.

## Handed lease

- [x] With `CANOPY_LEASE` set and `CANOPY_URL`, the plugin posts no `take_lease` and reads `for_group` with that lease id. verifies spec: LNXANS#inventory
- [x] With `CANOPY_LEASE` unset, the plugin takes a lease as before and reads under it. verifies spec: LNXANS#inventory
- [x] With `CANOPY_LEASE` set, the run needs no `CANOPY_GROUP`, `CANOPY_GROUP_ID`, `CANOPY_RANK` or `CANOPY_INTENT`, and sends none of them. verifies spec: LNXANS#inventory
- [x] With `CANOPY_LEASE` set and `CANOPY_GROUP` or `CANOPY_RANK` also set, the group and rank Canopy serves are the ones used.
- [x] With `CANOPY_LEASE` and `CANOPY_INTENT` set, the read sends the intent as the one claimed, and `canopy_intent` is the intent Canopy serves. verifies spec: LNXANS#inventory
- [x] With `CANOPY_LEASE` set and `CANOPY_INTENT` unset, the read sends no intent, and `canopy_intent` is the intent Canopy serves.
- [x] A read whose claimed intent Canopy refuses stops the run with Canopy's reason naming both intents.
- [x] A play over a handed lease is extended every 8 minutes and released at the end, as a taken lease is. verifies spec: LNXANS#inventory
- [x] An inventory listing (no play) over a handed lease releases it on exit.
- [x] A handed lease whose read is refused (no longer held, or someone else's) stops the run with Canopy's reason and does not retry with a lease of its own.
- [x] A handed lease whose inventory builds nothing usable (for example no machine carries `managed_by_ansible`) releases the lease before stopping.
- [x] A run over a handed lease with the `canopy_lease` callback not loaded stops before reading.
- [x] `canopy_intent` and `tamanu_clone` are those of the lease's environment: a handed lease on a `clone` rank sets `tamanu_clone` true, and a handed upgrade lease sets `canopy_intent` to `upgrade`. verifies spec: LNXANS#inventory
- [x] A handed lease taken to configure and run with `CANOPY_INTENT=upgrade` stops the run, and `canopy_intent` is never `upgrade` for it.

## Lease scope

- [x] A read under a handed lease sends the playbook file name, the limit, the tags to run and the tags to skip that Ansible was started with. verifies spec: LNXANS#inventory
- [x] With no `--limit` the read sends an empty limit, and with no `--tags` or `--skip-tags` it sends empty lists.
- [x] `--tags a,b` and `--tags b --tags a` send the same two tags.
- [x] A path to the playbook sends its file name only.
- [x] More than one playbook on the command line stops the run before any read.
- [x] A read Canopy refuses for a different playbook, limit, tags or skip-tags than the lease records stops the run with Canopy's reason naming both, and adds no host to the inventory.
- [x] A lease that records no playbook still accepts the run, and its limit and tags are still claimed.
- [x] A run that takes its own lease sends no claims.
- [x] A stop for a refused claim releases the lease.

## Managed machines

- [x] A machine whose own variables set `managed_by_ansible` true is included. verifies spec: LNXANS#inventory
- [x] A machine whose own variables do not set it, but whose effective variables carry it from the environment or group, is left out with the existing warning.
- [x] A machine whose own variables set it false is left out.
- [x] An environment where no machine sets it itself stops the run.

## No cache

- [x] With Canopy unreachable (connection refused, timeout, 5xx), the run stops and the message names Canopy. verifies spec: LNXANS#inventory
- [x] With a cache file left from an earlier version, an unreachable Canopy still stops the run.
- [x] A successful read writes nothing under `$XDG_CACHE_HOME`.
- [x] `CANOPY_INVENTORY_OFFLINE` has no effect.
- [x] A refusal stops the run with Canopy's reason, as before. verifies spec: LNXANS#inventory
- [x] An unreachable Canopy after a lease was taken releases the lease on a best-effort basis and still stops the run.

## Host names

- [x] Each host is named by the `host_name` Canopy serves, including where Canopy's name differs from the address, and the plugin computes no name of its own. verifies spec: LNXANS#inventory
- [x] Two served machines with the same `host_name` stop the run, naming the host name. verifies spec: LNXANS#inventory
- [x] A host name that the old rules would have changed (a tailnet name cut to its first label, a Canopy name with spaces) comes through as served.
- [x] `--limit` on a served host name selects that host, and `--limit 'facility:!<host name>'` selects the other facility hosts.
- [ ] The sync account of a facility is named from the served host name in lower case, with every character outside `a-z`, `0-9` and `-` replaced by `-`. verifies spec: LNXANS#clone-setup

## Grouping

- [x] A host with no applications and `assigned_type` `tamanu-facility` is in `tamanu` and `facility`. verifies spec: LNXANS#inventory
- [x] A host with no applications and `assigned_type` `tamanu-central` is in `tamanu` and `central`.
- [x] A host with no applications and an `assigned_type` naming no role is in its product group and `standalone`.
- [x] A host with no applications and no `assigned_type` is in no product group, as before.
- [x] A host with applications and an `assigned_type` is grouped by its applications alone.
- [x] A host with no applications and an `assigned_type` that carries `managed_by_ansible` is included; one that does not is left out with the existing warning.

## Facility identifiers

- [x] `tamanu_facility_id` as a string renders `serverFacilityIds` as a list of one. verifies spec: LNXANS#inventory-variables
- [x] `tamanu_facility_id` as a list of two renders `serverFacilityIds` as both, and the rendered JSON5 parses.
- [x] The clone setup script for a list passes `TAMANU_FACILITY_IDS` with both identifiers, comma-joined, and for a string passes it unchanged.
- [x] The clone sync account for a list of two still creates one account on the central server, with a display name that carries both identifiers and escapes quotes and backslashes.
- [x] A list containing a quote or a backslash does not break the SQL or the shell script.
- [x] A facility host with `tamanu_facility_id` unset fails with a clear message. verifies spec: LNXRUN#services

## Variable catalogue

- [x] `ansible/variables.schema.json` is a valid JSON Schema 2020-12 document, and the check fails when it is made invalid (for example an unknown `type`). verifies spec: LNXANS#variable-catalogue
- [x] The tags check passes on the committed file. verifies spec: LNXANS#variable-catalogue
- [x] Adding a tag to a role in a playbook without regenerating makes the check fail, naming the playbook.
- [x] Regenerating writes the tags for every playbook, sorted, without `always` and `never`, and leaves the rest of the file byte-identical.
- [x] A playbook with no tags other than `always` or `never` has an empty list.
- [x] Every variable in the Inventory variables tables of LNXANS, LNXSRV, LNXRUN, LNXDB and LNXTLS, and in LNXMSP's enablement table, has an entry. verifies spec: LNXANS#variable-catalogue
- [x] `managed_by_ansible`, each accepted `ansible_*` name, `canopy_intent` and `tamanu_clone` have entries, the last two marked reserved. verifies spec: LNXANS#variable-catalogue
- [x] `tamanu_facility_id` validates a string and a non-empty list of strings, and rejects an empty list and a number.
- [ ] The file is readable at its path on main without credentials.

## Specs and docs

- [x] `node scripts/check-spec-links.mjs` passes.
- [x] No link in `docs/` or `docs/spec/` points at Canopy's `private-server/inventory.md`.
- [x] The reference page and the playbook-refused runbook describe no cache, no offline mode and the new paths.

## Against a real Canopy

- [ ] Starting an install from Canopy's run dialog with a limit and tags, then pasting the command, runs the playbook against only the limited hosts with only those tags.
- [ ] The run dialog's "has started" state appears when the plugin reads, and the maintenance window it declares ends when the play ends.
- [ ] A machine with nothing on it, assigned `tamanu-facility` in the dialog, is configured as a facility server by `tamanu-install.yml`.
- [ ] Pasting the same command again after the play ended is refused with Canopy's reason, and takes no lease.
- [ ] Killing the run mid-play leaves a lease that Canopy expires, and a second operator is refused until then.
- [ ] Canopy reads the committed catalogue and offers its variables and playbooks, including the changed `tamanu_facility_id`.
- [ ] Pasting the command with a different `--limit` or `--tags` than the dialog chose is refused, the dialog shows no run started, and no maintenance window is declared.
