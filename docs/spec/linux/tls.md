---
id: LNXTLS
---

# TLS certificates on a Linux server

The requirements in this spec apply to how a [Linux server](../overview.md#linux-server) obtains the certificates that Caddy serves, and to the AWS identities provisioned for that.
The hostnames that Caddy serves over HTTPS are specified by [LNXRUN](runtime.md#reverse-proxy).
The [alert daemon](../overview.md#alert-daemon) collects certificates from [Canopy](../overview.md#canopy) as [TLS](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/certificates.md) specifies, and serves them to Caddy as [TLSD](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/certificate-delivery.md) specifies.
The zones in which Canopy issues are provided as [CTLS](../canopy/tls-issuance.md) specifies.
The healthcheck that grades the certificates Caddy serves is [CHK-CCT](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/tamanu/caddy-certs.md).

## Borrowed terms

| term | meaning |
|---|---|
| Caddy | The web server that terminates TLS and reverse proxies ([Caddy documentation](https://caddyserver.com/docs/)). |
| issuer | A Caddy module that obtains certificates for the names Caddy manages, set by a global option ([Caddyfile global options](https://caddyserver.com/docs/caddyfile/options#cert-issuer)). |
| `get_certificate` | The `tls` subdirective by which Caddy asks a manager, here a URL or `tailscale`, for the certificate of a handshake ([tls directive](https://caddyserver.com/docs/caddyfile/directives/tls)). |
| certificate endpoint | The HTTP endpoint of the alert daemon from which Caddy fetches the chain and key of a name during a handshake ([TLSD, The certificate endpoint](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/certificate-delivery.md#the-certificate-endpoint)). |
| DNS-01 | The ACME challenge that proves control of a name by a DNS record ([RFC 8555 section 8.4](https://www.rfc-editor.org/rfc/rfc8555#section-8.4)). |
| Tailscale certificate | A certificate for the Tailscale hostname of a node, issued through tailscaled ([Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https)). |
| `TS_PERMIT_CERT_UID` | The tailscaled setting that names the non-root user permitted to request certificates from tailscaled ([Caddy certificates on Tailscale](https://tailscale.com/kb/1190/caddy-certificates)). |
| shared credentials file | The file in which AWS tools find access keys, with one profile per section ([Shared config and credentials files](https://docs.aws.amazon.com/sdkref/latest/guide/file-format.html)). |
| IAM user | An AWS identity with long-lived access keys ([IAM users](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_users.html)). |
| managed policy, inline policy | A policy that is a resource of its own and attaches to many identities, and a policy embedded in one identity ([Managed policies and inline policies](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_managed-vs-inline.html)). |
| `route53:ChangeResourceRecordSets` | The Route 53 action that creates, replaces and deletes record sets, with a condition key that limits the record types and names of a change ([Condition keys for record sets](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/specifying-rrset-conditions.html)). |

## Certificate sources

A hostname that Caddy serves over HTTPS MUST have a certificate from the source that the following table gives.

| hostname | certificate source |
|---|---|
| the public hostname, the patient portal hostname, the mSupply hostname, and an extra hostname that does not redirect | the certificate endpoint, then the issuer of Caddy for any name the alert daemon declines |
| an extra hostname that redirects | the issuer of Caddy |
| a Tailscale hostname | tailscaled |

The issuer of Caddy MUST remain configured for every site that names the certificate endpoint.

## Certificate endpoint

A site that obtains its certificate from the alert daemon MUST name the certificate endpoint `http://127.0.0.1:8271/certificate` as a `get_certificate` source.

A site MUST name the certificate endpoint only where the installed bestool is version 2.2.0 or later and the inventory variable `caddy_canopy_certificates` is true.

The alert daemon MUST admit, for its certificate endpoint, only `root` and the user `caddy`.

The user `caddy` MUST be named to the alert daemon by `BESTOOL_PERMIT_CERT_USER=caddy` in the environment of its service unit.

A site MUST NOT name the certificate endpoint before the running alert daemon admits `caddy`.

> [!NOTE]
> A refusal of Caddy by the alert daemon ends the handshake without falling back to the issuer of Caddy, as [TLSD, Declining and failing](https://github.com/beyondessential/bestool/blob/main/.workhorse/specs/canopy/certificate-delivery.md#declining-and-failing) specifies.

## Caddy issuer

The issuer of Caddy MUST be an ACME issuer with the contact address `tls-renewal@bes.au`.

Caddy MUST use ZeroSSL as an additional issuer, with the key in the inventory variable `caddy_zerossl_api_key`, where that variable is set.

The ACME issuer MUST prove control of names by DNS-01 through Route 53, with up to 10 retries, where the inventory variable `tamanu_caddy_tls_dns_iam` is set.

## DNS-01 credentials

Caddy MUST read Route 53 credentials from the profile `default` of the shared credentials file `/var/lib/caddy/.aws/credentials`.

The shared credentials file MUST hold the `access_key_id` and `secret_access_key` of the inventory variable `tamanu_caddy_tls_dns_iam`.

The shared credentials file MUST be owned by `caddy` with mode 0600, in a directory with mode 0700.

The shared credentials file and its directory MUST be removed where `tamanu_caddy_tls_dns_iam` is not set.

## DNS-01 users

A server MAY have an IAM user for DNS-01.

The managed policy and inline policy of such a user MUST be those in the following table.

| policy | actions | resource | condition |
|---|---|---|---|
| managed, shared by all such users | `route53:ListHostedZones`, `route53:ListHostedZonesByName`, `route53:GetChange` | all | none |
| inline | `route53:ChangeResourceRecordSets` | the hosted zone of the [core](../overview.md#core) | record type `TXT` only, and only at `_acme-challenge.<name>` for the server hostname, the mSupply hostname where set, and the patient portal hostname on a central server |
| inline | `route53:ListResourceRecordSets` | the hosted zone of the core | none |

The access keys of the IAM user MUST be created by an operator.

## Tailscale certificates

Caddy MUST be permitted to use the certificates of tailscaled, by `TS_PERMIT_CERT_UID=caddy` in `/etc/default/tailscaled`.

## Inventory variables

The variables in the following table configure the certificates of a Linux server.

| variable | default | meaning |
|---|---|---|
| `caddy_canopy_certificates` | `true` | Whether sites name the certificate endpoint. |
| `tamanu_caddy_tls_dns_iam` | none | The Route 53 credentials of a server, with `access_key_id` and `secret_access_key`. |
| `caddy_zerossl_api_key` | none | A ZeroSSL API key that adds ZeroSSL as an issuer. |
