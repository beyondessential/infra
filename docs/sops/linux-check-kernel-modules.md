# SOP: Check exposure to the blocked kernel modules

Read-only report of whether the kernel modules that the baseline blocks are loaded, loadable, or blocked on each host. **[diagnose]**
The blocked modules, whether known vulnerable or merely unused, are in [LNXSRV](../spec/linux/server.md#kernel-modules).

```sh
cd ansible
CANOPY_URL=<canopy url> CANOPY_GROUP=<group> CANOPY_RANK=<rank> \
  uv run ansible-playbook -i inventory/canopy.yml check-linux-lpe-2026.yml
```

Each host gets a line per vulnerability and per group of unused modules with one of these verdicts.

| verdict | meaning | next |
|---|---|---|
| `EXPOSED_LOADED` | A blocked module is loaded now. | Escalate. Running `baseline` unloads it ([run the playbooks](linux-run-playbooks.md)). |
| `EXPOSED_AUTOLOAD` | Not loaded, but it can be loaded on demand and nothing blocks it. | Run the `baseline` role. |
| `MITIGATED` | Blocked by a modprobe `install` or `blacklist` line. | None. |
| `NOT_APPLICABLE` | The module is not on disk. | None. |

`-e lpe_fail_on_exposed=true` makes the play fail on a host that is exposed to a vulnerability. Exposure in a group of unused modules is reported but does not fail the play.
The play also checks one module outside the baseline's block list, `algif_aead`, which the distribution's own package handles.
The baseline's block lives in `/etc/modprobe.d/bes-kernel-modules.conf`. An unused module that is loadable or loaded is not a vulnerability: run the `baseline` role to block it.
