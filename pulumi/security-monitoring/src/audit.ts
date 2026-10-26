import * as aws from '@pulumi/aws';

// spec: AUDIT#event-store
// The organisation's only audit record of management events: member accounts have no
// trails of their own. Retained on delete and protected, so neither a destroy nor a
// bad diff can take the audit history with it.
export const auditEventStore = new aws.cloudtrail.EventDataStore(
  'audit-event-store',
  {
    name: 'CloudTrailQuery',
    organizationEnabled: true,
    multiRegionEnabled: true,
    retentionPeriod: 366,
    billingMode: 'EXTENDABLE_RETENTION_PRICING',
    terminationProtectionEnabled: true,
    advancedEventSelectors: [
      {
        name: 'Management events selector',
        fieldSelectors: [{ field: 'eventCategory', equals: ['Management'] }],
      },
    ],
    tags: {
      Purpose: 'audit',
      'billing.deployment': 'internal',
    },
  },
  { retainOnDelete: true, protect: true },
);
