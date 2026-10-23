---
id: CORE
---

# Account core

The requirements in this spec apply to the foundational infrastructure of one AWS account, which the other infrastructure of that account depends on.

## Borrowed terms

| term | meaning |
|---|---|
| VPC, subnet, availability zone | A virtual network in one region, a range of its addresses in one availability zone, and an isolated location within the region ([Subnets for your VPC](https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html)). |
| internet gateway | The VPC component through which instances with public addresses reach and are reached from the internet ([Internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Internet_Gateway.html)). |
| egress-only internet gateway | The VPC component through which instances reach the IPv6 internet without being reachable from it ([Egress-only internet gateways](https://docs.aws.amazon.com/vpc/latest/userguide/egress-only-internet-gateway.html)). |
| NAT gateway | The VPC component that forwards the IPv4 internet traffic of instances without public addresses under one public address ([NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html)). |
| Elastic IP | A static public IPv4 address allocated to an account ([Elastic IP addresses](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)). |
| zone, apex, delegation, parent | The DNS terms for a unit of administrative control, the name at which it begins, the creation of a separate zone beneath it, and the domain in which that zone is registered ([RFC 9499 section 7](https://www.rfc-editor.org/rfc/rfc9499#section-7)). |
| name server | A server that answers for a zone from its own knowledge, named in an NS record of the zone ([RFC 9499 section 6](https://www.rfc-editor.org/rfc/rfc9499#section-6)). |
| hosted zone | A Route 53 container of the records of one DNS zone, with the name servers Route 53 assigns to it ([Working with public hosted zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html), [Routing traffic for subdomains](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-routing-traffic-for-subdomains.html)). |
| output | A named value a [stack](overview.md#stack) publishes for other stacks to read ([Stack outputs](https://www.pulumi.com/docs/iac/concepts/stacks/#outputs)). |
| managed policy | A standalone IAM policy that can be attached to several users, groups and roles ([Managed and inline policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html)). |
| OIDC identity provider | An IAM entity that lets roles trust tokens issued by an external OpenID Connect issuer ([Create an OIDC identity provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html), [GitHub OIDC in AWS](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)). |
| topic, alarm | An SNS channel that delivers each message published to it to its subscribers, and a CloudWatch rule that publishes to a topic when a metric crosses a threshold ([Creating an SNS topic](https://docs.aws.amazon.com/sns/latest/dg/sns-create-topic.html), [CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)). |

## Account

A [core](overview.md#core) is the foundational infrastructure of one AWS account in one region.

An AWS account hosting workloads MUST have exactly one core.

A stack that consumes a core MUST refuse to run against an account whose id differs from the id the core publishes.

> [!NOTE]
> This means that AWS accounts cannot be used across multiple regions, which avoids "I accidentally put resources in `us-east-1`" — when the core is required, this simply isn't possible.
> This restriction doesn't apply to some special _non-workload_ accounts, which by nature need to span multiple regions.
> This restriction also doesn't apply to non-regional resources, such as DNS records.

## Account baseline

A core MUST set the [password policy](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_passwords_account-policy.html) of its account to the values of the following table.

| setting | value |
|---|---|
| minimum length | 15 characters |
| expiry | none |
| reuse prevention | the 24 previous passwords |
| users may change their own password | yes |

> [!NOTE]
> Forced expiry leads users to weaker, incremented passwords, so the policy deliberately sets none.

A core MUST turn on [encryption by default](https://docs.aws.amazon.com/ebs/latest/userguide/encryption-by-default.html) for EBS in its region, with the AWS-managed key `alias/aws/ebs` as the default key.

## Audit

A core MUST have a [flow log](https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs.html) on its VPC that records rejected traffic to the CloudWatch log group `/aws/vpc/flowlogs/core-network`.

The log group MUST keep its records for at least 30 days.

## Network

A core MUST have one VPC, with the `Name` tag `core-network`.

A core MUST have IPv4 addressing, IPv6 addressing, or both.

> [!NOTE]
> It's strongly recommended to always have dual-stack IPv4 and IPv6 addressing enabled.
> There are very few cases where a single-stack addressing core is useful, but it is kept as a possibility.

Each subnet of the VPC MUST have the same addressing as the core.

The VPC MUST have DNS resolution turned on, and SHOULD have DNS hostnames turned on.

A core MUST span at least two availability zones of its region.

> [!NOTE]
> Once an AZ set and number is chosen, widening or changing it may require tearing down and remaking every workload, so be sure!
> Removing an AZ is easier but not recommended.

The subnets of the VPC MUST be in the tiers of the following table.

| tier | `Purpose` tag | `Name` tag | addressing | internet route | load balancer role tag |
|---|---|---|---|---|---|
| NAT | `nat` | `core-network-nat-<az>` | public addresses on launch | the internet gateway | `kubernetes.io/role/elb: 1` |
| private workload | `workload` | `core-network-workload<n>-<az>` | no public addresses | IPv4 through the NAT gateway of its availability zone, IPv6 through the egress-only internet gateway | `kubernetes.io/role/internal-elb: 1` |
| public workload | `workload` | `core-network-pubworkload<n>-<az>` | public addresses on launch | the internet gateway | `kubernetes.io/role/elb: 1` |

In the `Name` tag, `<az>` is the letter suffix of the availability zone and `<n>` is its position counted from 1.

A tier that a core has MUST have one subnet in each availability zone of the core.

A subnet MUST carry the `Purpose` tag and the `Name` tag of its tier.

A core that hosts a Kubernetes cluster MUST have all three tiers.

A core that hosts a Kubernetes cluster MUST tag each subnet with the load balancer role tag of its tier.

A core that hosts no cluster MAY omit the NAT tier and the private workload tier together.

A core MUST leave in place every tag whose key begins with `karpenter.sh/` or `karpenter.k8s.aws/` that a cluster places on a subnet, route table or [security group](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) of the VPC.

> [!NOTE]
> A cluster marks the subnets and security groups it owns with tags under those prefixes, and a core that treated them as drift would strip them on every update.

In a core with IPv6 addressing, each subnet SHOULD give the instances launched in it hostnames derived from their instance id, with an AAAA record and, where the core also has IPv4 addressing, an A record.

In a core with IPv6 addressing and no IPv4 addressing, each subnet MUST be IPv6-only and MUST have DNS64 turned on.

A core that has the private workload tier MUST have a [DB subnet group](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html) made of the subnets of that tier, carrying the `Purpose` tag `database`.

## Addressing

In a core with IPv4 addressing, the IPv4 range of the VPC MUST be `10.<N>.0.0/16`, where `<N>` is the number formed by the last two decimal digits of the account id, unless the core is given another range.

> [!NOTE]
> The account id `123456789007` gives `10.7.0.0/16`.
> The derivation does not make ranges unique: two accounts whose ids end in the same two digits get the same range, and routing or peering between them needs mapping.
> The derivation is primarily a way to get a quick reference of which account a box is in when SSHing around.

In a core with IPv6 addressing, the IPv6 range of the VPC MUST be a `/56` that Amazon assigns.

The availability zones of a core MUST be numbered from 0 in the order of their letter suffix, and `<Z>` is the number of availability zones of the core.

The subnet of each tier in availability zone `<i>` MUST have, for each address family of the core, the range of the following table.

| tier | IPv4 range | IPv6 range |
|---|---|---|
| NAT | the `/28` at position `<i>` of the first `/24` of the VPC | the `/64` at position `<i>` of the VPC |
| private workload | the `/24` at position `1 + <i>` of the VPC | the `/64` at position `<Z> + <i>` of the VPC |
| public workload | the `/24` at position `<Z> + 1 + <i>` of the VPC | the `/64` at position `2 × <Z> + <i>` of the VPC |

A position counts from 0 at the start of the range of the VPC, and the `/64` at position `<p>` is the `/56` of the VPC with `<p>` as its next eight bits.

A subnet MUST have the ranges of its tier and availability zone whether or not the core has the other tiers.

> [!NOTE]
> With three availability zones and `10.7.0.0/16`, the NAT subnets are `10.7.0.0/28`, `10.7.0.16/28` and `10.7.0.32/28`, the private workload subnets are `10.7.1.0/24` to `10.7.3.0/24`, and the public workload subnets are `10.7.4.0/24` to `10.7.6.0/24`.
> With the `/56` `2406:da1c:4a9:6600::/56`, the public workload subnet of the first availability zone is `2406:da1c:4a9:6606::/64`.
> Fixed positions let a core add or remove a tier without renumbering, and so without recreating, the subnets of the other tiers.

## Egress

A core with IPv4 addressing that has the NAT tier MUST have one NAT gateway in the NAT subnet of each availability zone, each with its own Elastic IP.

IPv4 traffic from a private workload subnet to the internet MUST egress through the NAT gateway of the same availability zone.

IPv6 traffic from a private workload subnet to the internet MUST egress through the egress-only internet gateway.

IPv6 traffic from a NAT subnet or a public workload subnet to the internet MUST egress through the internet gateway.

In a core with both IPv4 and IPv6 addressing, traffic from a NAT subnet or a private workload subnet to `64:ff9b::/96` MUST route through the NAT gateway of the same availability zone.

A core MUST keep the Elastic IP of each NAT gateway across its updates.

> [!NOTE]
> Partners allowlist those addresses, so an address that changed with an update would cut traffic to them off until every allowlist was amended.

A core MUST have a [gateway endpoint](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html) for S3 in its region, routed from the route table of every subnet of the VPC.

## Zone

The zone of a core is the public DNS zone whose apex is the domain of its account.

The domain of an account whose core is the stack `tamanu-<name>` or `tamanu-<name>-prod` MUST be `<name>.tamanu.app`, unless the core is given another domain or no zone.

The domain of any other account MUST be given to its core.

A core MAY have no zone.

A core that has a zone MUST hold that zone in one public hosted zone.

A core MAY have extra zones, each held in its own public hosted zone with its own apex.

The parent zone of every zone of a core MUST carry NS records that delegate the zone to the name servers of its hosted zone.

A core that has a zone MUST have a zone management policy, a managed policy that grants reading and changing the records of that zone, reading the status of changes, and listing hosted zones.

The zone management policy MUST grant no access to the records of any other hosted zone.

A core MUST leave in place the attachments of the zone management policy that other stacks make to their own users and roles.

## Deployment identity

A core MAY have an OIDC identity provider for GitHub Actions, for the issuer `https://token.actions.githubusercontent.com` with the audience `sts.amazonaws.com`.

A core that hosts a Kubernetes cluster MUST have that provider.

A role that a GitHub Actions workflow assumes in the account SHOULD trust that provider.

## Cluster permissions

A core that hosts a Kubernetes cluster with IPv6 addressing MUST have the managed policy `AmazonEKS_CNI_IPv6_Policy`, granting the permissions that the [VPC CNI](https://docs.aws.amazon.com/eks/latest/userguide/cni-iam-role.html) needs to assign IPv6 addresses to pods.

## Spot data feed

A core MUST have an S3 bucket named `bes-spot-data-feed-<account id>` that receives the [Spot data feed](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/spot-data-feeds.html) of its account under the prefix `spot-pricing`.

The bucket SHOULD delete feed files older than 30 days.

## Alerts

A core MUST have one alerts topic for its account, with the display name `[<stack>] Workload Alerts` after the core's stack.

The alerts topic MUST have at least one subscriber that reaches the operators of the account.

A core MUST raise the alarms of the following table to the alerts topic.

| alarm | condition |
|---|---|
| `OverallHighCPU` | The maximum CPU utilisation of any EC2 instance is at least 80% over two consecutive 2-hour periods. |
| `CPUCreditsCharged` | The [surplus credits](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-unlimited-mode-concepts.html) charged across the account are at least 60 CPU-minutes in each of two consecutive 5-minute periods. |

A stack in the account MAY publish the alarms it raises to the alerts topic of its core.

## Outputs

A core MUST publish the outputs of the following table, under the names given.

| output | meaning |
|---|---|
| `accountId` | The id of the account. |
| `region` | The region of the core. |
| `tags` | The tags that the stacks of the account apply to their resources, by key. |
| `ipv4`, `ipv6` | Whether the VPC provides IPv4 and IPv6 addressing. |
| `network` | The id and the IPv4 and IPv6 ranges of the VPC and, for each tier, the id, availability zone and ranges of each of its subnets. |
| `dbSubnetGroup` | The ARN of the DB subnet group. |
| `zoneName` | The apex of the zone. |
| `zoneId` | The hosted zone id of the zone. |
| `zoneNS` | The name servers of the hosted zone of the zone. |
| `zoneMgmtPolicy` | The ARN of the zone management policy. |
| `canopyDnsRoleArn` | The ARN of the [zone role](overview.md#zone-role) of the core. |
| `extraZoneIds` | The hosted zone id of each extra zone, by apex. |
| `extraZoneNS` | The name servers of the hosted zone of each extra zone, by apex. |
| `ghaOidc` | The ARN and issuer URL of the OIDC identity provider for GitHub Actions. |
| `eksCniV6Policy` | The ARN of `AmazonEKS_CNI_IPv6_Policy`. |
| `spotDataFeed` | The name and ARN of the bucket of the Spot data feed. |
| `alertsTopicArn` | The ARN of the alerts topic. |

A core that has no zone MUST publish no value for `zoneName`, `zoneId`, `zoneNS` or `zoneMgmtPolicy`.

A core that has no zone role MUST publish no value for `canopyDnsRoleArn`.

A core that has no private workload tier MUST publish no value for `dbSubnetGroup`.

A core that has no OIDC identity provider for GitHub Actions MUST publish no value for the ARN or URL of `ghaOidc`.

A core that has no `AmazonEKS_CNI_IPv6_Policy` MUST publish no value for `eksCniV6Policy`.

A stack that needs one of these values MUST read it from the outputs of its core.
