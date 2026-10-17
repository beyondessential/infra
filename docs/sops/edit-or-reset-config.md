# SOP: Edit or reset the config ConfigMaps

The three config ConfigMaps `config-central`, `config-facility-N` and `provisioning` are written once from the render, and Argo CD ignores their contents afterwards.
A hand edit therefore survives every sync, and so does a stale value ([TDR](../spec/tamanu/deployment-rollout.md#ignored-differences)).
Reading them is **[diagnose, sensitive-data]**: `provisioning` carries the initial admin login.
Editing or deleting one is **[dev-OTS, sensitive-data]**.

## Read

```sh
kubectl -n tamanu-<stack> get configmap config-central -o yaml
```

The rendered file is under `local.json5` (and `provisioning.json5` for `provisioning`).
A label `bes.tamanu/templated-from` records which template it came from.

## Edit

```sh
kubectl -n tamanu-<stack> edit configmap config-central
```

The `tamanu-engineer` role can edit ConfigMaps.
Restart the servers that read it so they re-read the file ([restart services](restart-services.md)); this assumes the setting is read from the file, as some Tamanu settings are database-backed instead.
The change lasts until the ConfigMap is reset.

## Reset to the rendered default

```sh
kubectl -n tamanu-<stack> delete configmap config-central
```

Argo CD creates it again from the render on its next sync.
This drops every hand edit, and it is the only way a change to the renderer's templates reaches a deployment that already exists ([runbook](../runbooks/config-change-not-applied.md)).
`provisioning` is read by the `central-provisioner` Job on each sync, which skips work when none is needed.
