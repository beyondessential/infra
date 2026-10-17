# Runbook: a Linux server's certificate is wrong or missing

Browsers or integrations get TLS errors from a Linux server, the `caddy_certs` check fails, or a certificate is close to expiry.
Where certificates come from is in [LNXTLS](../spec/linux/tls.md#certificate-sources); the Canopy side of issuance is [Canopy TLS not issuing](canopy-tls-not-issuing.md).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
Access to the DNS-01 keys and any ZeroSSL key is **sensitive-data**; never print them ([rotate credentials](../reference/linux-credentials.md)).

## 1. When this applies

The failing name is served by Caddy on a Linux server: the public hostname, an extra hostname, the patient portal or mSupply hostname, or the Tailscale hostname.

## 2. Establish context

Which name, from the browser's error and the instance tags or inventory ([instance tags](../spec/linux/aws.md#instance-tags)); whether the server is an EC2 instance or an external one; the installed `bestool` version. [Deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

On the host. **[diagnose]**

1. Caddy's runtime events, where renewal failures appear and the access log never shows them: the one-liner in [read logs, Caddy access log](../sops/read-logs.md#caddy-access-log).
2. The bestool daemon, which serves Canopy certificates to Caddy: `systemctl status bestool-alertd`, and `bestool --version`. A site names the daemon's endpoint only for `bestool` 2.2.0 or later.
3. Caddy is admitted to the endpoint: `systemctl cat bestool-alertd` shows `Environment=BESTOOL_PERMIT_CERT_USER=caddy` in `20-caddy-certificates.conf`.
4. Which issuer applies: `cat /etc/caddy/config/issuer`. A `dns route53` block means DNS-01 through the credentials in `/var/lib/caddy/.aws/credentials`. Do not print that file.
5. The Tailscale name: `tailscale status`, and `grep TS_PERMIT_CERT_UID /etc/default/tailscaled`.

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Handshake fails right after a play, only for names that use the daemon | Caddy cannot reach the daemon (down) or is not admitted. A refusal fails the handshake; it does not fall back. | Start the daemon or re-run the `bestool` role ([dev-OTS](../sops/linux-run-playbooks.md)). |
| The daemon is up, a name still has Caddy's own certificate | The daemon declined that name, so Caddy's issuer took it. Canopy has no certificate for it. | Check the Canopy side ([Canopy TLS not issuing](canopy-tls-not-issuing.md)). |
| Renewal errors naming Route 53 or `AccessDenied` | The DNS-01 key is wrong, deleted or lacks the name. The policy covers `_acme-challenge.<name>` for the server, mSupply and portal names only. | Rotate the key ([SOP](../reference/linux-credentials.md)). **[dev-OTS]** |
| Renewal errors naming rate limits or HTTP-01 failures | Port 80 or 443 is not reachable from the internet, or the authority's rate limit is hit. | Check the security group, a host firewall and DNS ([network exposure](../spec/linux/aws.md#network-exposure)); escalate for a rate limit. |
| A `.local` name, or `tamanu_caddy_tls` false | HTTP only by design. | None. |
| An extra hostname redirects but its certificate is wrong | A redirecting hostname uses Caddy's issuer, not the daemon. | Same issuer checks. |
| The Tailscale name fails | HTTPS is not enabled for the tailnet, or Caddy is not permitted to use tailscaled's certificates. | `TS_PERMIT_CERT_UID=caddy` is written by the `caddy` role; re-run it. |

## 5. Resolve

Re-running a role with `--tags caddy` or `--tags bestool` rewrites the configuration and reloads Caddy: **[dev-OTS]** ([run the playbooks](../sops/linux-run-playbooks.md)).
A plain Caddy reload is **[dev-OTS]** too: no source pre-signs it.

## 6. Escalate

Give the name, the server, the issuer in force, the runtime event text (without keys), the `bestool` version, and whether the daemon is admitted.
