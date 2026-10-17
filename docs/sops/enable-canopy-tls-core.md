# SOP: Let Canopy issue certificates in another account's zone

Canopy holds the ACME account and the write access to DNS zones; a server asks for a certificate, Canopy proves control of the name by DNS-01 and returns the chain.
This procedure lets Canopy into one more account's zone.
Requirements: [CTLS](../spec/canopy/tls-issuance.md).
Where each piece lives, and the keys and outputs: [canopy-tls-config](../reference/canopy-tls-config.md).
Symptoms afterwards: [canopy-tls-not-issuing](../runbooks/canopy-tls-not-issuing.md).

Every action is tagged with its class from the ladder in [README](../README.md).
Check [ruled-out-actions](../ruled-out-actions.md) before running anything mutating.
Steps 1 and 2 change IAM and live DNS permissions, so they are **[dev-OTS]** and a human runs them.
Step 1 needs an AdminAccess profile, which an agent never initiates.
Do not create or print the ACME account key: it is a credential (**[sensitive-data]**).

## Before you start

- The account's core stack owns the zone: `pulumi stack output -s bes/core/<stack>` shows `zoneName`, `zoneId` and `accountId`. **[diagnose]**
- `bes/canopy-infra/prod` is deployed, so `canopyDomainsRoleArn` exists. Everything downstream reads it. **[diagnose]**
- Build the policy pack, or the guardrails silently do not run: `npm run build` in `pulumi/policies`.
- Pull the stack configs you will change ([refresh-stack-config](refresh-stack-config.md)).
- If the zone is in Canopy's own account, skip step 1 and do not set `core:canopyInfra` there ([why](../reference/canopy-tls-config.md#zone-list-entry-rule)).

## 1. Point the core stack at Canopy

```fish
cd pulumi/core
pulumi config set canopyInfra bes/canopy-infra/prod -s bes/core/<stack>        # [dev-OTS]
./p-run <stack> preview --policy-pack ../policies                             # [diagnose]
./p-run <stack> up --policy-pack ../policies                                  # [dev-OTS]
```

`p-run` reads `core:ssoProfile` from the stack and wraps the command in `aws-sso exec`.
A stack with no `ssoProfile` takes the long form: `aws-sso exec -p <Account>:AdminAccess -- pulumi preview -s bes/core/<stack> --policy-pack ../policies`.
An agent runs the preview with a `ReadAccess` profile only; the AdminAccess form is for a human, and an agent never initiates it.

Expect two new resources: `aws-native:iam:Role canopy-dns` and `aws-native:iam:ManagedPolicy canopy-dns`.
Read the whole preview before `up`: a core stack that has not been deployed for a while has other pending changes, and they land with this one.

Confirm the role exists. **[diagnose]**

```fish
pulumi stack output -s bes/core/<stack> | grep canopyDnsRoleArn
```

## 2. Add the zone to Canopy

The canopy stack reaches its cluster over the tailnet and needs no AWS credentials.

```fish
cd pulumi/canopy
pulumi config set --path canopy:dnsZoneStacks[<N>] bes/core/<stack> -s bes/canopy/prod   # [dev-OTS]
pulumi preview -s bes/canopy/prod --policy-pack ../policies                             # [diagnose]
pulumi up -s bes/canopy/prod --policy-pack ../policies                                  # [dev-OTS]
```

Use an index one past the end of the existing list.
Expect every Canopy Deployment to update: the zone list goes to every Canopy workload, not only the one that writes records ([managed zones](../spec/canopy/tls-issuance.md#managed-zones)).
The ACME key goes only to the domains and private-server workloads.

The domains pod reads the list once at start-up, so a change takes effect when it restarts.
Check it came up with the zone. **[diagnose]**

```
kubectl --context=<context> -n tamanu-meta-prod logs -l task=domains --tail=20
```

The expected lines name the zones it manages and then an ACME account ready for the directory, as in `managing DNS zones zones=[...]` and `commons_servers::acme: ACME account ready` (log wording is from the Canopy application, not this repository).

## 3. Grant it to a group

In Canopy's admin UI, on the group's detail page, claim a domain at or under one of the configured apexes.
The group then controls that name and everything beneath it, and no other group can claim anything overlapping ([DOM, Exclusivity within Canopy](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#exclusivity-within-canopy)).
Then set the TLS grant on each application that should ask.
The grant control appears only once the group holds a claim, so its absence is not a broken deploy.

Do not claim a domain whose names something else manages: a Canopy write replaces a record set wholesale.
The Canopy `meta` hostname, published by external-dns in the apex zone, is one such name.

## 4. One entry per zone

Enabling an apex does not enable the zones delegated out of it.
A challenge record has to be written in the zone that is authoritative for the name; written in a parent, the delegation shadows it and validation fails with nothing wrong on the AWS side ([zone delegation](../spec/canopy/tls-issuance.md#zone-delegation)).
Repeat steps 1 and 2 for each delegated zone, from its own core stack.

To see what is configured, read the canopy stack's `canopy:dnsZoneStacks` (`pulumi config -s bes/canopy/prod`). **[diagnose]**

## 5. Staging to production (once per Canopy deployment)

While a zone is being proved, `canopy:acmeDirectory` may point at the Let's Encrypt staging authority; its certificates chain to an untrusted root and prove the plumbing only.
To issue for real, remove the key and redeploy. **[dev-OTS]**

```fish
pulumi config rm canopy:acmeDirectory -s bes/canopy/prod
pulumi up -s bes/canopy/prod --policy-pack ../policies
```

Canopy finds or creates its ACME account from `canopy:acmeAccountKey` at every start, so the same key yields a separate account at each directory and nothing needs migrating; the directory is the only setting that changes ([staging and production](../spec/canopy/tls-issuance.md#staging-and-production)).
Let's Encrypt limits are per registered domain, so every group beneath one domain shares one allowance ([CRT, When issuance fails](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md#when-issuance-fails)).
