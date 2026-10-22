# N3 plan: follow Canopy's Ansible rework

Spec: LNXANS (`docs/spec/linux/ansible.md`), sections Inventory and Variable catalogue.
Canopy side: card F5, PR #666. Item 1 (the path rename) blocks Canopy shipping.

## Inventory plugin and callback

- [ ] Move `/api/inventory/*` to `/api/ansible/*` in `inventory_plugins/canopy.py` and `callback_plugins/canopy_lease.py`.
- [ ] Hand-over: read `CANOPY_LEASE`; when set, skip `take_lease` and read `for_group` under it.
- [ ] Keep `CANOPY_INVENTORY_LEASE` as the private channel from the plugin to the callback, and publish it for a handed lease as well as a taken one, so the callback extends and releases both. `CANOPY_LEASE` is input only and never the plugin-to-callback channel, so the two cannot be mixed up.
- [ ] A handed lease keeps the give-back paths (failed build, unreachable read).
- [ ] Remove the cache: `_fallback`, `_cached`, `_store`, `without_secret_values`, `CANOPY_INVENTORY_OFFLINE`, the `Unreachable` fallback (an unreachable Canopy stops the run, as a refusal does), the cache wording in `DOCUMENTATION` (including the `timeout` option) and the cache tests in `tests/test_canopy_inventory.py` (`prime_cache`, `offline`).
- [ ] Remove the cache from `docs/reference/linux-inventory.md` (the offline variable, the cache section, the secret-variable line) and from `docs/runbooks/linux-playbook-refused.md` (the three cache rows and the "Canopy or the cache" line, replacing them with a row for an unreachable Canopy).
- [ ] Replace local `host_names` and `slug` with the served `host_name`; keep the collision refusal.
- [ ] A host with no applications and an `assigned_type` is grouped through `ansible_groups` as if it had an application of that type.
- [ ] Update `DOCUMENTATION` in the plugin, `docs/reference/linux-inventory.md` (host name, handed lease, assigned type) and the `linux-playbook-refused` runbook where it names the lease.
- [ ] Update `tests/test_canopy_inventory.py` for the new paths, the handed lease, `host_name` and `assigned_type`.

## Catalogue tooling

- [ ] Script that regenerates each playbook's `x-canopy.playbooks[*].tags` in `ansible/variables.schema.json` from `ansible-playbook --list-tags`, dropping `always` and `never`, with a `--check` mode that exits non-zero when the committed list is stale.
- [ ] CI step in `.github/workflows/ansible-check.yml` running the check.
- [ ] CI step validating the file against the 2020-12 metaschema.
- [ ] Short LLM guidance in `AGENTS.md` / the ansible docs on updating the catalogue when a playbook or variable table changes (the standing rule already says to update the schema).
- [ ] `tamanu_facility_id` takes a string or a list and always renders as a list: update the facility template (`serverFacilityIds`), `TAMANU_FACILITY_IDS` in the clone setup script (comma-joined), the sync account display name, and the test in `tests/test_clone_restore.py`. The schema entry and specs are done.
- `tamanu_cache_central_dns` is removed, not carried: nothing in this repo or in Canopy PR 666 mentions it, so it is dropped from the 5 hosts in Canopy after the inventory import.

## Open

- Canopy is changing so that a handed lease needs only `CANOPY_URL` and `CANOPY_LEASE`: it adds an endpoint that returns a lease's group, rank and intent, and refuses a submission whose values differ from the lease's. The plugin calls that endpoint for a handed lease and uses what it returns for `canopy_intent` and `tamanu_clone`, ignoring `CANOPY_GROUP`, `CANOPY_GROUP_ID`, `CANOPY_RANK` and `CANOPY_INTENT`. This closes the intent bypass found in PR 666 (`for_group` took only `lease_id` and served no intent). The endpoint's path and response shape are not in PR 666 yet; the plugin step waits on them.
- The reference doc shows the run command Canopy hands over: `CANOPY_URL=… CANOPY_LEASE=<id> uv run ansible-playbook -i inventory/canopy.yml <playbook> --limit '<pattern>' --tags <tags>`.
