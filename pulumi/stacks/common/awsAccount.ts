import * as awsClassic from '@pulumi/aws';

export const { accountId } = awsClassic.getCallerIdentityOutput({});
export const { partition, dnsSuffix } = awsClassic.getPartitionOutput();
export const region = (await awsClassic.getRegion()).name;
