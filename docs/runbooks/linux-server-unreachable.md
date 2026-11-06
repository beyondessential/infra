# Runbook: a Linux server cannot be reached

SSH over the tailnet fails, Canopy shows the server offline, or a new instance never joined the tailnet.
Access is specified in [LNXSRV](../spec/linux/server.md#access).

Every action is tagged with its class ([ladder](../ruled-out-actions.md)).
AWS console and security group changes are developer and ops work.

## 1. When this applies

`ssh <login user>@<server name>` times out or is refused, or `tailscale_config` or the server's Canopy status says it is gone.
Connect by name, never by IP ([maintain Tamanu on Linux](https://github.com/beyondessential/tamanu/blob/main/docs/reference/maintain-tamanu-on-linux.md)).

## 2. Establish context

Which server; EC2 instance or external; new or long-running; whether your own tailnet connection works; Canopy's notes for any other access method. [Deployment context](../deployment-context.md). **[diagnose]**

## 3. Investigate

**[diagnose]**

1. Your side: `tailscale status` shows you connected and the target in the list.
2. The public side: an instance answers ICMP and HTTPS on its public hostname whether or not Tailscale is up, because the security group opens ICMP, 80 and 443 ([network exposure](../spec/linux/aws.md#network-exposure)). `ping <public hostname>` and `curl -sI https://<public hostname>`.
3. Canopy: the server's Tailscale status and last-seen time.
4. A new instance: the join key is single-use and valid for 6 hours, so an instance that failed to join within that window never will without a new key ([provision a server](../sops/linux-provision-server.md)).
5. Login user: the playbooks connect as the inventory's `ansible_user`; a banner on `ubuntu` names the right one ([LNXSRV](../spec/linux/server.md#access)).
6. Session Manager: whether the instance is listed as managed in AWS Systems Manager with a ping status of Online ([recovery access](../spec/linux/aws.md#recovery-access)). A developer reads this in the AWS console or with `aws ssm describe-instance-information`.

## 4. Interpret

| Evidence | Diagnosis | Action |
|---|---|---|
| Public hostname answers, tailnet does not, Session Manager lists the instance online | `tailscaled` is down or the node is expired or removed. | A developer opens a Session Manager session (below) and checks `systemctl status tailscaled`. |
| Public hostname answers, tailnet does not, Session Manager does not list the instance online | The SSM Agent is down, the instance has no instance profile, or the instance cannot reach AWS. | Escalate. A developer decides between fixing the profile and replacing the instance (below). |
| Public hostname does not answer either | The instance or its network is down, or DNS changed. | AWS instance status, security group, the DNS records ([DNS records](../spec/linux/aws.md#dns-records)). Escalate. |
| New instance, never appeared | First-boot join failed. | Check the AWS system log of the instance; the key may have expired. Escalate. |
| Only you cannot reach it | Your tailnet access. | Check your Tailscale login and ACL tags. |

## 5. Resolve

Support's steps end at diagnosis.
A developer opens a shell on an instance with Session Manager: `aws ssm start-session --target <instance id>` in the instance's AWS account, or the console's Connect button. **[dev-OTS]**
Session Manager needs no inbound port and no tailnet, so there is no need to change the security group.
An instance that Session Manager cannot reach has no other way in, so the developer fixes its instance profile with a Pulumi update, or replaces it ([provision a server](../sops/linux-provision-server.md)), or attaches its root volume to another instance. **[dev-OTS]**
For an external server, access is by whatever the site provides.

## 6. Escalate

Give the server, whether the public hostname answers, Canopy's last-seen time, whether Session Manager lists the instance online, and whether the instance is new.
