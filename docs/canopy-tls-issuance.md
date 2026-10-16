# Enabling a Core for Canopy TLS Issuance

Canopy holds the ACME account and the write access to our DNS zones. A server asks Canopy for a certificate over its mTLS device identity, Canopy proves control of the name with a DNS-01 challenge and hands back the chain. The server's private key never leaves the machine — only a CSR goes up — and a machine issuing this way needs no Route 53 credential of its own.

This is the procedure for letting Canopy into one more account's zone.

Related: `docs/pulumi-core.md` for the core stack, `docs/pulumi-organisation.md` for the cross-stack mechanism.

---

## 1. The three moving parts

| Part | Where | What it is |
|---|---|---|
| `canopy-domains` | `pulumi/canopy-infra/` | Canopy's IRSA identity in the central account (`_Internal Tamanu`). Holds `sts:AssumeRole`, plus direct write on that account's own zone. Published as `canopyDomainsRoleArn`. |
| `canopy-dns` | `pulumi/core/src/zone.ts` | A role in the member account that trusts `canopy-domains`. Created when `core:canopyInfra` is set. Published as `canopyDnsRoleArn`. |
| `dnsZoneStacks` | `pulumi/canopy/` config | The core stacks whose zones Canopy manages. Rendered into `CANOPY_DNS_ZONES` on every Canopy workload. |

The member-account role's trust policy is the gate. Canopy's side carries `sts:AssumeRole` on `*`, so a zone is reachable only because its own account named `canopy-domains` as a principal.

A zone in the central account takes no role: `canopy-infra` grants the write directly, and the zone list omits the role ARN for it. The canopy stack works out which case a zone is by comparing the core stack's `accountId` against the account in `canopyDomainsRoleArn`.

---

## 2. Before starting

- The account's core stack owns the zone — check `pulumi stack output -s bes/core/<stack>` shows `zoneName` and `zoneId`.
- `bes/canopy-infra/prod` is deployed, so `canopyDomainsRoleArn` exists. Everything downstream reads it.
- Build the policy pack, or the guardrails silently do not run: `cd pulumi/policies && npm run build`.

---

## 3. Point the core stack at Canopy

Core config files are gitignored and may not exist locally. Pull it first, or `config set` writes a file holding nothing else:

```fish
cd pulumi/core
pulumi config refresh -s bes/core/<stack>    # or scripts/refreshConfigs.fish core
pulumi config set canopyInfra bes/canopy-infra/prod -s bes/core/<stack>
```

Preview, then deploy. `p-run` reads `core:ssoProfile` from the stack and wraps the command in `aws-sso exec`; stacks with no `ssoProfile` take the long form:

```fish
./p-run <stack> preview --policy-pack ../policies
aws-sso exec -p <Account>:AdminAccess -- pulumi preview -s bes/core/<stack> --policy-pack ../policies
```

Expect two new resources: `aws-native:iam:Role canopy-dns` and `aws-native:iam:ManagedPolicy canopy-dns`. IAM role creation is why this wants AdminAccess.

**Read the whole preview before running `up`.** A core stack that has not been deployed in a while has other changes pending, and they land with this one. `tamanu-fsm-prod` had an S3 VPC endpoint and an AWS provider waiting — harmless, but a standing cost nobody chose that day.

Then confirm the role exists:

```fish
pulumi stack output -s bes/core/<stack> | grep canopyDnsRoleArn
```

---

## 4. Add the zone to Canopy

The canopy stack reaches its cluster over Tailscale and needs no AWS credentials, so no `aws-sso` here:

```fish
cd pulumi/canopy
pulumi config set --path canopy:dnsZoneStacks[2] bes/core/<stack> -s bes/canopy/prod
pulumi preview -s bes/canopy/prod --policy-pack ../policies
pulumi up -s bes/canopy/prod --policy-pack ../policies
```

Index the path one past the end of the existing list. `CANOPY_DNS_ZONES` goes to every Canopy workload, not just the domains pod: private-server answers which zones are claimable into, public-server gates a server's name entitlements, and the monitor reports a group domain no configured zone covers. So the preview shows every Deployment updating.

The ACME account is narrower: `canopy:acmeAccountKey`, `acmeDirectory` and `acmeContact` go to the domains pod, which orders with them, and to private-server, which reports the authority on the settings panel. The key is a credential, so the pods with no use for it do not carry it.

The domains pod reads the list once at startup — changing it is an instance configuration change, and re-reading per tick would let a half-applied config take live records down. Check it came up with the zone:

