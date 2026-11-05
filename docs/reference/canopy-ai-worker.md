# Reference: Canopy AI worker

The `ai` Deployment in the `canopy` stack, which looks at each new vulnerability with a model ([K8SCNP](../spec/kubernetes/canopy.md#workloads), and VTR in Canopy: [model triage](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/security/vulnerability-triage.md#model-triage)).
It serves no HTTP, runs as the default service account, and connects through the PgBouncer Poolers.

## Config keys

| key | meaning |
|---|---|
| `canopy:openrouterModel` | An OpenRouter model id. Setting it creates the Deployment; leaving it unset means no worker and every new vulnerability stays open for an operator. |
| `canopy:openrouterApiKey` | Secret. Required once a model is set. Set a spend limit on the key at OpenRouter. |
| `canopy:openrouterBaseUrl` | Optional. Unset means `https://openrouter.ai/api/v1`. |

The container receives them as `OPENROUTER_MODEL`, `OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL` (when set), from `pulumi/canopy/src/canopy-ai.ts`.
The key is on this pod alone: the helper is deliberately not part of `spec()`.

The model id is passed to OpenRouter as written, so a routing suffix such as `:nitro` goes in the same key.
The worker asks for structured output and, if the provider refuses it, asks for JSON in the reply instead.
Pick a model whose endpoints list `structured_outputs`.

## Egress

The pod needs HTTPS to `openrouter.ai`, or to the host of `openrouterBaseUrl`.
The `monitor` pod, which runs the vulnerability scan, needs HTTPS to `api.osv.dev` and `raw.githubusercontent.com`.
Nothing in the stack restricts egress, so both work as long as the node subnet's NAT does.

## Cost

The worker asks the model once for each open vulnerability that something in production counts for, in batches of ten a minute, and asks again only after an hour if the answer was unusable.
The first run after the first scan therefore covers every such item; after that only new or reopened items.

## Checks

**[diagnose]** Read the worker's log.

```sh
kubectl -n tamanu-meta-<stack> logs deploy/ai
```

It says "looking at new vulnerabilities with `<model>`" and then "looked at N vulnerabilities" within a few minutes of a scan.
"no model configured" means the container got no key or no model.

## Turning it off

**[dev-OTS]** Remove `openrouterModel` and `openrouterApiKey` from the stack config and apply.
The Deployment goes and vulnerabilities stay open for operators.
Roll out in the other direction in two steps: apply the new Canopy image first (migration and scan), then set the config and apply again.
