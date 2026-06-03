# Ansible CI checks + lint cleanup

## Background

A play failed at runtime under ansible-core 2.19+ (we run 2.20) with:

> Conditional result (True) was derived from value of type 'str' ...
> Conditionals must have a boolean result.

ansible-core 2.19 made non-boolean `when:` results a hard error (previously a
loose coercion). The trigger was `when: tamanu_central_ip`, a var whose role
default is boolean `false` but which several inventories override with a string
IP. Fixed with `is truthy`.

This plan adds CI to catch the broad class of breakage early, and adopts
ansible-lint (also usable locally).

## What CI can and cannot catch

Established empirically:

- `ansible-playbook --syntax-check` does **not** evaluate `when:` — it only
  parses structure. Useless for the boolean-conditional class, but valuable for
  catching parse / import / module-arg errors.
- `ansible-playbook --check` **does** evaluate conditionals, but needs to
  connect to hosts and gather per-host facts (`ansible_facts['system_vendor']`,
  registered results). Our hosts are real machines reached over SSH/Tailscale,
  unreachable from CI. Forcing a local connection fails for unrelated reasons,
  so it is not a usable gate.
- `ansible-lint` does **not** catch the boolean-conditional class either
  (confirmed against a repro) — it is a runtime type check, not a static one.

Conclusion: the boolean-conditional class cannot be reliably caught in CI
without live hosts. The defense is **hardening** the conditionals so a string
override cannot change the result type, backed by a static net (syntax +
inventory parse + lint).

## Work

### 1. `.ansible-lint` config

- Exclude `.venv/`, `../pulumi` is out of tree already.
- Disable two rules that conflict with deliberate repo design (document why):
  - `var-naming[no-role-prefix]` (106): our roles deliberately share variables
    (e.g. `postgresql_configured` is set in `postgres` and read in `tailscale`;
    `tamanu_central_ip`, `is_btrfs`, `bestool_installed_version` cross roles and
    are set in inventories). Prefixing each with its role name would break the
    cross-role contract and force edits to every inventory.
  - `role-name` (10): role directories use hyphens (`tamanu-single-install`,
    `ebs-volume`, ...) as an established convention referenced throughout the
    playbooks. Renaming the dirs would break every reference.
- Relax `yaml[line-length]` to a width that suits ops shell snippets.

### 2. CI workflow `.github/workflows/ansible-check.yml`

Three jobs (mirroring the style of `pulumi.yml` / `rust-check.yml`):

- `lint`: `uv run ansible-lint` over the tree (hard gate once violations fixed).
- `syntax`: matrix over top-level playbooks → `ansible-playbook --syntax-check`.
- `inventory`: matrix over `inventory/*.yml` → `ansible-inventory --list`.

Use `uv` to install the pinned env. Trigger on PRs and on pushes to `main` that
touch `ansible/**`.

### 3. Conditional hardening

Coerce inventory-facing boolean flag vars used bare in `when:` with `| bool`
(or `is truthy` where the var doubles as a value), so a future string override
cannot reintroduce the runtime error. Covers at least: `ufw_managed`,
`tamanu_ipv6`, `tamanu_extra_certs`, `patient_portal_enabled`,
`postgres_create_user`, `postgres_unix_socket`. (`tamanu_central_ip` already
done.)

### 4. Fix remaining ~373 lint violations

By category, committing per category:

- Auto-fixable via `ansible-lint --fix`: `yaml[*]`, `fqcn[action-core]`,
  `jinja[spacing]`, `name[casing]`, `no-free-form`.
- `name[missing]` (93): add `name:` to tasks/blocks.
- `risky-file-permissions` (61): add explicit `mode:`.
- `risky-shell-pipe` (54): add `set -o pipefail` to piped shells.
- `no-changed-when` (44): add `changed_when:` (read-only commands → `false`).
- `command-instead-of-module` / `command-instead-of-shell` (37): use proper
  modules, or `command` over `shell`, where a clean equivalent exists.
- `ignore-errors` (13): replace with `failed_when:` / `rescue:` where sensible.
- `no-handler` (5), `name[template]` (6), `package-latest` (1), `jinja[invalid]`
  (1): case by case.

## Done when

- CI workflow present and green.
- `ansible-lint` clean (with the two documented rule exceptions).
- Bare flag-var conditionals hardened.
