# SOP: Check exposure to the blocked kernel modules

Read-only report of whether the kernel modules that the baseline blocks are loaded, loadable, or blocked on each host. **[diagnose]**
The blocked modules are in [LNXSRV](../spec/linux/server.md#kernel-hardening).

```sh
cd ansible
CANOPY_URL=<canopy url> CANOPY_GROUP=<group> CANOPY_RANK=<rank> \
  uv run ansible-playbook -i inventory/canopy.yml check-linux-lpe-2026.yml
```

Each host gets a line per issue with one of these verdicts.

| verdict | meaning | next |
|---|---|---|
| `EXPOSED_LOADED` | A vulnerable module is loaded now. | Escalate. Running `baseline` unloads it ([run the playbooks](linux-run-playbooks.md)). |
| `EXPOSED_AUTOLOAD` | Not loaded, but it can be loaded on demand and nothing blocks it. | Run the `baseline` role. |
| `MITIGATED` | Blocked by a modprobe `install` or `blacklist` line. | None. |
| `NOT_APPLICABLE` | The module is not on disk. | None. |

`-e lpe_fail_on_exposed=true` makes the play fail on a host that is exposed.
The play checks one module outside the baseline's block list, `algif_aead`, which the distribution's own package handles.
The baseline's block lives in `/etc/modprobe.d/cve-2026-linux-lpe.conf`, and the role's own comment says to remove it once patched kernels are deployed across the fleet.
