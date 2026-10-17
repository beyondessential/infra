# Reference: Canopy TLS issuance plumbing

Where each piece of [CTLS](../spec/canopy/tls-issuance.md) lives in the stacks, and the config keys and outputs that join them.
The requirements are in the spec; the procedure is [enable-canopy-tls-core](../sops/enable-canopy-tls-core.md); symptoms are in [canopy-tls-not-issuing](../runbooks/canopy-tls-not-issuing.md).

## Parts

| part | stack and file | what it is |
|---|---|---|
| Canopy DNS identity (`canopy-domains`) | `pulumi/canopy-infra/index.ts` | IRSA role in Canopy's own account for the service account `canopy-domains`. Holds `sts:AssumeRole` on `*` and direct `ChangeResourceRecordSets` on that account's own zone, limited to `A`, `AAAA` and `TXT`. Output `canopyDomainsRoleArn`. |
| Zone role (`canopy-dns`) | `pulumi/core/src/zone.ts` | Role and managed policy in a member account. Trusts only `canopyDomainsRoleArn`. Created only when `core:canopyInfra` is set. Output `canopyDnsRoleArn`. |
| Zone list | `pulumi/canopy/src/dns-zones.ts`, `dns-zone-list.ts` | Builds `CANOPY_DNS_ZONES` from the core stacks named in `canopy:dnsZoneStacks`, and puts it on every Canopy workload. |
| ACME account | `pulumi/canopy/src/canopy-acme.ts`, `config.ts` | `CANOPY_ACME_ACCOUNT_KEY`, `CANOPY_ACME_DIRECTORY` and `CANOPY_ACME_CONTACT`, on the `domains` pod and `private-server` only. |

## Config keys

| stack | key | meaning |
|---|---|---|
| `core` | `core:canopyInfra` | `bes/canopy-infra/<stack>`. Set it and the core stack creates its zone role. Leave it unset and Canopy has no access to that zone. |
| `canopy` | `canopy:dnsZoneStacks` | List of core stack references, `bes/core/<stack>`, whose zones Canopy manages. |
| `canopy` | `canopy:canopy-infra` | `bes/canopy-infra/<stack>`; every consumer of Canopy's IRSA roles is gated on it. |
| `canopy` | `canopy:acmeAccountKey` | Secret PKCS #8 key. Without it Canopy publishes addresses and issues nothing. |
| `canopy` | `canopy:acmeDirectory` | Authority directory. Unset means Let's Encrypt production; a staging URL means untrusted certificates. |
| `canopy` | `canopy:acmeContact` | `mailto:` contact for the authority. |

## Outputs a core stack must publish for a zone

`zoneName`, `zoneId`, `accountId`, and `canopyDnsRoleArn` when it has a zone role.
`zoneName` and `zoneId` are absent when the core stack has `domain: false` or no zone; the canopy preview then fails with "publishes no DNS zone".
Only the primary zone of a core stack is readable this way: hosted zones from `core:extraZones` are not published for Canopy.

## Zone list entry rule

The code derives the form of each entry from accounts, not from config: if the core stack's `accountId` equals the account in `canopyDomainsRoleArn`, the entry is `apex=zone-id` and no role is used; otherwise it is `apex=zone-id=role-arn`, and a missing role is a preview error (`pulumi/canopy/src/dns-zone-list.ts`).
`core:canopyInfra` is therefore unnecessary on the core stack in Canopy's own account.
If it is set there, `zone.ts` still creates a `canopy-dns` role, and the list ignores it.

## Namespace and labels

Canopy runs in `tamanu-meta-<stack>` (`canopyNamespace()` in `pulumi/constants/canopy.ts`).
Its workloads carry `app=meta` and `task=<name>`; the pod that writes records is `task=domains`.
The environment of the `domains` pod carries the ACME account key as a plain value: do not print the pod spec ([runbook](../runbooks/canopy-tls-not-issuing.md)).
