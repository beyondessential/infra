---
id: LNXAWS
---

# Linux servers in AWS

The requirements in this spec apply to the cloud infrastructure that provisions the [Linux servers](../overview.md#linux-server) of a deployment.
The baseline of a server is specified by [LNXSRV](server.md), mSupply by [LNXMSP](msupply.md), backups by [LNXBAK](backups.md), and the playbooks that take over from provisioning by [LNXANS](ansible.md).

## Borrowed terms

| term | meaning |
|---|---|
| instance | An EC2 instance ([Amazon EC2 instances](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Instances.html)). |
| BES Linux image | The disk image that BES's linux-images repository builds, whose cloud variant is published as an AMI ([disk images](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#variants)). |
| user data | The data an instance receives at launch, from which cloud-init runs a list of commands at first boot ([Run commands when you launch an instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/user-data.html), [cloud-init documentation](https://cloudinit.readthedocs.io/en/latest/)). |
| IMDSv2 | The session-oriented method of the EC2 instance metadata service ([Amazon EC2 instance metadata service configuration](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html)). |
| instance metadata tags | The exposure of an instance's EC2 tags through the instance metadata service ([Work with instance tags in instance metadata](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/work-with-tags-in-IMDS.html)). |
| gp3 | The general-purpose SSD volume type of EBS ([General purpose SSD volumes](https://docs.aws.amazon.com/ebs/latest/userguide/general-purpose.html)). |
| Elastic IP address | A static public IPv4 address that is associated with an instance ([Elastic IP addresses](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/elastic-ip-addresses-eip.html)). |
| security group | The stateful packet filter that controls the traffic to and from an instance ([Security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html)). |
| Tailscale tag | An ACL tag that identifies a tailnet node by its role instead of its user ([Tailscale tags](https://tailscale.com/kb/1068/tags)). |
| Tailscale SSH | SSH access to a node that tailscaled authenticates and authorises from the tailnet policy ([Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh)). |

## Instances and external servers

A deployment's servers MUST be provisioned from one infrastructure stack for the deployment.

A server MUST be either an instance in the deployment's AWS account or an [external server](../overview.md#external-server).

A server MUST be an external server where its configuration says so or lists any external IP address.

An external server MUST NOT have an instance or volumes provisioned for it.

The infrastructure stack MUST refuse to run against an AWS account other than the account of its [core](../overview.md#core).

## Provisioning

An instance MUST boot from the cloud variant of the [BES Linux image](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#variants) for arm64, which [`image.output.aws-ami`](https://github.com/beyondessential/linux-images/blob/main/docs/spec/disk-images.md#output) publishes as an AMI.

An instance MUST have the properties in the following table.

| property | value |
|---|---|
| instance type | `t4g.medium`, unless the server configures another |
| root volume | gp3, encrypted, 50 GiB unless the server or the deployment configures another size |
| public address | one static Elastic IP address |
| metadata | IMDSv2 required, IPv6 endpoint enabled, instance metadata tags enabled |
| monitoring | detailed |
| termination protection | on, unless the deployment sets hard delete |
| subnet | a public workload subnet of the core, chosen by the position of the server among the deployment's servers |
| security group | the deployment's security group |

A change to the image, the root volume or the user data of an instance after its creation MUST NOT replace the instance.

## First boot

An instance MUST run the following steps from its user data at first boot, in order.

1. Set the hostname to the server's fully qualified domain name.
1. Join the tailnet with a single-use, pre-authorised key that expires after 6 hours, advertising the Tailscale tags of the deployment, under the Tailscale name of the server, with Tailscale SSH enabled and the user `ubuntu` as the operator.
1. Add the fixed emergency public key `emergency@tamanu` to the authorized keys of the user `ubuntu`.

> [!NOTE]
> The emergency key is one key for every deployment.
> It is the only access to an instance whose Tailscale membership has failed.

The user data of an instance MUST be held as a secret.

> [!NOTE]
> The user data contains the Tailscale key.

The Tailscale tags of a deployment's servers SHOULD default to `tag:server`, `tag:server-tamanu`, `tag:server-tamanu-<root>` where the zone has a root name, and `tag:server-tamanu-<type>` where the stack is recognisable as a `demo`, `clone` or `prod` deployment.

## Partitioning

An instance SHOULD be provisioned in the single layout of [LNXSRV](server.md#storage-layout).

An instance MAY be provisioned in the [split layout](../overview.md#split-layout).

An instance in the single layout MUST carry the [instance tag](#instance-tags) `Partitioning` with the value `single-btrfs`.

An instance in the split layout MUST carry the instance tag `Partitioning` with the value `split-data-logs`, and MUST have the additional volumes in the following table.

| volume | device | size | type |
|---|---|---|---|
| logs | `/dev/sdl` | 10 GiB | gp3, encrypted |
| data | `/dev/sdp` | 50 GiB | gp3, encrypted |

A volume of the split layout MUST be snapshotted when it is deleted.

A change to the size of a volume of the split layout after its creation MUST NOT replace the volume.

## Instance tags

An instance MUST carry the instance tags in the following table.

| tag | value | condition |
|---|---|---|
| `Name` | the name prefix followed by the server's display name | always |
| `FQDN` | the server's fully qualified domain name | always |
| `Partitioning` | `single-btrfs` or `split-data-logs`, as [Partitioning](#partitioning) gives | always |
| `TailscaleName` | the server's Tailscale name | always |
| `TamanuServerID` | `central`, or the facility identifier | always |
| `TamanuServerName` | the server's display name | always |
| `TamanuServerType` | `central` or `facility` | always |
| `Purpose` | `tamanu-server` | always |
| `ManagedBy` | `pulumi` | always |
| `PatientPortalFQDN` | the patient portal hostname | the server is central and a patient portal label is configured |
| `TamanuCloneOf` | the reference of the source stack | the stack is a clone of another stack |

An instance MUST also carry the billing tags of the deployment.

An instance of a server that has mSupply configured MUST carry the instance tags that [LNXMSP](msupply.md#provisioning) gives.

The playbooks MUST read the instance tags `Partitioning` and `PatientPortalFQDN` from the instance metadata service with IMDSv2, and MUST treat an absent tag as unset.

## Naming

The hostnames and Tailscale names of a deployment MUST follow the forms in the following table.

| name | form |
|---|---|
| central hostname | `<subdomain>.<domain base>`, with the subdomain defaulting to `central` |
| facility hostname | `<subdomain>.<domain base>`, with the subdomain defaulting to the facility identifier |
| facility identifier | the configured identifier, prefixed with `facility-` where it does not begin with that |
| patient portal hostname | `<label>.<domain base>`, with the label defaulting to `patient` |
| Tailscale name of central | `<Tailscale base>-central` |
| Tailscale name of a facility | `<Tailscale base>-facility-<identifier without the prefix>` |

A domain base without a dot MUST be a subdomain of the zone of the core.

The patient portal hostname MUST be omitted where its label is configured empty.

A server's Tailscale name SHOULD be configurable.

## Network exposure

The security group of a deployment MUST allow the inbound traffic in the following table from any source.

| protocol | port |
|---|---|
| ICMP | all types and codes |
| ICMPv6 | all types and codes |
| TCP | 80 |
| TCP | 443 |
| UDP | 443 |

The security group MUST allow all outbound traffic.

## DNS records

A deployment MUST publish the DNS records in the following table, each with a time to live of 300 seconds.

| name | type | value | condition |
|---|---|---|---|
| server hostname | A | the Elastic IP address of an instance, or the IPv4 addresses of an external server | always |
| server hostname | AAAA | the first IPv6 address of an instance, or the IPv6 addresses of an external server | the server has an IPv6 address |
| patient portal hostname | CNAME | the central hostname | the patient portal hostname is set |

The DNS record of an mSupply hostname is given by [LNXMSP](msupply.md#provisioning).

## Retired deployments

A retired deployment MUST have no instances, security group, instance backup plan, repository bucket or ACME users.

The repository bucket of a retired deployment MUST be removed by a run after the run that removes its servers, with the protection that [LNXBAK](backups.md#repository-bucket) requires lifted for that run alone.

The repository bucket MUST NOT be removed while any object in it is within its Object Lock retention.

Where a retired deployment names a replacement domain base, every hostname it served MUST answer with a permanent redirect with status 301 to the same path and query under the replacement.

A hostname's label under the replacement domain base MUST be the label it had, unless a remapping for that label is configured.
