---
id: CTLS
---

# Canopy certificate issuance infrastructure

The requirements in this spec apply to the DNS zones, roles and settings that let [Canopy](../overview.md#canopy) issue TLS certificates.
Canopy's rules for domains, grants, issuance and renewal are specified by Canopy in [DOM](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md) and [CRT](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/public-server/certificates.md).

## Borrowed terms

| term | meaning |
|---|---|
| managed zone | A DNS zone in which Canopy creates and changes records, configured by the infrastructure that provisions Canopy ([DOM, Managed zones](https://github.com/beyondessential/canopy/blob/main/.workhorse/specs/servers/domains.md#managed-zones)). |
| ACME | The protocol by which a client obtains certificates from a certificate authority ([RFC 8555](https://www.rfc-editor.org/rfc/rfc8555)). |
| directory | The ACME resource that lists the URLs of an authority ([RFC 8555 section 7.1.1](https://www.rfc-editor.org/rfc/rfc8555#section-7.1.1)). |
| PKCS #8 | The syntax of a private key as a PEM file ([RFC 5958](https://www.rfc-editor.org/rfc/rfc5958)). |
| zone, apex, delegation, parent | The DNS terms for a unit of administrative control, the name at which it begins, the creation of a separate zone beneath it, and the domain in which that zone is registered ([RFC 9499 section 7](https://www.rfc-editor.org/rfc/rfc9499#section-7)). |
| authoritative server | A server that answers for a zone from its own knowledge, named in an NS record of the zone and also called a name server ([RFC 9499 section 6](https://www.rfc-editor.org/rfc/rfc9499#section-6)). |
| hosted zone | A Route 53 container of the records of one DNS zone ([Working with public hosted zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html)). |
| `sts:AssumeRole` | The AWS action by which one identity obtains the temporary credentials of a role ([AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)). |
| trust policy | The policy of an IAM role that names the principals that may assume it ([IAM roles terms and concepts](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_terms-and-concepts.html)). |
| `route53:ChangeResourceRecordSets` | The Route 53 action that creates, replaces and deletes record sets, with a condition key that limits the record types of a change ([Condition keys for record sets](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/specifying-rrset-conditions.html)). |
| staging environment | The Let's Encrypt authority that issues certificates chaining to an untrusted root ([Staging environment](https://letsencrypt.org/docs/staging-environment/)). |

## Managed zones

Canopy MUST receive its [managed zones](#borrowed-terms) as a comma-separated list in the environment variable `CANOPY_DNS_ZONES`.

An entry of the list MUST have one of the forms in the following table.

| form | meaning |
|---|---|
| `apex=hosted-zone-id` | A zone in the account of the [Canopy DNS identity](../overview.md#canopy-dns-identity), written without assuming a role. |
| `apex=hosted-zone-id=role-arn` | A zone in any other account, written by assuming the role `role-arn`. |

`apex` MUST be the apex of the zone as a domain name, and `hosted-zone-id` MUST be the Route 53 hosted zone id of the zone.

An entry MUST carry a `role-arn` where the account of its zone differs from the account of the Canopy DNS identity.

An entry SHOULD NOT carry a `role-arn` where the account of its zone is the account of the Canopy DNS identity.

Every Canopy workload MUST receive the list, and not only the workload that writes records.

> [!NOTE]
> The workloads that serve operators and servers read the list as well as the workload that writes records.

A change to the list MUST roll every Canopy workload.

A [core](../overview.md#core) MUST publish the name of its zone, the hosted zone id of its zone, the id of its account and, where it has a [zone role](../overview.md#zone-role), the ARN of its zone role.

The infrastructure MUST derive each entry of the list from the values that the core owning the zone publishes.

The infrastructure MUST refuse to produce a list that has an entry for a core that publishes no zone.

The infrastructure MUST refuse to produce a list that has an entry for a zone in another account whose core publishes no zone role.

The infrastructure MUST refuse to produce a list where the Canopy DNS identity is not published.

> [!NOTE]
> An entry dropped silently reads to Canopy as a zone it was never given, and surfaces as a claimed domain that no managed zone covers, not as the missing access it is.

## Zone delegation

A core MUST publish the name servers of its zone.

The parent zone of the zone of a core MUST carry NS records that delegate the zone to the name servers of its hosted zone.

A zone that is delegated out of another managed zone MUST have its own entry in the list where Canopy is to issue certificates for names beneath it.

> [!NOTE]
> Canopy writes a record in the zone that the list names for a name.
> A record written in the parent zone is shadowed by the delegation, and validation then fails with no fault visible on the AWS side.

## Zone access

The Canopy workload that writes DNS records MUST run under its own identity in the account that hosts Canopy, the Canopy DNS identity.

A Canopy workload other than the one that writes DNS records MUST NOT be able to change the records of a managed zone.

The Canopy DNS identity MUST be permitted to perform `sts:AssumeRole`.

> [!NOTE]
> The permission names no role.
> The trust policy of each zone role is the gate that decides which zones the identity reaches.

For the zone in its own account, the Canopy DNS identity MUST hold the permission in the following table, and no other permission on the zone.

For the zone of its core, a zone role MUST grant the permission in the following table, and no other permission.

| element | value |
|---|---|
| action | `route53:ChangeResourceRecordSets` |
| resource | The hosted zone of the one zone. |
| condition | Every record type of a change is `A`, `AAAA` or `TXT`, by `route53:ChangeResourceRecordSetsRecordTypes`. |

A permission granted to Canopy in a zone MUST NOT allow Canopy to change an NS record or an SOA record.

> [!NOTE]
> Limiting the record types leaves the delegations and the start of authority of the zone out of reach without any dependence on which names Canopy chooses to write.

A permission granted to Canopy in a zone MUST NOT allow Canopy to list or read the records of the zone.

The trust policy of a zone role MUST name the Canopy DNS identity as its only principal.

A core that is not configured for Canopy MUST NOT have a zone role.

A core that is not configured for Canopy MUST NOT grant Canopy any access to its zone.

## Certificate authority account

The Canopy stack MUST accept the settings in the following table, and MUST pass each to Canopy as the environment variable named.

| setting | environment variable | value |
|---|---|---|
| account key | `CANOPY_ACME_ACCOUNT_KEY` | A private key in PKCS #8 PEM form. |
| directory | `CANOPY_ACME_DIRECTORY` | The URL of an ACME directory. |
| contact | `CANOPY_ACME_CONTACT` | A `mailto:` URI at which the authority can reach an operator. |

The Canopy stack MUST pass a setting to Canopy only where the stack configures it.

The account key MUST be held as a secret value in the configuration of the Canopy stack.

The workload that orders certificates and the workload that reports the authority in the administration interface MUST receive the same account key, directory and contact.

A Canopy workload that neither orders certificates nor reports the authority MUST NOT receive the account key.

> [!NOTE]
> A report that is computed in a workload without the account tells operators that no authority is configured while another workload issues certificates.
> The account key is a credential, so it is given to the workloads that use it and to no others.

## Staging and production

A stack MAY configure the directory as the Let's Encrypt [staging environment](#borrowed-terms).

A stack that configures no directory MUST select the Let's Encrypt production authority.

Moving from the staging environment to production MUST require no change to the stack other than removing the directory.
