import * as awsClassic from '@pulumi/aws';

export const { name: region } = awsClassic.getRegionOutput({});
export const { accountId } = awsClassic.getCallerIdentityOutput({});
export const { partition, dnsSuffix } = awsClassic.getPartitionOutput();
