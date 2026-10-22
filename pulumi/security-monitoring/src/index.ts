import * as aws from '@pulumi/aws';
import { AWS_PRIMARY_ACCOUNT_ID } from '../../constants/internal.ts';

if ((await aws.getCallerIdentity()).accountId !== AWS_PRIMARY_ACCOUNT_ID) {
  throw new Error('This is not the correct _BES Primary account ID');
}

// Dynamic so the account guard above runs before any resource is declared.
const { detectorIds } = await import('./guardduty.ts');
const { deliveryFailureTopicArns } = await import('./routing.ts');
const { auditEventStore } = await import('./audit.ts');

export const auditEventStoreArn = auditEventStore.arn;
export { detectorIds, deliveryFailureTopicArns };
