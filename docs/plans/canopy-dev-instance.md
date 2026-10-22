# Canopy dev instance

A second Canopy instance, `canopy/dev`, on the main cluster, holding only seeded fake data.
It is the target of continuous deployment from the Canopy repo, and production is promoted from it rather than deployed from every push.

## Shape of the instance

| item | value |
|---|---|
| stack | `canopy/dev` (exists, never applied) |
| cluster | `tamanu-internal-main` |
| namespace | `tamanu-meta-dev` |
| public hostname | `canopy.cd.tamanu.app`, Envoy only (`envoyStage: primary`) |
| tailnet hostname | `canopy-dev`, plus the `tamanu-meta-dev` redirect |
| database | `meta-db`, one instance, 1Gi, on the db-critical pool (room exists on both nodes), Barman backups kept 7 days |
| admins | the tailnet policy grant (`bes.au/cap/canopy` admin, the on-call group), read with the same read-only Tailscale OAuth client as prod; the allowlist starts and stays empty |

Left out of dev, each gated off by leaving its config unset:

- `canopy-infra`: no IRSA service accounts and no artifact store, so artifact upload and serving do not work.
- `recoveryVault`, `backupsShared`: no escrow, no shared backup buckets.
- `dnsZoneStacks`, `acmeAccountKey`: the domains pod idles; Canopy writes no records in real zones and orders no certificates.
- Slack webhooks: no slacker workload, so a test instance never posts to the channels prod notifies.

## Stage 1: stand up the instance

Code (this branch):

1. Slacker optional: with no `slackerOpenUrl`, no slacker Deployment; with it, open, close and self-alert stay required together.
2. `dbInstances` and `dbMemoryRequest` config, defaulting to prod's 2 and 8Gi.
3. Tailnet tags corrected to the set the live prod devices carry (`tag:tools,tag:server,tag:server-canopy`; `tag:k8s-proxy,tag:server,tag:server-canopy` for the DB replica).
   `tag:server-tamanu-meta` has no owner in the tailnet policy, so a fresh instance's tailnet Ingresses would never register.
   On prod the annotation change matches tags the devices already hold.
4. K8SCNP updated for all three.
5. `pulumi/scripts/canopySeedDev.fish`, the one-off seed.

Manual, by an operator with cluster-wide `cluster-admin` (the first apply creates the RBAC that later lets CD apply):

1. Set the dev stack config (below; done locally on 2026-10-23, and recorded in the backend at the first apply).
2. `pulumi preview`, then `pulumi up` on `canopy/dev`.
3. Run `canopySeedDev.fish` once.

```fish
cd pulumi/canopy
pulumi stack select dev
pulumi config set imageTag sha-b7f809a   # whatever prod runs at the time
pulumi config set --path 'domains[0]' canopy.cd.tamanu.app
pulumi config set envoyStage primary
pulumi config set tailscaleHostname canopy-dev
pulumi config set stage dev
pulumi config set deployment canopy-dev
pulumi config set dbInstances 1
pulumi config set dbMemoryRequest 1Gi
pulumi config set backupRetentionDays 7
pulumi config cp --dest dev tailscaleClientId   # run with prod selected
pulumi config cp --dest dev tailscaleClientSecret
```

The `config cp` lines run with `prod` selected and copy into `dev`; the client is read-only (devices and policy file).
`k8s-core` was already set on dev; its old `publicServerVersionsSecret` could not be decrypted and was replaced with a fresh random value (`openssl rand -hex 32 | pulumi config set --secret publicServerVersionsSecret`).

### Seeding

The seed binary is not in the image and refuses release builds, so it runs from a local debug build over a port-forward to the dev primary.
The script:

- works only on context `main`, namespace `tamanu-meta-dev`, and refuses any other namespace;
- requires the checkout's migration set to equal the one applied to the dev database, so the seed's code matches the schema;
- refuses unless the database is fresh (no devices, only the nil application), so it runs once; `--reseed` overrides;
- deletes the three `example.com` admins the seed inserts, so administrative access comes only from the tailnet grant.

## Stage 2: pushes to Canopy main deploy to dev

The CD workflow in the Canopy repo applies `vars.PULUMI_STACK` (`prod`) from infra main on every push.

All of its variables are repo-level today, and `release` has no protection rules.

1. Move `PULUMI_STACK` from the repo to the environments: `dev` (new) gets `dev`, `release` gets `prod`. The other variables stay repo-level and are shared.
2. Point the `deploy` job at `environment: dev`.
3. Nothing changes in the tailnet or the cluster: `tailscale:gha:canopy` already gets `cluster-admin` in whichever namespace a Canopy stack creates, and the dev stack creates its own binding at stage 1.

From then on prod is updated only by stage 3.

## Stage 3: promote dev to prod

A `workflow_dispatch` workflow in the Canopy repo, `promote.yml`, in environment `release`, with required reviewers added to it:

1. Read the image tag dev runs (`pulumi stack output` or `pulumi config get imageTag -s dev`).
2. Apply `prod` with that tag, the same steps as the deploy job.

The image is already built and tested on dev, so promotion is a config change and an apply, with no rebuild.
Open question for stage 3: whether to tag the promoted commit (`release-<date>` or a version) so a deployed prod is named by something other than a sha.