```fish
kubectl --context=main -n tamanu-meta-prod logs -l task=domains --tail=20
```

```
INFO domains: managing DNS zones zones=["tamanu.app", "fsm.tamanu.app", "fsm-dev.tamanu.app"]
INFO commons_servers::acme: ACME account ready directory=… profiles=["classic", "shortlived", "tlsserver"]
```

---

## 5. Grant it to a group

In Canopy's admin UI, on the group's detail page, claim the domain — at or under one of the configured apexes. The group then controls that name and everything beneath it, and no other group can claim anything overlapping it.

Then set the TLS grant on each application that should ask. The grant control only appears once the group holds a claim: offering it where no domain is controlled would present a control that cannot do anything, so its absence is not a broken deploy.

---

## 6. Delegation: one entry per zone, not per apex

Enabling `tamanu.app` does not enable the zones delegated out of it. A DNS-01 challenge record has to be written in the zone that is *authoritative* for the name; written in a parent, the delegation shadows it and validation fails with nothing wrong on the AWS side.

So `fsm.tamanu.app` needs its own entry however much of `tamanu.app` is configured. There are ~22 delegated zones under `tamanu.app`, each in its own account. `pulumi stack output` on each core stack names them (`zoneName`, `zoneId`, `accountId`).

Configured today:

| Zone | Hosted zone | Account | Role |
|---|---|---|---|
| `tamanu.app` | `Z0…` | `_Internal Tamanu` | none — central account |
| `fsm.tamanu.app` | `Z0…` | `FSM Tamanu Prod` | `canopy-dns` |
| `fsm-dev.tamanu.app` | `Z0…` | `FSM Tamanu Clone` | `canopy-dns` |

---

## 7. What Canopy can do in a zone

`route53:ChangeResourceRecordSets` on that one hosted zone, conditioned to `A`, `AAAA` and `TXT`. Nothing else — no list, no read, and structurally no way to touch the zone's `NS` delegation or `SOA`.

Which *names* Canopy acts on is bounded by the group domain claims, not by IAM. A write replaces a record set wholesale, so do not claim a domain whose names something else manages: `meta.tamanu.app` is Canopy's own Ingress, published by external-dns, and lives in the apex zone.

Let's Encrypt's rate limits are per registered domain, so every group under `tamanu.app` draws on one allowance. Canopy treats throttling as fleet-wide and holds off orders for 10 minutes rather than spending what is left.

---

## 8. Staging to production

`canopy:acmeDirectory` points at Let's Encrypt staging while a zone is being proved out. Staging certificates chain to an untrusted root, so they demonstrate the plumbing and nothing else. To move to production issuance, drop the key and redeploy:

```fish
pulumi config rm canopy:acmeDirectory -s bes/canopy/prod
pulumi up -s bes/canopy/prod --policy-pack ../policies
```

Canopy finds-or-creates its account from `canopy:acmeAccountKey` at every start, so the same key yields a separate account at each directory and there is no state to migrate.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| Canopy preview: `publishes no canopyDnsRoleArn … set canopyInfra on that stack and deploy it first` | Section 3 not done, or done but not deployed. |
| Canopy preview: `canopy-infra publishes no canopyDomainsRoleArn` | `canopy-infra` not deployed. |
| Canopy preview: `publishes no DNS zone` | The named core stack has `domain: false` or no zone. |
| Pod logs `no DNS zones configured (CANOPY_DNS_ZONES); the domains pod will idle` | `dnsZoneStacks` unset on the canopy stack. |
| A claim in the UI shows no zone | The claim's zone left the configuration. The claim stands and still excludes other groups, but Canopy acts on no name beneath it. |
| Records fail to write with `AccessDenied` | The member-account role is missing, or its trust policy names a stale `canopy-domains` ARN. Redeploy the core stack. |
| Order fails validation, records look right | Check the challenge went to the authoritative zone — see section 6. |

Canopy files its own alerts for most of this: a group domain outside the configured zones, and whether it can reach the authority at all, are reported against Canopy rather than against the asking server.

---

## 10. Nothing asks yet

The server side does not exist. bestool has only its device mTLS enrolment; nothing calls Canopy's name-registration or certificate endpoints, and the Linux servers still run their own DNS-01 through a per-server IAM user. Tracked as bestool card A3.

Until that lands, a zone enabled here is Canopy able to issue on request, with no requests arriving. `certificate authority ready` in the pod log is the end state to expect.
