---
id: AUDIT
---

# Organisation audit

The requirements in this spec apply to the record of the management events of the AWS accounts of the organisation.

## Borrowed terms

| term | meaning |
|---|---|
| management event | A CloudTrail record of a control-plane operation on the resources of an account ([CloudTrail concepts](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html)). |
| trail | A CloudTrail configuration that delivers the events of an account to an S3 bucket ([CloudTrail concepts](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-concepts.html)). |
| event data store | A CloudTrail Lake store of events that can be queried in SQL, whose events cannot be changed once recorded ([CloudTrail Lake](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake.html)). |
| organisation, management account, member account | The AWS Organizations grouping of accounts, the account that administers it, and every other account in it ([AWS Organizations terminology and concepts](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_getting-started_concepts.html)). |

## Event store

The organisation MUST have one event data store that records the management events of every account of the organisation in every region.

The event data store MUST be in the management account.

> [!NOTE]
> An administrator of a member account then cannot stop the recording of their own account or delete what has been recorded of it.

The event data store MUST record each account of the organisation from the moment the account joins the organisation.

The event data store MUST keep each event for at least 365 days.

The event data store MUST have termination protection turned on.

A member account SHOULD NOT have a trail that records management events.
