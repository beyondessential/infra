# Run Dagster on Kubernetes

The stack is ported and the spec is [DAGS](../../../docs/spec/data/dagster.md).
The live Dagster is still the EC2 hosts of data-lake, so this stack replaces them only once the items below are done.

## Remaining before the EC2 hosts can be retired

- [ ] VPN gateway for Tonga, tracked as its own card (C4). One pod in the namespace holds the VPN, and the code locations reach the Tonga hosts through it. Needs the choice of VPN client and its image, the gateway endpoint and credentials, and the list of destinations. Then a DAGS section and a stack file.
- [ ] Fill `tailnetHosts` for each source outside the data account (Tamanu internal and demo, Canopy, the infra database proxies), and change those hosts in the environment value to the Service names. Check any source that verifies the server name in its TLS certificate.
- [ ] A workflow in data-lake that applies this stack on a new image, holding `tailscale:gha:dagster`, and the tailnet entry that gives the workflow that identity. Neither exists.
- [ ] Publish the `data-lake-dagster` image. The data-lake workflow that builds it is manual-only.
- [ ] Replace the daemon heartbeat check that the EC2 host runs every thirty minutes.
- [ ] Decide what replaces the per-branch Dagster hosts that the data-lake Lambda creates.
- [ ] Settle where the instance settings live. data-lake's `devops/k8s/dagster.yaml` says infra mounts it, and this stack sets the same values through chart values.

## Before the first apply

- [ ] IAM database authentication enabled on the RDS instance, and `rds_iam` granted, as the reference page lists.
- [ ] `pulumi preview` with the policy pack.
