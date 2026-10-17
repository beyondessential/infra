# SOP: Inspect the render

Reproduce what the renderer produces for a deployment, from the parameters the Application holds.
Extracting the parameters is **[diagnose]**.
The render is **[diagnose, sensitive-data]**: it contains the `provisioning` ConfigMap, which carries the initial admin login, and the other config ConfigMaps.
Do not paste it into a ticket or chat.

```sh
# The parameters the renderer was given
kubectl -n argocd-system get app tamanu-<stack> -o json \
  | jq -r '.spec.source.plugin.env[0].value' > params.json

# The render for them
infra-argo-tamanu-renderer --params params.json --format yaml | less
```

`infra-argo-tamanu-renderer` is the binary built from `tamanu/on-k8s/renderer`.
If it is not installed, `cargo run --manifest-path tamanu/on-k8s/renderer/Cargo.toml -- --params params.json --format yaml` runs it from a checkout.
Check out the commit of the channel the deployment uses, because the render depends on the renderer build ([TRO](../spec/tamanu/renderer-rollout.md#channels)).

Options of the binary (`tamanu/on-k8s/renderer/src/main.rs`):

| Option | Use |
|---|---|
| `--params <file>` | Read the parameters from a file, or `-` for stdin. Without it the `ARGOCD_ENV_PARAMS` variable is used. |
| `--format yaml\|stream\|json` | `yaml` to read, `stream` is what the Argo plugin emits, `json` for diffing. |
| `--templates <dir>` | Read config templates from a directory instead of the built-in ones, to try a template change. |
| `--unknown-config-keys reject\|ignore` | What to do with a config key the renderer does not know. Set the `RENDERER_UNKNOWN_CONFIG_KEYS` variable to match the channel: `stable` ignores, `canary` rejects. |

A render error here is the same error the Application shows, which is how to reproduce it: [render error](../runbooks/render-error.md).
The render never contains Secret values: the stub creates those Secrets and the renderer only names them (`tamanu/on-k8s/renderer/src/names.rs`).
