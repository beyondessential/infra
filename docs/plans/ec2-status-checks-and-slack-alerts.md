# EC2 status check alarms + Slack delivery for ops alerts

## Context

Two gaps in the current alerting:

1. **EC2 status checks are unwired.** Every EC2 instance reports
   `StatusCheckFailed`, `_System`, and `_Instance` metrics, but no CloudWatch
   alarms exist on these. A failed instance (host hardware, network, OS-level
   hang) goes unnoticed until something else breaks. The fleet is mostly
   tamanu/on-linux EC2s spread across the org's member accounts, plus a
   couple of TailscaleBox-based instances (`ts-relay`, etc).
2. **Notifications are email-only and per-individual.** `core/alerts.ts` sends
   per-account CPU alarms to a single dev email; `backup-monitoring` sends
   AWS Backup failures (org-wide via the existing StackSet) to a single
   monitoring email. Neither is visible to the rest of the team.

Goal: every EC2 instance gets system + instance status check alarms (with
EC2 auto-recovery on system-check failure); all ops alerts (status checks,
CPU, backup failures) fan out to a single shared `#aws-alerts` Slack channel
via AWS Chatbot in the primary account; email is dropped once Slack is
verified.

## Design

### Per-instance status check alarms

Per-instance alarms live next to the `aws.ec2.Instance` resource that creates
them. Two locations:

- `pulumi/tamanu/on-linux/src/instances.ts` — covers all tamanu on-linux
  stacks (each runs in its own member account).
- `pulumi/common/TailscaleBox.ts` — covers `ts-relay` and any future
  TailscaleBox consumer.

Three alarms per instance:

| Suffix | Metric | Threshold | Period | Datapoints | Action |
|--------|--------|-----------|--------|------------|--------|
| `-status-system` | `StatusCheckFailed_System` | `>= 1` | 60 s | 2 of 2 | recover + notify |
| `-status-instance` | `StatusCheckFailed_Instance` | `>= 1` | 60 s | 2 of 2 | notify |
| `-status-overall` | `StatusCheckFailed` | `>= 1` | 60 s | 5 of 5 | notify (catches edge cases the others miss) |

Auto-recovery uses the magic action ARN
`arn:aws:automate:${region}:ec2:recover` on the system-check alarm's
`alarmActions`.

Notify action = both the local per-account `workload-alerts` SNS topic (for
the existing email path during transition) **and** the new central topic in
primary (see next section).

### Cross-account routing to Slack

Slack delivery happens once, in primary, via AWS Chatbot
(`aws.chatbot.SlackChannelConfiguration`). Two SNS topics feed it:

- `backup-failure-notifications` (already in `backup-monitoring/src/central.ts`).
- `workload-alerts-central` (new, added to `backup-monitoring/src/central.ts`
  since this stack is already the central alerting hub).

The new topic's policy allows `cloudwatch.amazonaws.com` to publish under
`aws:PrincipalOrgID = AWS_ORG_ID`. Member-account alarms add this topic ARN
as a second `alarmActions` entry — direct cross-account publish, no
EventBridge forwarding.

Why direct SNS publish vs the EventBridge pattern used for backup events?
Backup events come from `aws.backup` and are filtered by
event pattern. CloudWatch alarms publish to SNS by design; EventBridge
forwarding for them would add a per-account event bus rule + IAM role for no
extra capability.

### Chatbot config

Manual prerequisite (one-time, before `pulumi up`):

1. Create Slack channel `#aws-alerts`.
2. In the primary account console, navigate to AWS Chatbot, "Configure new
   client" → Slack, complete OAuth.

Pulumi-managed (in `backup-monitoring`):

```ts
new aws.chatbot.SlackChannelConfiguration('aws-alerts', {
  configurationName: 'aws-alerts',
  slackTeamId: cfg.require('slackTeamId'),
  slackChannelId: cfg.require('slackChannelId'),
  iamRoleArn: chatbotRole.arn,
  snsTopicArns: [snsTopic.topicArn, workloadAlertsCentral.arn],
  loggingLevel: 'INFO',
});
```

