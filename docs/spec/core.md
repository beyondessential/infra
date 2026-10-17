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
| security group | A stateful packet filter attached to network interfaces in a VPC ([Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)). |
| zone, apex, delegation, parent | The DNS terms for a unit of administrative control, the name at which it begins, the creation of a separate zone beneath it, and the domain in which that zone is registered ([RFC 9499 section 7](https://www.rfc-editor.org/rfc/rfc9499#section-7)). |
| name server | A server that answers for a zone from its own knowledge, named in an NS record of the zone ([RFC 9499 section 6](https://www.rfc-editor.org/rfc/rfc9499#section-6)). |
| hosted zone | A Route 53 container of the records of one DNS zone, with the name servers Route 53 assigns to it ([Working with public hosted zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html), [Routing traffic for subdomains](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-routing-traffic-for-subdomains.html)). |
| output | A named value a [stack](overview.md#stack) publishes for other stacks to read ([Stack outputs](https://www.pulumi.com/docs/iac/concepts/stacks/#outputs)). |

## Account

A [core](overview.md#core) is the foundational infrastructure of one AWS account, which owns the public DNS zone of the account.

An AWS account MUST have exactly one core.

A core MUST publish the id of its account.

A stack that consumes a core MUST refuse to run against an account whose id differs from the id the core publishes.

## Network

A core MUST have one VPC.

The VPC SHOULD provide both IPv4 and IPv6 addressing.

A core MUST span three availability zones of its region.

The subnets of the VPC MUST be in the tiers of the following table.

| tier | `Purpose` tag | addressing | internet route | load balancer role tag |
|---|---|---|---|---|
| NAT | `nat` | public addresses on launch | the internet gateway | `kubernetes.io/role/elb: 1` |
| private workload | `workload` | no public addresses | IPv4 through the NAT gateway of its availability zone, IPv6 through the egress-only internet gateway | `kubernetes.io/role/internal-elb: 1` |
| public workload | `workload` | public addresses on launch | the internet gateway | `kubernetes.io/role/elb: 1` |

A tier that a core has MUST have one subnet in each availability zone of the core.

A subnet MUST carry the `Purpose` tag of its tier.

A core that hosts a Kubernetes cluster MUST have all three tiers.

A core that hosts a Kubernetes cluster MUST tag each subnet with the load balancer role tag of its tier.

A core that hosts no cluster MAY omit the NAT tier and the private workload tier together.

A core MUST leave in place every tag whose key begins with `karpenter.sh/` or `karpenter.k8s.aws/` that a cluster places on a subnet, route table or security group of the VPC.

> [!NOTE]
> A cluster marks the subnets and security groups it owns with tags under those prefixes, and a core that treated them as drift would strip them on every update.

## Egress

A core that has the NAT tier MUST have one NAT gateway in the NAT subnet of each availability zone, each with its own Elastic IP.

IPv4 traffic from a private workload subnet to the internet MUST egress through the NAT gateway of the same availability zone.

A core MUST keep the Elastic IP of each NAT gateway across its updates.

> [!NOTE]
> Partners allowlist those addresses, so an address that changed with an update would cut traffic to them off until every allowlist was amended.

## Zone

The zone of a core is the public DNS zone whose apex is the domain of its account.

A core MAY have no zone.

A core that has a zone MUST hold that zone in one public hosted zone.

A core MAY have extra zones, each held in its own public hosted zone with its own apex.

The parent zone of every zone of a core MUST carry NS records that delegate the zone to the name servers of its hosted zone.

## Alerts

A core MUST have one alerts topic for its account.

A stack in the account MAY publish the alarms it raises to the alerts topic of its core.

## Outputs

A core MUST publish the outputs of the following table, under the names given.

| output | meaning |
|---|---|
| `accountId` | The id of the account. |
| `network` | The id of the VPC and, for each tier, the ids of its subnets. |
| `zoneName` | The apex of the zone. |
| `zoneId` | The hosted zone id of the zone. |
| `zoneNS` | The name servers of the hosted zone of the zone. |
| `canopyDnsRoleArn` | The ARN of the [zone role](overview.md#zone-role) of the core. |
| `extraZoneIds` | The hosted zone id of each extra zone, by apex. |
| `extraZoneNS` | The name servers of the hosted zone of each extra zone, by apex. |
| `alertsTopicArn` | The ARN of the alerts topic. |

A core that has no zone MUST publish no value for `zoneName`, `zoneId` or `zoneNS`.

A core that has no zone role MUST publish no value for `canopyDnsRoleArn`.

A stack that needs one of these values MUST read it from the outputs of its core.
