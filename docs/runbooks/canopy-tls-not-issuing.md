# Runbook: Canopy is not issuing certificates

A zone was enabled for Canopy ([enable-canopy-tls-core](../sops/enable-canopy-tls-core.md)) but a group's servers get no certificate, a Canopy preview fails, or the domains pod logs that it is idle.
Requirements: [CTLS](../spec/canopy/tls-issuance.md).
Config keys and the parts involved: [canopy-tls-config](../reference/canopy-tls-config.md).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.

Never print the domains pod spec (`kubectl describe pod`, `get pod -o yaml`): the ACME account key is in its environment as a plain value. **[sensitive-data]**

## 1. Which symptom

| symptom | go to |
|---|---|
| `pulumi preview` of the canopy stack fails | [A](#a-canopy-preview-errors) |
| the domains pod logs `no DNS zones configured (CANOPY_DNS_ZONES); the domains pod will idle` | [B](#b-no-zones) |
| a claim in the admin UI shows no zone | [C](#c-claim-shows-no-zone) |
| records fail to write with `AccessDenied` | [D](#d-access-denied) |
| an order fails validation but the records look right | [E](#e-validation-fails) |
| orders are held off, or certificates are untrusted, or nothing issues | [F](#f-authority-side) |

## A. Canopy preview errors

| message | cause | fix |
|---|---|---|
| `<stack> (account <id>) publishes no canopyDnsRoleArn ... set canopyInfra on that stack and deploy it first` | The core stack has no zone role: step 1 of the procedure not done, or not deployed. | Set `core:canopyInfra` and apply that core stack. **[dev-OTS]** |
| `canopy-infra publishes no canopyDomainsRoleArn ...` | `canopy-infra` is not deployed. | Deploy it first. **[dev-OTS]** |
| `<stack> publishes no DNS zone, so Canopy cannot manage one there` | The named core stack has `domain: false` or no zone. | Name a core stack that owns a zone, or fix its `domain`. **[dev-OTS]** |

These come from `pulumi/canopy/src/dns-zone-list.ts` and `dns-zones.ts`; the preview refuses rather than dropping an entry, because a dropped entry would surface later as an uncovered domain and not as missing access.

## B. No zones

`canopy:dnsZoneStacks` is unset on the canopy stack.
Confirm the value that reached the pod. **[diagnose]**

```
kubectl --context=<context> -n tamanu-meta-prod get pods -l task=domains -o jsonpath='{.items[0].spec.containers[0].env[?(@.name=="CANOPY_DNS_ZONES")].value}'
```

An empty result means no zone reached Canopy: set `dnsZoneStacks` and apply ([procedure](../sops/enable-canopy-tls-core.md#2-add-the-zone-to-canopy)). **[dev-OTS]**
The domains pod reads the list once at start-up, so it must restart to pick up a change ([DOM, Managed zones](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#managed-zones)).

## C. Claim shows no zone

The claim's zone has left the configuration, or the claim is on a name no configured apex covers.
A claim still excludes other groups from overlapping names, but Canopy writes no record beneath it ([DOM, When the zone configuration changes](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#when-the-zone-configuration-changes)).
Read `canopy:dnsZoneStacks` (`pulumi config -s bes/canopy/prod`) and compare to the claim. **[diagnose]**
A subzone delegated out of a configured zone needs its own entry ([zone delegation](../spec/canopy/tls-issuance.md#zone-delegation)).

## D. Access denied

The zone role in the member account is missing, or its trust policy names a stale `canopy-domains` role ARN.
Check the published outputs. **[diagnose]**

```
pulumi stack output -s bes/core/<stack> | grep canopyDnsRoleArn
pulumi stack output -s bes/canopy-infra/prod | grep canopyDomainsRoleArn
```

Redeploy the core stack so the role trusts the current ARN. **[dev-OTS]**
The permission itself is limited to `A`, `AAAA` and `TXT` on that one zone ([zone access](../spec/canopy/tls-issuance.md#zone-access)), so a failure on an `NS` or `SOA` record is expected.

## E. Validation fails

The challenge record has to be in the zone that is authoritative for the name.
If the name lives in a delegated subzone that has no entry of its own, the record lands in the parent and the delegation shadows it, with nothing wrong on the AWS side.
Add the subzone's core stack to `dnsZoneStacks` ([procedure, step 4](../sops/enable-canopy-tls-core.md#4-one-entry-per-zone)). **[dev-OTS]**

## F. Authority side

- No ACME account key configured: Canopy publishes addresses and issues nothing, and reports it once at start-up. Check that `canopy:acmeAccountKey` is set; do not read or paste it.
- `canopy:acmeDirectory` set to a staging URL: certificates chain to an untrusted root by design. Move to production in step 5 of the procedure. **[dev-OTS]**
- Throttling: Canopy treats a rate-limit response as fleet-wide and holds off new orders for 10 minutes ([CRT, When issuance fails](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md#when-issuance-fails)). Every group under one registered domain shares one allowance.

Canopy files its own alerts for a group domain outside the configured zones and for whether it can reach the authority ([DOM, When the zone configuration changes](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#when-the-zone-configuration-changes), [CRT, When issuance fails](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md#when-issuance-fails)); check them before debugging by hand.

## Escalate

State is **fix-required** when the cause is a stack or role (name it: core stack `zone.ts`, `canopy-infra`, or canopy `dnsZoneStacks`), **still-diagnosing** otherwise.
Say whether the group is on staging or production.