`chatbotRole` is an IAM role assumed by `chatbot.amazonaws.com` with
`CloudWatchReadOnlyAccess` attached — Chatbot's docs-recommended baseline for
notifications-only usage; no command execution.

### Email migration

Phased so we don't go silent during cutover:

1. Initial: alarms publish to **both** local `workload-alerts` (email) and
   central `workload-alerts-central` (Slack). Backup failures stay on email
   plus add Slack.
2. Live-fire test: trigger a status check alarm via
   `aws cloudwatch set-alarm-state` on a single instance and confirm the
   message lands in `#aws-alerts`.
3. After verification: remove `send-to-devlead` in `core/src/alerts.ts` and
   `backup-failure-email` in `backup-monitoring/src/central.ts`. Leave the
   per-account topic in place (cheap; future subscribers might want it).

## Files to modify

- `pulumi/core/src/alerts.ts` — export `topic.arn`.
- `pulumi/core/src/index.ts` — re-export the alerts topic ARN.
- `pulumi/common/coreRef.ts` / `pulumi/common/CrossStack.ts` — add an
  accessor (`$core.alertsTopicArn()`) so consumer stacks can fetch it.
- `pulumi/backup-monitoring/src/central.ts` — new
  `workload-alerts-central` SNS topic with cross-account publish policy.
- `pulumi/backup-monitoring/src/config.ts` — `slackTeamId`, `slackChannelId`
  config keys.
- `pulumi/backup-monitoring/src/slack.ts` (new) — IAM role + Chatbot
  configuration subscribed to both topics.
- `pulumi/backup-monitoring/src/index.ts` — wire in the new module + export
  the new topic ARN.
- `pulumi/common/primaryRef.ts` — extend so consumers can fetch the central
  topic ARN; pulls via stack reference to backup-monitoring.
- `pulumi/tamanu/on-linux/src/instances.ts` — three alarms per instance with
  recover + notify actions.
- `pulumi/common/TailscaleBox.ts` — three alarms inside the component so
  every consumer (ts-relay, future use) gets them.

## Reused patterns

- `CrossStack` mechanism in `pulumi/common/CrossStack.ts` for fetching
  per-account and primary topic ARNs.
- `nativeTags` / `tags` from `pulumi/common/tags.ts` and `AWS_ORG_ID` from
  `pulumi/constants/internal.ts` for the cross-account topic policy.
- Existing alarm style from `pulumi/core/src/alerts.ts`.

The StackSet pattern in `pulumi/backup-monitoring/src/orgWide.ts` is **not**
needed: alarms are created next to the instances they monitor by the same
Pulumi project; no member-account event bus or forwarder is involved.

## Verification

After applying:

1. `aws-sso exec -p _BES_Primary:ReadAccess -- aws chatbot describe-slack-channel-configurations`
   confirms the Chatbot config exists with both topic ARNs.
2. `aws-sso exec -p <member>:ReadAccess -- aws cloudwatch describe-alarms --alarm-name-prefix <instance-id>-status`
   confirms three alarms per instance and `alarm-actions` includes the
   central topic ARN.
3. Trigger a test alarm:
   `aws cloudwatch set-alarm-state --alarm-name <instance-id>-status-instance --state-value ALARM --state-reason 'manual test'`
   — expect a Slack message in `#aws-alerts` within ~10 s. (Read-only profile
   probably can't run this; ask the user.)
4. Wait for or trigger a backup failure; confirm Slack delivery on the
   existing path.
5. `pulumi preview` on a representative subset (one core stack, one
   tamanu/on-linux stack, backup-monitoring) before applying broadly.

After verification, a follow-up commit removes the email subscriptions per
"Email migration" phase 3.
