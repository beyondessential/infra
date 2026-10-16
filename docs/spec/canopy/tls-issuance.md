---
id: CTLS
---

# Canopy TLS issuance

The requirements in this spec apply to the certificates that [Canopy](../overview.md#canopy) issues to servers, and to the DNS zones and permissions it needs to issue them.
Certificates for the Gateway of a Kubernetes cluster are specified in [K8SING](../kubernetes/ingress.md#certificates).

## Borrowed terms

| term | meaning |
|---|---|
| ACME | The protocol by which a client obtains certificates from a certificate authority ([RFC 8555](https://www.rfc-editor.org/rfc/rfc8555)). |
| directory | The ACME resource that lists the URLs of an authority ([RFC 8555 section 7.1.1](https://www.rfc-editor.org/rfc/rfc8555#section-7.1.1)). |
| ACME account | The registration of an account key at one directory, found again from the key alone ([RFC 8555 section 7.3.1](https://www.rfc-editor.org/rfc/rfc8555#section-7.3.1)). |
| DNS-01 | The ACME challenge that proves control of a name by a DNS record ([RFC 8555 section 8.4](https://www.rfc-editor.org/rfc/rfc8555#section-8.4)). |
| challenge record | The TXT record that DNS-01 requires at the name formed by prepending `_acme-challenge` to the name being validated ([RFC 8555 section 8.4](https://www.rfc-editor.org/rfc/rfc8555#section-8.4)). |
| CSR | A certification request, which carries the public key and the names a certificate is wanted for ([RFC 2986](https://www.rfc-editor.org/rfc/rfc2986)). |
| PKCS #8 | The syntax of a private key as a PEM file ([RFC 5958](https://www.rfc-editor.org/rfc/rfc5958)). |
| mutual TLS | TLS in which the server requests a certificate from the client and the client authenticates with it ([RFC 8446 section 4.3.2](https://www.rfc-editor.org/rfc/rfc8446#section-4.3.2)). |
| zone, apex, delegation, authoritative | The DNS terms for a unit of administrative control, the name at which it begins, the creation of a separate zone beneath it, and the server of record for a zone ([RFC 9499 section 7](https://www.rfc-editor.org/rfc/rfc9499#section-7)). |
| hosted zone | A Route 53 container of the records of one DNS zone ([Working with public hosted zones](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/AboutHZWorkingWith.html)). |
| `sts:AssumeRole` | The AWS action by which one identity obtains the temporary credentials of a role ([AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html)). |
| trust policy | The policy of an IAM role that names the principals that may assume it ([IAM roles terms and concepts](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_terms-and-concepts.html)). |
| `route53:ChangeResourceRecordSets` | The Route 53 action that creates, replaces and deletes record sets, with a condition key that limits the record types of a change ([Condition keys for record sets](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/specifying-rrset-conditions.html)). |
| registered domain | The part of a domain name that a registrant bought, against which Let's Encrypt counts certificates ([Rate limits](https://letsencrypt.org/docs/rate-limits/)). |
| staging environment | The Let's Encrypt authority that issues certificates chaining to an untrusted root ([Staging environment](https://letsencrypt.org/docs/staging-environment/)). |

## Issuance

A server MUST request a certificate from Canopy by submitting a CSR.

A server MUST authenticate a request to Canopy with the mutual TLS identity under which it is enrolled with Canopy.

The private key of a server MUST NOT leave the server.

Canopy MUST prove control of every name in a certificate by DNS-01 before it issues the certificate.

Canopy MUST return the certificate chain to the requesting server.

A server SHOULD obtain certificates from Canopy without holding a credential that writes DNS records.

## Managed zones

Canopy MUST receive its [managed zones](../overview.md#managed-zone) as a comma-separated list in the environment variable `CANOPY_DNS_ZONES`.

An entry of the list MUST have one of the forms in the following table.

| form | meaning |
|---|---|
| `apex=hosted-zone-id` | A zone in the account that hosts Canopy's DNS identity, written without assuming a role. |
| `apex=hosted-zone-id=role-arn` | A zone in any other account, written by assuming the role `role-arn`. |

`apex` MUST be the apex of the zone as a domain name, and `hosted-zone-id` MUST be the Route 53 hosted zone id of the zone.

An entry MUST carry a `role-arn` where the account of its zone differs from the account of the [Canopy DNS identity](../overview.md#canopy-dns-identity).

An entry SHOULD NOT carry a `role-arn` where the account of its zone is the account of the Canopy DNS identity.

Every Canopy workload MUST receive the list, and not only the workload that writes records.

> [!NOTE]
> The workload that answers which zones a group may claim into, the workload that gates the names a server is entitled to, and the monitor that reports a claimed domain that no managed zone covers each read the list.

A Canopy that receives no list MUST write no records.

The workload that writes records MUST read the list once, at startup, and MUST NOT re-read it while it runs.

> [!NOTE]
> A re-read on every pass would let a half-applied configuration take live records down.

A [core](../overview.md#core) MUST publish the name of its zone, the hosted zone id of its zone, the id of its account and, where it has a [zone role](../overview.md#zone-role), the ARN of its zone role.

The infrastructure MUST derive each entry of the list from the values that the core owning the zone publishes.

The infrastructure MUST refuse to produce a list that has an entry for a core that publishes no zone.

The infrastructure MUST refuse to produce a list that has an entry for a zone in another account whose core publishes no zone role.

The infrastructure MUST refuse to produce a list where the Canopy DNS identity is not published.

> [!NOTE]
> An entry dropped silently reads to Canopy as a zone it was never given, and surfaces as a claimed domain that no managed zone covers, not as the missing access it is.

## Zone delegation

A managed zone covers only the names for which it is the authoritative zone.

A name beneath a zone that is delegated out of a managed zone MUST be covered only if the delegated zone is itself a managed zone with its own entry.

Canopy MUST write the challenge record for a name in the zone that is authoritative for the name.

> [!NOTE]
> A challenge record written in a parent zone is shadowed by the delegation.
> Validation then fails with no fault visible on the AWS side.

A core MUST publish the name servers of its zone.

The parent zone of the zone of a core MUST carry NS records that delegate the zone to the name servers of its hosted zone.

## Zone access

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

## Domain claims

A [group](../overview.md#group) controls a domain by holding a [domain claim](../overview.md#domain-claim) on it.

A domain claim MUST be on a name at or beneath the apex of a managed zone.

A domain claim gives its group control of the claimed name and of every name beneath it.

Canopy MUST NOT accept a domain claim that overlaps a domain claim held by another group.

Canopy MUST write a record only at a name that lies within a domain claim.

Canopy MUST issue a certificate only for names that lie within the domain claims of the group of the requesting server.

> [!NOTE]
> The permission of a zone role covers its whole zone, so domain claims alone bound the names on which Canopy acts.

A domain claim MUST NOT cover a name whose records another system manages.

> [!NOTE]
> A write by Canopy replaces a record set wholesale.
> The records that external-dns publishes in the same zone (see [K8SING](../kubernetes/ingress.md#dns)) are an instance of records that another system manages.

A domain claim that no managed zone covers MUST exclude overlapping claims by other groups.

Canopy MUST NOT write any record beneath a domain claim that no managed zone covers.

A group MUST hold a [TLS grant](../overview.md#tls-grant) for an application before servers of the application are issued certificates.

Canopy SHOULD offer the TLS grant of an application only where the group of the application holds a domain claim.

## Certificate authority account

Canopy MUST be configurable with the settings in the following table.

| setting | environment variable | value | default |
|---|---|---|---|
| account key | `CANOPY_ACME_ACCOUNT_KEY` | A private key in PKCS #8 PEM form. | none |
| directory | `CANOPY_ACME_DIRECTORY` | The URL of an ACME directory. | `https://acme-v02.api.letsencrypt.org/directory`, the Let's Encrypt production directory |
| contact | `CANOPY_ACME_CONTACT` | A `mailto:` URI at which the authority can reach an operator. | none |

Canopy MUST find or create its ACME account from the account key at every start.

Where no account key is configured, Canopy MUST issue no certificates.

Where no account key is configured, Canopy MUST continue to publish the addresses of the names that servers register.

Where no account key is configured, Canopy SHOULD report once at startup that it cannot issue.

The workload that orders certificates and the workload that reports the authority in the administration interface MUST receive the same account key, directory and contact.

Canopy SHOULD report in the administration interface the authority in use and whether its account is usable.

A Canopy workload that neither orders certificates nor reports the authority MUST NOT receive the account key.

> [!NOTE]
> A report that is computed in a workload without the account tells operators that no authority is configured while another workload issues certificates.
> The account key is a credential, so it is given to the workloads that use it and to no others.

## Staging and production

Canopy MUST order certificates from the authority named by its directory setting.

A deployment MAY configure the Let's Encrypt staging environment as its directory while a zone is being proved.

> [!NOTE]
> A certificate from the staging environment chains to an untrusted root.
> It demonstrates the path from server to zone to authority and nothing else.

Production issuance MUST be selected by removing the directory setting.

Promotion from staging to production MUST NOT require any change other than the removal of the directory setting and the restart of the workloads that read it.

A deployment MAY use one account key at the staging environment and at the production directory.

> [!NOTE]
> An ACME account is registered at one directory, so one key identifies a separate account at each directory.
> No account state moves with the promotion.

## Rate limits

Canopy SHOULD treat a throttling response from the authority as applying to every order, whichever group asked.

Canopy SHOULD hold off new orders for 10 minutes after a throttling response.

> [!NOTE]
> Let's Encrypt counts certificates per registered domain, so every group beneath one registered domain draws on a single allowance.

## Reporting

Canopy SHOULD report a domain claim that no managed zone covers.

Canopy SHOULD report whether it can reach its authority.

Canopy SHOULD report each of these against Canopy and not against a requesting server.
