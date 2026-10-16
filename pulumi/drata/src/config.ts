import { ManagedAgentName } from '@aws-sdk/client-ecs';
import { Config } from '@pulumi/pulumi';

const config = new Config();
export const drataExternalId = config.requireSecret('drataExternalId');
export const DRATA_AWS_ACCOUNT_ARN = 'arn:aws:iam::269135526815:root';
export const ROOT_ID = 'r-veli';

export const tags = {
  Purpose: 'audit',
  ManagedBy: 'pulumi',
  ...((config.getObject('tags') as object) ?? {}),
};
