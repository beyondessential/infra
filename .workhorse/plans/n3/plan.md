# N3 plan: follow Canopy's Ansible rework

Spec: LNXANS (`docs/spec/linux/ansible.md`), sections Inventory and Variable catalogue.
Canopy side: card F5, PR #666 and its follow-up. Canopy has already moved its paths, so the plugin is broken against it until item 1 lands; the plugin is developed alongside Canopy and has no other users, so there is no rollout window to manage.

## Inventory plugin and callback

- [ ] Move `/api/inventory/*` to `/api/ansible/*` in `inventory_plugins/canopy.py` and `callback_plugins/canopy_lease.py`.
- [ ] Hand-over: read `CANOPY_LEASE`; when set, skip `take_lease` and read `for_group` under it. The request is `{lease_id, intent?}`: `intent` is sent only when `CANOPY_INTENT` is set, as the claimed intent, and Canopy refuses it where it differs from the lease's. The response carries `lease` (`intent`, `playbook`, `limit_pattern`, `limited_to`, `tags`, `skip_tags`, `assignments`), `group_id`, `group` and `rank`; `canopy_intent` and `tamanu_clone` come from those.
- [ ] Read `managed_by_ansible` from the host's `own_vars` alone, not its effective `vars`.
- [ ] Verify the run against the lease: read `ansible.context.CLIARGS` (`args` for the playbook, `subset`, `tags`, `skip_tags`; filled in before the inventory is built, checked against ansible-core 2.20) and stop where they differ from `lease.playbook`, `lease.limit_pattern`, `lease.tags` and `lease.skip_tags`. Compare the playbook by file name, a missing limit with an empty one, and tags as sets. A lease with no playbook accepts any. Only for a handed lease.
- [ ] Normalise before comparing, as Ansible 2.20 parses them: `subset` is one string, empty when unset; `tags` defaults to `['all']` and `skip_tags` to `[]`, both split on commas into sets, so a lease recording no tags equals `{'all'}`; `args` is the list of playbook paths.
- [ ] Read optional fields with `.get`: a host's `address` and `assigned_type`, and the lease's `playbook`, `limit_pattern`, `tags` and `skip_tags`.
- [ ] Keep `ansible_groups` identical to Canopy's mirror of it in `crates/private-server/src/fns/ansible/runs.rs`, which previews a limit against the same groups (a type with no hyphen is its own product and `standalone`; a machine with nothing on it is grouped by `assigned_type`).
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

- Canopy PR 671 merged and matches the plan: `/api/ansible/*` paths, `for_group` takes `{lease_id, intent?}` and returns `lease`, `group`, `group_id`, `rank` and the hosts with `host_name`, `assigned_type` and `own_vars`. Its `managed` test (own variables, truthy as `yes`, `true`, `on`, `1`, `y`, `t`) is the one the plugin uses.
- The lease scope check runs after the read, because the lease's playbook, limit and tags come from the read's response. A mismatch is therefore found after Canopy has marked the run started and declared its maintenance window; the plugin then stops and releases the lease. Accepted for now.

## Follow-up: claims on the read

Ask Canopy to take the playbook, limit, tags and skip-tags as optional claims on `for_group`, refused before the run starts as a claimed intent is. Once it does:

- [ ] Send what Ansible was started with (normalised as above) in the `for_group` request, and drop the check after the read.
- [ ] Change the LNXANS sentence on the playbook, limit and tags to say the run stops without being recorded as started.
- [ ] Change the test cases under Lease scope to expect Canopy's refusal, and that no run is recorded as started.

- The reference doc shows the run command Canopy hands over: `CANOPY_URL=… CANOPY_LEASE=<id> uv run ansible-playbook -i inventory/canopy.yml <playbook> --limit '<pattern>' --tags <tags>`.
