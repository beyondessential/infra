# Runbook: Canopy is not issuing certificates

A zone was enabled for Canopy ([enable-canopy-tls-core](../sops/enable-canopy-tls-core.md)) and the stack applied, but a group's servers get no certificate, or the domains pod logs that it is idle.
Requirements: [CTLS](../spec/canopy/tls-issuance.md).
Config keys and the parts involved: [canopy-tls-config](../reference/canopy-tls-config.md).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).

Never print the domains pod spec (`kubectl describe pod`, `get pod -o yaml`): the ACME account key is in its environment as a plain value. **[sensitive-data]**

## 1. When this applies

The canopy stack previews and applies, and the failure is at run time: the domains pod idles, a claim shows no zone, records fail to write, an order fails validation, or orders are held off or untrusted.
A refusal at preview or apply is [the canopy stack refuses](canopy-tls-stack-refuses.md).
Canopy files its own alerts for a group domain outside the configured zones and for whether it can reach the authority ([DOM, When the zone configuration changes](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#when-the-zone-configuration-changes), [CRT, When issuance fails](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md#when-issuance-fails)); check them before debugging by hand. **[diagnose]**

## 2. Establish context

Which group and name, which zone the name sits in, whether the group is on staging or production (`canopy:acmeDirectory`), and which step of the procedure was last run. **[diagnose]**

## 3. Investigate

1. **The zone list that reached the pod.** An empty result means no zone reached Canopy. **[diagnose]**

```
kubectl --context=<context> -n tamanu-meta-prod get pods -l task=domains -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="CANOPY_DNS_ZONES")].value}'
```

2. **The configured zones against the claim**: `canopy:dnsZoneStacks` (`pulumi config -s bes/canopy/prod`), compared to the claim in the admin UI. **[diagnose]**
3. **The published role outputs.** **[diagnose]**

```
pulumi stack output -s bes/core/<stack> | grep canopyDnsRoleArn
pulumi stack output -s bes/canopy-infra/prod | grep canopyDomainsRoleArn
```

4. **The domains pod's log**, for the idle message, the start-up report of a missing ACME account key, and rate-limit responses: `kubectl --context=<context> -n tamanu-meta-prod logs -l task=domains --tail=100`. **[diagnose]**

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Log: `no DNS zones configured (CANOPY_DNS_ZONES); the domains pod will idle`; step 1 returns nothing | `canopy:dnsZoneStacks` is unset on the canopy stack. | Set `dnsZoneStacks` and apply ([procedure, step 2](../sops/enable-canopy-tls-core.md#2-add-the-zone-to-canopy)). **[dev-OTS]** |
| A claim in the admin UI shows no zone | The claim's zone has left the configuration, or the claim is on a name no configured apex covers. The claim still excludes other groups from overlapping names, but Canopy writes no record beneath it ([DOM, When the zone configuration changes](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#when-the-zone-configuration-changes)). A subzone delegated out of a configured zone needs its own entry ([zone delegation](../spec/canopy/tls-issuance.md#zone-delegation)). | Add the zone's core stack to `dnsZoneStacks` ([procedure, step 4](../sops/enable-canopy-tls-core.md#4-one-entry-per-zone)). **[dev-OTS]** |
| Records fail to write with `AccessDenied` | The zone role in the member account is missing, or its trust policy names a stale `canopy-domains` role ARN (step 3). The permission is limited to `A`, `AAAA` and `TXT` on that one zone ([zone access](../spec/canopy/tls-issuance.md#zone-access)), so a failure on an `NS` or `SOA` record is expected. | Redeploy the core stack so the role trusts the current ARN. **[dev-OTS]** |
| An order fails validation but the records look right | The challenge record has to be in the zone that is authoritative for the name. A name in a delegated subzone with no entry of its own lands in the parent, and the delegation shadows it, with nothing wrong on the AWS side. | Add the subzone's core stack to `dnsZoneStacks` ([procedure, step 4](../sops/enable-canopy-tls-core.md#4-one-entry-per-zone)). **[dev-OTS]** |
| Addresses are published but nothing issues; the log reports no ACME account key once at start-up | `canopy:acmeAccountKey` is not configured. | Check that the key is set; do not read or paste it. **[diagnose, sensitive-data]** |
| Certificates issue but are untrusted | `canopy:acmeDirectory` is a staging URL: certificates chain to an untrusted root by design. | Move to production ([procedure, step 5](../sops/enable-canopy-tls-core.md#5-staging-to-production-once-per-canopy-deployment)). **[dev-OTS]** |
| Orders are held off after a rate-limit response | Canopy treats a rate-limit response as fleet-wide and holds off new orders for 10 minutes ([CRT, When issuance fails](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md#when-issuance-fails)). Every group under one registered domain shares one allowance. | Wait out the hold-off. |

## 5. Resolve

Apply the config change from the table through the procedure.
The domains pod reads the zone list once at start-up, so it must restart to pick up a change to `dnsZoneStacks` ([DOM, Managed zones](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#managed-zones)). **[dev-OTS]**
Step 1 then shows the zone, and the next order for the name issues. **[diagnose]**

## 6. Escalate

State is **fix-required** when the cause is a stack or role (name it: the core stack's `zone.ts`, `canopy-infra`, or the canopy stack's `dnsZoneStacks`), and **still-diagnosing** otherwise.
Say whether the group is on staging or production.
Give the group and name, the step 1 and 3 outputs, and the log lines, without the key.
