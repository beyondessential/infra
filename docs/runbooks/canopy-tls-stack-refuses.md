# Runbook: the canopy stack refuses to preview or apply

A `pulumi preview` or `pulumi up` of the canopy stack stops with a message that a core stack publishes no `canopyDnsRoleArn`, that `canopy-infra` publishes no `canopyDomainsRoleArn`, or that a stack publishes no DNS zone.
Requirements: [CTLS](../spec/canopy/tls-issuance.md).
Config keys and the parts involved: [canopy-tls-config](../reference/canopy-tls-config.md).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

## 1. When this applies

The refusal comes from the canopy stack's own checks (`pulumi/canopy/src/dns-zone-list.ts` and `dns-zones.ts`): the preview refuses rather than dropping an entry, because a dropped entry would surface later as an uncovered domain and not as missing access.
A stack that applies but issues no certificate is [Canopy not issuing](canopy-tls-not-issuing.md).

## 2. Establish context

Which zone is being added, which core stack `canopy:dnsZoneStacks` names for it, and which step of [enable-canopy-tls-core](../sops/enable-canopy-tls-core.md) was last completed. **[diagnose]**

## 3. Investigate

1. **The full refusal message** from the preview. **[diagnose]**
2. **The published outputs** the message names. **[diagnose]**

```
pulumi stack output -s bes/core/<stack> | grep canopyDnsRoleArn
pulumi stack output -s bes/canopy-infra/prod | grep canopyDomainsRoleArn
```

3. **The named core stack's `domain` config**: `pulumi config -s bes/core/<stack>`. **[diagnose]**

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| `<stack> (account <id>) publishes no canopyDnsRoleArn ... set canopyInfra on that stack and deploy it first` | The core stack has no zone role: step 1 of the procedure not done, or not deployed. | Set `core:canopyInfra` and apply that core stack ([procedure, step 1](../sops/enable-canopy-tls-core.md#1-point-the-core-stack-at-canopy)). **[dev-OTS]** |
| `canopy-infra publishes no canopyDomainsRoleArn ...` | `canopy-infra` is not deployed. | Deploy it first. **[dev-OTS]** |
| `<stack> publishes no DNS zone, so Canopy cannot manage one there` | The named core stack has `domain: false` or no zone. | Name a core stack that owns a zone, or fix its `domain`. **[dev-OTS]** |

## 5. Resolve

Apply the action from the table, then preview the canopy stack again; it passes once every named stack publishes the output the message asked for. **[dev-OTS]**
The core stack step needs AdminAccess, so a human runs it ([procedure](../sops/enable-canopy-tls-core.md)).

## 6. Escalate

State is **fix-required**: the cause is a stack, and the code area is the core stack's `zone.ts`, `canopy-infra`, or the canopy stack's `dnsZoneStacks` config.
Give the refusal message, the stack and account it names, and the outputs from step 2.
